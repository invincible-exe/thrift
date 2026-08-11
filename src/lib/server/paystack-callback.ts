import { NextResponse } from "next/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/payments/paystack";
import {
  finalizeOrderByReference,
  markOrderFailedByReference,
} from "@/lib/server/finalize-order";
import { finalizeBoostByReference } from "@/lib/server/finalize-boost";

interface PaystackWebhookBody {
  event?: string;
  data?: {
    reference?: string;
    transfer_code?: string;
    amount?: number;
    currency?: string;
    status?: string;
    gateway_response?: string;
    [key: string]: unknown;
  };
}

/**
 * Paystack webhook handler. Point the Paystack dashboard webhook URL at
 * /api/payments/paystack-webhook (this route calls this handler).
 *
 * Events handled:
 *  - charge.success  → finalize the pending order (or boost) matching
 *    data.reference, verified against the exact amount Paystack reports.
 *  - transfer.success → mark the payout (provider_ref = transfer_code) paid.
 *  - transfer.failed  → mark the payout failed with the gateway response.
 *
 * Security: the payload is only trusted after verifyWebhookSignature
 * (HMAC-SHA512 of the raw body with the secret key) passes. Any failure is
 * answered with 401 — Paystack retries failed webhooks.
 */
export async function handlePaystackWebhook(req: Request): Promise<Response> {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  if (!isAdminConfigured) {
    return NextResponse.json({ received: true });
  }

  let body: PaystackWebhookBody;
  try {
    body = JSON.parse(raw) as PaystackWebhookBody;
  } catch {
    return NextResponse.json({ received: true });
  }

  const data = body.data ?? {};

  if (body.event === "charge.success") {
    const reference = String(data.reference ?? "");
    const amountKes = Math.round(Number(data.amount ?? 0) / 100);
    if (!reference || !Number.isFinite(amountKes)) {
      return NextResponse.json({ received: true });
    }
    try {
      // A payment is either for an order or a boost — same STK/card flow.
      const status = await finalizeOrderByReference(reference, amountKes);
      if (status === "noop") {
        const boostStatus = await finalizeBoostByReference(reference, amountKes);
        if (boostStatus === "mismatch") {
          console.error("Paystack callback mismatch (boost) — not finalizing:", {
            reference,
            amountKes,
          });
        }
      } else if (status === "missing-product") {
        // The 1-of-1 was already sold (first payment wins). Fail the order so
        // the checkout modal errors and the refund can be processed.
        await markOrderFailedByReference(
          reference,
          "This piece was already sold. Your payment will be refunded."
        );
      } else if (status === "mismatch") {
        console.error("Paystack callback mismatch — not finalizing:", { reference, amountKes });
      }
    } catch (err) {
      console.error("finalizeOrderByReference failed:", err);
    }
  } else if (body.event === "transfer.success" || body.event === "transfer.failed") {
    const code = String(data.transfer_code ?? "");
    if (!code) {
      return NextResponse.json({ received: true });
    }
    const admin = getAdminClient();
    try {
      if (body.event === "transfer.success") {
        await admin
          .from("payouts")
          .update({ status: "paid", paid_at: new Date().toISOString(), failure_reason: null })
          .eq("provider_ref", code)
          .in("status", ["pending", "processing"]);
      } else {
        await admin
          .from("payouts")
          .update({
            status: "failed",
            failure_reason: String(data.gateway_response ?? "Transfer failed"),
          })
          .eq("provider_ref", code)
          .in("status", ["pending", "processing"]);
      }
    } catch (err) {
      console.error("Paystack transfer webhook processing failed:", err);
    }
  }

  return NextResponse.json({ received: true });
}
