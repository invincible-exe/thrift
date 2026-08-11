import { getAdminClient } from "@/lib/supabase/admin";
import { autoPaySellerPayouts } from "@/lib/server/payouts";

/**
 * Locate a pending order by its Paystack reference (provider_ref), verify
 * the callback's amount against it, then finalize it.
 *
 * Returns:
 *  - "completed" | "noop" | "missing-product" — finalization result
 *  - "mismatch"  — the amount didn't match the pending order
 *  - "noop"      — no pending order for that reference
 *
 * When the order completes, the seller's 90% enters ESCROW (held until the
 * buyer confirms delivery or the 24h auto-resolve window passes — see
 * 0005_escrow.sql). autoPaySellerPayouts is called anyway, but finds no
 * 'pending' seller payouts (they're 'escrow'), so nothing is paid yet — the
 * release sweep (POST /api/payouts/release-expired) pays them once released.
 */
export async function finalizeOrderByReference(
  reference: string,
  expectedAmount: number
): Promise<string> {
  const client = getAdminClient();
  const { data, error } = await client.rpc("finalize_order_by_reference", {
    p_reference: reference,
    p_expected_amount: expectedAmount,
  });
  if (error) throw error;
  const status = data ? String(data) : "noop";

  // Sale done → seller gets their 90% without anyone clicking a button.
  if (status === "completed") {
    const tally = await autoPaySellerPayouts(reference);
    console.log(
      `Auto-payout: ${tally.sent} sent, ${tally.skipped} skipped (order ${reference})`
    );
  }

  return status;
}

/** Mark a pending order failed (e.g. payment rejected or piece sold twice). */
export async function markOrderFailedByReference(
  reference: string,
  reason?: string
): Promise<string> {
  const client = getAdminClient();
  const { data, error } = await client.rpc("mark_order_failed_by_reference", {
    p_reference: reference,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data ? String(data) : "noop";
}
