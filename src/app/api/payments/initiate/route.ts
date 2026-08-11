import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import {
  chargeMpesa,
  initializeCardTransaction,
  normalizeE164,
  paystackCardCallbackUrl,
  paystackKeysReady,
} from "@/lib/payments/paystack";
import { finalizeOrderByReference } from "@/lib/server/finalize-order";
import { MPESA_PHONE_REGEX } from "@/lib/constants";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Stale pending orders (no webhook within this window) are failed before a
 *  new checkout is allowed, so a dropped payment can't wedge a 1-of-1. */
const STALE_PENDING_MS = 10 * 60 * 1000;

interface InitiateBody {
  method?: "mpesa" | "card";
  phone?: string;
  productId?: string;
}

/**
 * POST /api/payments/initiate
 * Body: { productId, method: "mpesa" | "card", phone? }
 *
 * Unified Paystack checkout, fully server-driven: the server identifies the
 * buyer from the session, validates the product + price against the DB, and
 * records a `pending` order keyed by its Paystack reference (provider_ref).
 *
 *  - method "mpesa" → Paystack charge with mobile_money (STK push to the
 *    phone). Returns { kind: "stk", orderId }.
 *  - method "card"  → Paystack transaction/initialize. Returns
 *    { kind: "redirect", orderId, authorizationUrl }; the buyer pays on the
 *    Paystack page and lands back on /api/payments/card/callback.
 *
 * In both cases the charge.success webhook (or the card callback's server
 * verification) finalizes the order — the browser never calls a purchase
 * function directly.
 *
 * Local dev without Paystack keys: set ALLOW_SIMULATED_MPESA=true to run a
 * server-side simulation (M-Pesa only) through the same service-role path.
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  // Every hit can trigger a charge — keep a tight per-user cap so an
  // attacker can't burn through pushes (or cost you money) on a loop.
  const rl = rateLimit(`checkout:${user.id}`, 10, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Too many checkout attempts. Try again in a little while.",
        retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000),
      },
      { status: 429 }
    );
  }

  let body: InitiateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const { method = "mpesa", phone, productId } = body;
  if (!productId || (method !== "mpesa" && method !== "card")) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const mpesaPhone = method === "mpesa" ? normalizeE164(phone ?? "") : "";
  if (method === "mpesa" && !MPESA_PHONE_REGEX.test(mpesaPhone.replace(/^\+/, ""))) {
    return NextResponse.json(
      { error: "INVALID_PHONE", message: "Enter a valid M-Pesa number, e.g. 0712 345 678." },
      { status: 400 }
    );
  }

  const simulate =
    process.env.ALLOW_SIMULATED_MPESA === "true" && process.env.NODE_ENV !== "production";

  if (!isAdminConfigured) {
    console.error("Checkout blocked: Supabase service-role keys not configured.");
    return NextResponse.json(
      { error: "PAYMENT_KEYS_MISSING", message: "Checkout is paused while payments are being configured." },
      { status: 501 }
    );
  }

  const admin = getAdminClient();

  // Validate the product server-side and use its stored price — the client
  // never decides the amount.
  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, title, price_kes, status, image_url, brand, seller_id")
    .eq("id", productId)
    .maybeSingle();
  if (productError || !product) {
    return NextResponse.json({ error: "PIECE_NOT_FOUND" }, { status: 404 });
  }
  if (product.status !== "active") {
    return NextResponse.json({ error: "PIECE_SOLD" }, { status: 409 });
  }
  const amount = product.price_kes;
  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: "INVALID_PRICE" }, { status: 500 });
  }

  // Self-heal stale pending orders for this piece, then refuse a second
  // checkout while another one is still in flight.
  await admin
    .from("orders")
    .update({ status: "failed", failure_reason: "Checkout timed out" })
    .eq("product_id", productId)
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - STALE_PENDING_MS).toISOString());

  const { data: inFlight } = await admin
    .from("orders")
    .select("id")
    .eq("product_id", productId)
    .eq("status", "pending")
    .maybeSingle();
  if (inFlight) {
    return NextResponse.json(
      { error: "PIECE_BEING_CHECKED_OUT", message: "Someone is already checking this piece out." },
      { status: 409 }
    );
  }

  const buyerName = String(user.user_metadata?.name ?? user.email ?? "");
  const buyerEmail = user.email ?? "";
  // Paystack references: lowercase + digits + dashes (a uuid qualifies).
  const reference = `1010-${crypto.randomUUID()}`;

  const recordPendingOrder = async () => {
    const { data: orderRow, error } = await admin
      .from("orders")
      .insert({
        status: "pending",
        method,
        provider_ref: reference,
        mpesa_phone: method === "mpesa" ? mpesaPhone.replace(/^\+/, "") : null,
        product_id: productId,
        buyer_id: user.id,
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        amount_kes: amount,
        product_snapshot: {},
      })
      .select("id")
      .single();
    if (error) throw error;
    return orderRow.id;
  };

  const failOrder = async (reason: string) => {
    await admin
      .from("orders")
      .update({ status: "failed", failure_reason: reason })
      .eq("provider_ref", reference)
      .eq("status", "pending");
  };

  // --- Simulated checkout (local dev only, keys absent) --------------------
  if (!paystackKeysReady()) {
    if (!simulate || method !== "mpesa") {
      console.error(
        method === "card"
          ? "Card checkout blocked: PAYSTACK_SECRET_KEY missing."
          : "M-Pesa checkout blocked: PAYSTACK_SECRET_KEY missing."
      );
      return NextResponse.json(
        {
          error: "PAYMENT_KEYS_MISSING",
          message: "Checkout is paused while payments are being configured.",
        },
        { status: 501 }
      );
    }
    try {
      const orderId = await recordPendingOrder();
      // Finalize through the exact same service-role RPC the webhook uses —
      // verified against the amount we just recorded.
      await finalizeOrderByReference(reference, amount);
      return NextResponse.json({ kind: "stk", orderId });
    } catch (err) {
      console.error("Simulated checkout failed:", err);
      return NextResponse.json({ error: "SIMULATED_FAILED" }, { status: 502 });
    }
  }

  // --- Live Paystack charge ------------------------------------------------
  const orderId = await recordPendingOrder();
  try {
    if (method === "card") {
      const res = await initializeCardTransaction({
        email: buyerEmail,
        amountKes: amount,
        reference,
        callbackUrl: paystackCardCallbackUrl(),
      });
      if (!res.ok || !res.data?.authorization_url) {
        await failOrder(`Paystack card checkout failed: ${res.message ?? "unknown"}`);
        return NextResponse.json(
          { error: "PAYMENT_PROVIDER_ERROR", message: "Couldn't start the card checkout. Try again." },
          { status: 502 }
        );
      }
      return NextResponse.json({
        kind: "redirect",
        orderId,
        authorizationUrl: String(res.data.authorization_url),
      });
    }

    // M-Pesa STK push.
    const res = await chargeMpesa({
      email: buyerEmail,
      amountKes: amount,
      reference,
      phone: mpesaPhone,
    });
    if (!res.ok) {
      await failOrder(`Paystack M-Pesa charge failed: ${res.message ?? "unknown"}`);
      return NextResponse.json(
        { error: "PAYMENT_PROVIDER_ERROR", message: "The M-Pesa payment couldn't be started. Try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ kind: "stk", orderId });
  } catch (err) {
    console.error("Paystack charge failed:", err);
    await failOrder("Checkout request failed");
    return NextResponse.json({ error: "PAYMENT_PROVIDER_ERROR", message: "The payment couldn't be started. Try again." }, { status: 502 });
  }
}
