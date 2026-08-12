import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import {
  chargeMpesa,
  normalizeE164,
  paystackKeysReady,
} from "@/lib/payments/paystack";
import { finalizeBoostByReference } from "@/lib/server/finalize-boost";
import { BOOST_PRICE_KES, MPESA_PHONE_REGEX } from "@/lib/constants";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Stale pending boosts (no webhook within this window) are failed before a
 *  new one is allowed, so a dropped payment can't wedge a listing. */
const STALE_PENDING_MS = 10 * 60 * 1000;

interface BoostRequestBody {
  phone?: string;
  productId?: string;
}

/**
 * POST /api/payments/boost
 * Body: { phone, productId }
 *
 * Self-serve boosted listings: the signed-in seller pays a flat fee
 * (BOOST_PRICE_KES — decided server-side, never by the client) via a
 * Paystack M-Pesa STK push to pin their live piece to the top of the feed
 * for 7 days.
 *
 * Mirrors the purchase flow exactly: the server identifies the caller from
 * the session, validates the piece is theirs and still active, records a
 * `pending` boost keyed by its Paystack reference (provider_ref), and pushes
 * the STK. The charge.success webhook verifies the amount and finalizes it.
 * Returns { boostId, reference }.
 *
 * Local dev without Paystack keys: set ALLOW_SIMULATED_MPESA=true to run the
 * same server-side simulation as checkout.
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const rl = await rateLimit(`boost:${user.id}`, 10, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Too many boost attempts. Try again in a little while.",
        retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000),
      },
      { status: 429 }
    );
  }

  let body: BoostRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const { phone, productId } = body;
  if (!phone || !productId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const mpesaPhone = normalizeE164(phone);
  if (!MPESA_PHONE_REGEX.test(mpesaPhone.replace(/^\+/, ""))) {
    return NextResponse.json(
      { error: "INVALID_PHONE", message: "Enter a valid M-Pesa number, e.g. 0712 345 678." },
      { status: 400 }
    );
  }

  const simulate =
    process.env.ALLOW_SIMULATED_MPESA === "true" && process.env.NODE_ENV !== "production";

  if (!isAdminConfigured) {
    console.error("Boost payment blocked: Supabase service-role keys not configured.");
    return NextResponse.json(
      {
        error: "PAYMENT_KEYS_MISSING",
        message: "Boosting is paused while payments are being configured.",
      },
      { status: 501 }
    );
  }

  const admin = getAdminClient();

  // Only the piece's own seller (or an admin) can boost it.
  const { data: product } = await admin
    .from("products")
    .select("id, title, status, seller_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product) {
    return NextResponse.json({ error: "PIECE_NOT_FOUND" }, { status: 404 });
  }
  if (product.status !== "active") {
    return NextResponse.json(
      { error: "PIECE_NOT_ACTIVE", message: "Only live pieces can be boosted." },
      { status: 409 }
    );
  }
  const isOwner = String(product.seller_id ?? "") === user.id;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!isOwner && profile?.role !== "admin") {
    return NextResponse.json(
      { error: "NOT_YOUR_PIECE", message: "You can only boost pieces you listed." },
      { status: 403 }
    );
  }

  const amount = BOOST_PRICE_KES; // server decides — the client never sets this.

  // Self-heal stale pending boosts for this piece, then refuse a second one
  // while another is still in flight.
  await admin
    .from("boosts")
    .update({ status: "failed" })
    .eq("product_id", productId)
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - STALE_PENDING_MS).toISOString());

  const { data: inFlight } = await admin
    .from("boosts")
    .select("id")
    .eq("product_id", productId)
    .eq("status", "pending")
    .maybeSingle();
  if (inFlight) {
    return NextResponse.json(
      {
        error: "BOOST_IN_FLIGHT",
        message: "A boost payment for this piece is already pending on your phone.",
      },
      { status: 409 }
    );
  }

  const reference = `boost-${crypto.randomUUID()}`;
  const recordPendingBoost = async () => {
    const { data: row, error } = await admin
      .from("boosts")
      .insert({
        status: "pending",
        provider_ref: reference,
        mpesa_phone: mpesaPhone.replace(/^\+/, ""),
        product_id: productId,
        seller_id: user.id,
        amount_kes: amount,
      })
      .select("id")
      .single();
    if (error) throw error;
    return row.id;
  };

  const failBoost = async (reason: string) => {
    await admin
      .from("boosts")
      .update({ status: "failed", failure_reason: reason })
      .eq("provider_ref", reference)
      .eq("status", "pending");
  };

  // --- Simulated boost (local dev only, keys absent) -----------------------
  if (!paystackKeysReady()) {
    if (!simulate) {
      console.error("Boost payment blocked: PAYSTACK_SECRET_KEY missing.");
      return NextResponse.json(
        {
          error: "PAYMENT_KEYS_MISSING",
          message: "Boosting is paused while payments are being configured.",
        },
        { status: 501 }
      );
    }
    try {
      const boostId = await recordPendingBoost();
      // Finalize through the exact same service-role RPC the webhook uses.
      await finalizeBoostByReference(reference, amount);
      return NextResponse.json({ boostId, reference });
    } catch (err) {
      console.error("Simulated boost failed:", err);
      return NextResponse.json({ error: "SIMULATED_FAILED" }, { status: 502 });
    }
  }

  // --- Live Paystack M-Pesa charge -----------------------------------------
  const boostId = await recordPendingBoost();
  try {
    const res = await chargeMpesa({
      email: user.email ?? "boost@10of10thrifts.app",
      amountKes: amount,
      reference,
      phone: mpesaPhone,
    });
    if (!res.ok) {
      await failBoost(`Paystack charge failed: ${res.message ?? "unknown"}`);
      return NextResponse.json(
        { error: "PAYMENT_PROVIDER_ERROR", message: "The boost payment couldn't be started. Try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ boostId, reference });
  } catch (err) {
    console.error("Paystack boost charge failed:", err);
    await failBoost("Boost payment request failed");
    return NextResponse.json(
      { error: "PAYMENT_PROVIDER_ERROR", message: "The boost payment couldn't be started. Try again." },
      { status: 502 }
    );
  }
}
