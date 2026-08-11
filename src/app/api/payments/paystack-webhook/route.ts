import { handlePaystackWebhook } from "@/lib/server/paystack-callback";

export const runtime = "nodejs";

/**
 * Paystack webhook — point the Paystack dashboard → Settings → Webhooks URL
 * at this route (https://your-domain.com/api/payments/paystack-webhook).
 *
 * Handles charge.success (order/boost finalization) and transfer.success /
 * transfer.failed (payout settlement), each verified by the Paystack
 * signature header. Any invalid signature gets a 401, which Paystack retries.
 */
export async function POST(req: Request) {
  return handlePaystackWebhook(req);
}
