import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { autoPayPendingSellerPayouts } from "@/lib/server/payouts";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/payouts/dispatch
 *
 * The guaranteed pay trigger: pushes every 'pending' seller payout out via
 * Paystack Transfer. Called the moment a buyer confirms receipt (and by the
 * escrow sweep when an escrow auto-releases) so released money is sent
 * immediately — no admin click required.
 *
 * Safe for any signed-in user to call: each send claims its row atomically
 * (pending → processing) inside sendPayout, so concurrent dispatches can
 * never double-pay. Refund payouts are deliberately NOT dispatched — they
 * stay manual for the owner to review.
 */
export async function POST() {
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

  // Each send costs money, so cap how often any one session can trigger a
  // full dispatch sweep (each individual send is atomic regardless).
  const rl = await rateLimit(`payout-dispatch:${user.id}`, 30, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
      { status: 429 }
    );
  }

  const tally = await autoPayPendingSellerPayouts();
  return NextResponse.json(tally);
}
