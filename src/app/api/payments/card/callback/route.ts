import { NextResponse } from "next/server";
import { verifyTransaction } from "@/lib/payments/paystack";
import {
  finalizeOrderByReference,
  markOrderFailedByReference,
} from "@/lib/server/finalize-order";

export const runtime = "nodejs";

/**
 * GET /api/payments/card/callback?reference=…
 *
 * Paystack redirects the buyer here after a card payment (callback_url on
 * /transaction/initialize — set PAYSTACK_CARD_CALLBACK_URL to this route).
 * The server verifies the transaction with Paystack (never trusts the
 * redirect alone) and finalizes the order, then sends the buyer back to the
 * store with ?paid=1 / ?paid=0 for the UI toast.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reference = searchParams.get("reference") ?? "";
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin).replace(/\/+$/, "");

  if (!reference) {
    return NextResponse.redirect(`${origin}/?paid=0`);
  }

  try {
    const res = await verifyTransaction(reference);
    if (res.ok && res.data && String(res.data.status ?? "") === "success") {
      const amountKes = Math.round(Number(res.data.amount ?? 0) / 100);
      const status = await finalizeOrderByReference(reference, amountKes);
      if (status === "missing-product") {
        await markOrderFailedByReference(
          reference,
          "This piece was already sold. Your payment will be refunded."
        );
      }
      return NextResponse.redirect(`${origin}/?paid=1`);
    }
  } catch (err) {
    console.error("Card callback verification failed:", err);
  }

  return NextResponse.redirect(`${origin}/?paid=0`);
}
