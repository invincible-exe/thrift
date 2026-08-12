import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { autoPayOrderPayouts } from "@/lib/server/payouts";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/orders/confirm-receipt
 * Body: { orderId }
 *
 * Buyer-only: marks the order as "received" and releases the seller's 90%
 * that was held in escrow. The DB function (confirm_receipt) verifies the
 * caller is the order's buyer — the body is never trusted for ownership.
 *
 * Once released, the payout flips to 'pending' and is paid out automatically
 * (best-effort — autoPayOrderPayouts never throws, so a payout hiccup can't
 * fail the confirmation; the payout just stays in the admin queue).
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json(
      { error: "ADMIN_NOT_CONFIGURED", message: "Service-role keys are not configured." },
      { status: 501 }
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  // Tight cap: confirming receipt is rare and releases money — an attacker
  // looping it just re-triggers payouts that are already pending (no-ops),
  // but the limit keeps things sane anyway.
  const rl = await rateLimit(`confirm:${user.id}`, 20, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
      { status: 429 }
    );
  }

  const { orderId } = (await req.json()) as { orderId?: string };
  if (!orderId) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });

  // Call with the USER's client so auth.uid() = the buyer inside the RPC;
  // the DB enforces that this order belongs to them.
  const { data: released, error } = await supabase.rpc("confirm_receipt", {
    p_order_id: orderId,
  });
  if (error) {
    const msg = String(error.message ?? "");
    const status = /NOT_YOUR_ORDER/i.test(msg)
      ? 403
      : /ORDER_NOT_FOUND/i.test(msg)
        ? 404
        : 502;
    return NextResponse.json({ error: msg }, { status });
  }

  // Auto-pay the just-released seller payout(s) — best-effort.
  const tally = await autoPayOrderPayouts([orderId]);

  return NextResponse.json({
    released: Number(released ?? 0),
    autoPaid: tally.sent,
  });
}
