import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import {
  markStuckPayoutFailed,
  markStuckPayoutPaid,
  scanStuckPayouts,
  verifyStuckPayout,
} from "@/lib/server/payouts";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/payouts/reconcile
 * Body: { action: "scan" | "verify" | "markPaid" | "markFailed", payoutId?, note? }
 *
 * Admin-only stuck-payout reconciliation. A payout sits in 'processing'
 * from the moment a transfer is initiated until the webhook settles it; a
 * lost webhook leaves it "Sending…" forever.
 *
 * Actions:
 *  - scan: list stuck 'processing' rows (with the recipient so the owner
 *    can check their statement).
 *  - verify: ask Paystack for ground truth on the transfer (provider_ref)
 *    and settle the row automatically when Paystack confirms success/fail.
 *  - markPaid / markFailed: record a manually verified outcome. Only
 *    'processing' rows are ever touched, so a settled payout can't flip.
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

  const rl = await rateLimit(`payout-reconcile:${user.id}`, 60, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
      { status: 429 }
    );
  }

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    payoutId?: string;
    note?: string;
  };

  if (body.action === "verify") {
    if (!body.payoutId) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }
    // Ground truth from Paystack: success → paid, failed → failed. Returns
    // null when Paystack can't be reached — the row stays 'processing'.
    const outcome = await verifyStuckPayout(body.payoutId);
    const stuck = await scanStuckPayouts();
    return NextResponse.json({ stuck, updated: outcome ? 1 : 0, outcome });
  }

  if (body.action === "markPaid" || body.action === "markFailed") {
    if (!body.payoutId) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }
    // markPaid has no note field — a verified-paid payout must not carry an
    // error-styled failure_reason; the note lives on the markFailed side.
    const updated = body.action === "markPaid"
      ? await markStuckPayoutPaid(body.payoutId)
      : await markStuckPayoutFailed(body.payoutId, body.note);
    // Re-scan so the caller can refresh the stuck list in one round-trip.
    const stuck = await scanStuckPayouts();
    return NextResponse.json({ stuck, updated: updated ? 1 : 0 });
  }

  // Default: scan.
  const stuck = await scanStuckPayouts();
  return NextResponse.json({ stuck, updated: 0 });
}
