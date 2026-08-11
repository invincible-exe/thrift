import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Locate a pending boost by its Paystack reference (provider_ref), verify
 * the payment's amount against it, then finalize it — the Paystack-side
 * mirror of finalizeOrderByReference for boosted listings.
 *
 * Returns:
 *  - "completed" — the boost was paid and the piece is pinned for 7 days
 *  - "noop"      — no pending boost for that reference
 *  - "mismatch"  — the amount didn't match the pending boost
 *
 * The pinning happens in SQL (finalize_boost_by_reference sets
 * products/listings boost_expires_at), so a boost can only activate with a
 * verified payment.
 */
export async function finalizeBoostByReference(
  reference: string,
  expectedAmount: number
): Promise<string> {
  const client = getAdminClient();
  const { data, error } = await client.rpc("finalize_boost_by_reference", {
    p_reference: reference,
    p_expected_amount: expectedAmount,
  });
  if (error) throw error;
  return data ? String(data) : "noop";
}

/** Mark a pending boost failed (payment rejected / stale). */
export async function markBoostFailedByReference(
  reference: string,
  reason?: string
): Promise<string> {
  const client = getAdminClient();
  const { data, error } = await client.rpc("mark_boost_failed_by_reference", {
    p_reference: reference,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data ? String(data) : "noop";
}
