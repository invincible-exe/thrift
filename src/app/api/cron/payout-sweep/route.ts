import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { autoPayPendingSellerPayouts } from "@/lib/server/payouts";

export const runtime = "nodejs";

/**
 * POST /api/cron/payout-sweep
 * Headers: x-cron-secret: <CRON_SECRET>
 *
 * The hourly auto-sweep (no user session — runs as service role):
 *  1. release_expired_escrow — flips every seller payout whose 24h escrow
 *     window has elapsed (buyer silence = received) to 'pending'.
 *  2. autoPayPendingSellerPayouts — pushes every 'pending' seller payout out
 *     via Paystack Transfer.
 *
 * This closes the gap where payouts only fired on page loads: with a cron
 * hitting this every hour, escrow release + payout dispatch happen on
 * schedule regardless of who opens the app.
 *
 * Callers:
 *  - Vercel Cron (vercel.json) or Supabase pg_cron (pg_net POST) both send
 *    x-cron-secret matching CRON_SECRET in .env.local.
 * The secret comparison is timing-safe; an unauthenticated call gets 401
 * (and Vercel/pg_cron will retry).
 */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  const authed = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);

  if (!authed) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!isAdminConfigured) {
    console.error("Payout sweep blocked: Supabase service-role keys not configured.");
    return NextResponse.json(
      { error: "ADMIN_NOT_CONFIGURED", message: "Service-role keys are not configured." },
      { status: 501 }
    );
  }

  const admin = getAdminClient();

  // 1. Release expired escrows (idempotent — only touches rows past deadline).
  const { data: released, error } = await admin.rpc("release_expired_escrow");
  if (error) {
    console.error("Cron escrow sweep failed:", error);
    return NextResponse.json({ error: String(error.message ?? "Sweep failed") }, { status: 502 });
  }

  // 2. Pay out everything now pending. Each send claims its row atomically
  //    (pending → processing), so concurrent sweeps can't double-pay.
  const tally = await autoPayPendingSellerPayouts();

  // HMAC over the response body so a noisy response can't leak the secret.
  const body = JSON.stringify({ released: Number(released ?? 0), ...tally });
  const digest = createHmac("sha256", expected).update(body).digest("hex");

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/json", "x-cron-digest": digest },
  });
}
