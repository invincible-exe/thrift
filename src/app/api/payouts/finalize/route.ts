import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import { finalizeTransferOtp } from "@/lib/server/payouts";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/payouts/finalize
 * Body: { payoutId, otp }
 *
 * Admin-only: confirms an OTP-gated Paystack transfer with the OTP sent to
 * the business owner's phone/email. Only touches payouts still in
 * 'processing' (a finalized one is a no-op).
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json(
      { error: "ADMIN_NOT_CONFIGURED", message: "Service-role keys are not configured." },
      { status: 501 }
    );
  }

  const { payoutId, otp } = (await req.json().catch(() => ({}))) as {
    payoutId?: string;
    otp?: string;
  };
  if (!payoutId || !otp?.trim()) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const rl = rateLimit(`transfer-finalize:${user.id}`, 30, WINDOWS.hour);
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

  const res = await finalizeTransferOtp(payoutId, otp);
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: res.message });
}
