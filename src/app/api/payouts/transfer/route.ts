import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import { sendPaystackPayout, transferKeysReady } from "@/lib/server/payouts";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/payouts/transfer
 * Body: { payoutId }
 *
 * Admin-only: triggers a Paystack Transfer of a seller's payout to their
 * M-Pesa number or bank account (per their profile preference). The
 * transfer.success/failed webhook (or the reconcile Verify action) settles
 * the payout.
 *
 * A response with otpRequired: true means Paystack sent an OTP to the
 * business phone — the admin enters it via POST /api/payouts/finalize.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json(
      {
        error: "ADMIN_NOT_CONFIGURED",
        message:
          "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local to run payouts.",
      },
      { status: 501 }
    );
  }

  if (!transferKeysReady()) {
    return NextResponse.json(
      {
        error: "PAYMENT_KEYS_MISSING",
        message:
          "Set PAYSTACK_SECRET_KEY to enable payouts. See docs/PAYMENTS.md.",
      },
      { status: 501 }
    );
  }

  const { payoutId } = (await req.json().catch(() => ({}))) as { payoutId?: string };
  if (!payoutId) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  // Admin-only endpoint, but cap it anyway so a compromised admin session
  // can't fire an unlimited number of transfers.
  const rl = rateLimit(`transfer:${user.id}`, 20, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Too many payout requests. Try again in a little while.",
        retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000),
      },
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

  const res = await sendPaystackPayout(payoutId);
  if (!res.ok) {
    const status =
      res.error === "NOT_FOUND"
        ? 404
        : res.error === "PAYOUT_ALREADY_PROCESSED"
          ? 409
          : res.error === "NO_RECIPIENT_PHONE" || res.error === "NO_BANK_DETAILS"
            ? 400
            : 502;
    return NextResponse.json({ error: res.error, message: res.message }, { status });
  }

  return NextResponse.json({
    message: res.message,
    otpRequired: res.otpRequired ?? false,
    transferCode: res.transferCode,
  });
}
