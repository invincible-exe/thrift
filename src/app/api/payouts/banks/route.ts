import { NextResponse } from "next/server";
import { listBanks } from "@/lib/payments/paystack";

export const runtime = "nodejs";

/**
 * GET /api/payouts/banks
 *
 * The Paystack KES bank list for the seller's payout form (bank transfers).
 * Public data — any signed-in user may read it; only the code + name are
 * returned. Cached in the browser by the caller.
 */
export async function GET() {
  const res = await listBanks();
  if (!res.ok || !Array.isArray(res.data)) {
    return NextResponse.json(
      { error: "BANKS_UNAVAILABLE", message: "The bank list is temporarily unavailable." },
      { status: 502 }
    );
  }
  const banks = (res.data as { code?: string; name?: string }[])
    .filter((b) => b.code && b.name)
    .map((b) => ({ code: String(b.code), name: String(b.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ banks });
}
