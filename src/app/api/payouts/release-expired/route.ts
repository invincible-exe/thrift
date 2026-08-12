import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { autoPayPendingSellerPayouts } from "@/lib/server/payouts";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/payouts/release-expired
 *
 * The 24-hour auto-resolve: releases every seller payout whose escrow window
 * has elapsed (buyer silence = received), then auto-pays the released ones.
 * Safe for any signed-in user to call — the DB function only ever releases
 * payouts already past their deadline, and each send claims its row
 * atomically, so concurrent sweeps can't double-pay. The app sweeps this on
 * account/admin page load, so no cron is needed.
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

  // Generous cap — this is called on page loads; the limit just stops a
  // bot looping payout sends (each send is atomic, but they cost money).
  const rl = await rateLimit(`escrow-sweep:${user.id}`, 30, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
      { status: 429 }
    );
  }

  const { data: released, error } = await supabase.rpc("release_expired_escrow");
  if (error) {
    return NextResponse.json({ error: String(error.message ?? "Sweep failed") }, { status: 502 });
  }

  const count = Number(released ?? 0);

  // Auto-pay every pending seller payout (the ones just released, plus any
  // sitting pending from a buyer's confirm_receipt). Each send claims its
  // row atomically, so concurrent sweeps can't double-pay. Refunds are
  // never auto-dispatched — they stay manual for the owner to review.
  const tally = await autoPayPendingSellerPayouts();

  return NextResponse.json({ released: count, autoPaid: tally.sent });
}
