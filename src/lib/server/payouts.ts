import { getAdminClient } from "@/lib/supabase/admin";
import {
  createTransferRecipient,
  fetchTransfer,
  finalizeTransfer,
  initiateTransfer,
  paystackKeysReady,
  toLocalPhone,
} from "@/lib/payments/paystack";

type Row = Record<string, unknown>;

/** True when the Paystack secret key needed to send money is present. */
export function transferKeysReady(): boolean {
  return paystackKeysReady();
}

export interface TransferResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** True when Paystack requires an OTP to finalize this transfer. */
  otpRequired?: boolean;
  /** The Paystack transfer_code when an OTP is needed (or on success). */
  transferCode?: string;
  data?: Record<string, unknown>;
}

/** Build a valid Paystack transfer reference: 16–50 chars, lowercase letters,
 *  digits, dash and underscore only. */
function buildTransferReference(payoutId: string): string {
  const hex = payoutId.replace(/-/g, "").slice(0, 32);
  return `pay-${hex}-${Date.now().toString(36)}`;
}

/**
 * Send one seller/refund payout via Paystack Transfer (service role).
 *
 * Shared by the admin dashboard (manual "Pay out" button) and the automatic
 * payout that fires the moment a sale completes. Steps:
 *  1. Claim the payout atomically (pending → processing) so two concurrent
 *     calls can never double-pay the same ledger row.
 *  2. Resolve the destination: M-Pesa (mobile_money recipient, phone) or
 *     bank (Paystack bank_code + account number + account name from the
 *     seller's profile). Refunds always go to the buyer's payment phone.
 *  3. Create the Paystack recipient and initiate the transfer; store the
 *     transfer_code as provider_ref. The webhook flips it paid/failed.
 *  Any failure releases the claim (back to pending) so it can be retried.
 */
export async function sendPaystackPayout(payoutId: string): Promise<TransferResult> {
  const admin = getAdminClient();

  const { data: payout } = await admin
    .from("payouts")
    .select("*")
    .eq("id", payoutId)
    .maybeSingle();
  if (!payout) return { ok: false, error: "NOT_FOUND", message: "Payout not found." };
  if (payout.role !== "seller" && payout.role !== "refund") {
    return {
      ok: false,
      error: "NOT_PAYABLE_PAYOUT",
      message: "This payout isn't payable via Paystack Transfers.",
    };
  }

  // Claim pending → processing before calling Paystack. Only a row still in
  // 'pending' can be claimed, so a second concurrent request no-ops.
  const { data: claimed } = await admin
    .from("payouts")
    .update({
      status: "processing",
      failure_reason: null,
      processing_started_at: new Date().toISOString(),
    })
    .eq("id", payoutId)
    .eq("status", "pending")
    .select("id");
  if (!claimed || claimed.length === 0) {
    return {
      ok: false,
      error: "PAYOUT_ALREADY_PROCESSED",
      message: "This payout has already been handled.",
    };
  }

  const releaseClaim = async (failureReason: string) => {
    await admin
      .from("payouts")
      .update({
        status: "pending",
        failure_reason: failureReason,
        processing_started_at: null,
        provider_ref: null,
        recipient_code: null,
      })
      .eq("id", payoutId)
      .eq("status", "processing");
  };

  // Resolve where the money goes.
  const sellerId = String(payout.to ?? "");
  const { data: profile } = await admin
    .from("profiles")
    .select("name, phone, payout_method, bank_code, bank_account_number, bank_account_name")
    .eq("id", sellerId)
    .maybeSingle();

  const isRefund = payout.role === "refund";
  let method: "mpesa" | "bank";
  let name: string;
  let accountNumber: string;
  let bankCode: string;

  if (isRefund) {
    method = "mpesa";
    name = "Buyer refund";
    accountNumber = toLocalPhone(String(payout.refund_phone ?? ""));
    bankCode = "MPESA";
  } else {
    const pref = String(profile?.payout_method ?? "mpesa");
    if (pref === "bank") {
      method = "bank";
      name = String(profile?.bank_account_name ?? "").trim();
      accountNumber = String(profile?.bank_account_number ?? "").trim();
      bankCode = String(profile?.bank_code ?? "").trim();
      if (!name || !accountNumber || !bankCode) {
        await releaseClaim("Seller hasn't set their bank payout details");
        return {
          ok: false,
          error: "NO_BANK_DETAILS",
          message:
            "This seller hasn't set their bank account for payouts. Ask them to add it in their account.",
        };
      }
    } else {
      method = "mpesa";
      name = String(profile?.name ?? "Seller").trim() || "Seller";
      accountNumber = toLocalPhone(String(profile?.phone ?? ""));
      bankCode = "MPESA";
      if (!/^07\d{8}$/.test(accountNumber)) {
        await releaseClaim("Seller hasn't set a payout M-Pesa number");
        return {
          ok: false,
          error: "NO_RECIPIENT_PHONE",
          message:
            "This seller hasn't set a payout M-Pesa number yet. Ask them to add one in their account.",
        };
      }
    }
  }

  try {
    // Create the Paystack recipient (M-Pesa wallet or bank account).
    const recipientRes = await createTransferRecipient({
      type: method === "bank" ? "bank" : "mobile_money",
      name,
      accountNumber,
      bankCode,
    });
    if (!recipientRes.ok || !recipientRes.data?.recipient_code) {
      await releaseClaim(`Paystack recipient failed: ${recipientRes.message ?? "unknown"}`);
      return {
        ok: false,
        error: "RECIPIENT_FAILED",
        message: `Couldn't create the payout recipient. ${recipientRes.message ?? ""}`.trim(),
      };
    }
    const recipientCode = String(recipientRes.data.recipient_code);

    // Initiate the transfer from the Paystack balance.
    const reference = buildTransferReference(payoutId);
    const transferRes = await initiateTransfer({
      amountKes: Number(payout.amount_kes ?? 0),
      recipientCode,
      reference,
      reason: isRefund ? "10/10 Thrifts refund" : "10/10 Thrifts seller payout",
    });
    if (!transferRes.ok) {
      await releaseClaim(`Paystack transfer rejected: ${transferRes.message ?? "unknown"}`);
      return {
        ok: false,
        error: "TRANSFER_REJECTED",
        message: transferRes.message ?? "Paystack rejected the transfer.",
      };
    }

    const transferCode = String(transferRes.data?.transfer_code ?? reference);
    await admin
      .from("payouts")
      .update({
        provider_ref: transferCode,
        recipient_code: recipientCode,
        payout_method: method,
      })
      .eq("id", payoutId)
      .eq("status", "processing");

    // OTP-gated transfers need a confirmation step before they go out.
    if (String(transferRes.data?.status ?? "") === "otp") {
      return {
        ok: true,
        otpRequired: true,
        transferCode,
        message:
          "Paystack needs an OTP to release this transfer. Enter the code sent to the business phone.",
      };
    }

    return {
      ok: true,
      transferCode,
      message: "Transfer sent to Paystack. It settles once confirmed.",
    };
  } catch (err) {
    console.error("Paystack transfer failed:", err);
    await releaseClaim("Paystack transfer request failed. Retry");
    return { ok: false, error: "TRANSFER_REQUEST_FAILED", message: "Transfer request failed. Retry." };
  }
}

/**
 * Send every 'pending' seller payout for a set of orders (best-effort).
 * Used after escrow release (buyer confirmed receipt / 24h auto-resolve) to
 * push the money out without an admin click. Each send claims its row
 * atomically (pending → processing), so concurrent sweeps can't double-pay.
 */
export async function autoPayOrderPayouts(orderIds: string[]): Promise<{
  sent: number;
  skipped: number;
}> {
  const tally = { sent: 0, skipped: 0 };
  if (!transferKeysReady() || orderIds.length === 0) return tally;

  try {
    const admin = getAdminClient();
    const { data: payouts } = await admin
      .from("payouts")
      .select("id")
      .eq("role", "seller")
      .eq("status", "pending")
      .in("order_id", orderIds);

    for (const p of (payouts ?? []) as Row[]) {
      try {
        const res = await sendPaystackPayout(String(p.id));
        if (res.ok) tally.sent += 1;
        else tally.skipped += 1;
      } catch (err) {
        tally.skipped += 1;
        console.error("Auto-payout failed for payout", String(p.id), err);
      }
    }
  } catch (err) {
    console.error("autoPayOrderPayouts failed:", err);
  }
  return tally;
}

/**
 * Which of the given seller ids the owner has verified. The first-payout
 * gate: automatic dispatch skips anyone not in this set, so an unverified
 * seller's share sits in 'pending' until the owner reviews them in the
 * admin dashboard (Settlements → verify → next sweep pays).
 */
async function verifiedSellerIds(sellerIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(sellerIds.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const admin = getAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("seller_verified", true)
    .in("id", unique);
  return new Set((data ?? []).map((r) => String(r.id)));
}

/**
 * Guaranteed pay trigger — push EVERY 'pending' seller payout out via
 * Paystack Transfers. Runs after a buyer confirms receipt and after the
 * escrow sweep releases expired escrows, so released money is sent
 * immediately instead of waiting for an admin click. Each send claims its
 * row atomically, so concurrent sweeps can't double-pay. Never touches
 * refund payouts (those stay manual by design).
 */
export async function autoPayPendingSellerPayouts(): Promise<{
  sent: number;
  skipped: number;
}> {
  const tally = { sent: 0, skipped: 0 };
  if (!transferKeysReady()) return tally;

  try {
    const admin = getAdminClient();
    const { data: payouts } = await admin
      .from("payouts")
      .select("id, to")
      .eq("role", "seller")
      .eq("status", "pending");

    const verified = await verifiedSellerIds((payouts ?? []).map((p) => String(p.to)));

    for (const p of (payouts ?? []) as Row[]) {
      // First-payout gate: the owner must verify a seller before their money
      // auto-goes out. Unverified sellers' payouts stay 'pending' and show in
      // the admin Settlements queue for review (the owner approves the seller
      // first, then the next sweep sends it).
      if (!verified.has(String(p.to ?? ""))) {
        tally.skipped += 1;
        continue;
      }
      try {
        const res = await sendPaystackPayout(String(p.id));
        if (res.ok) tally.sent += 1;
        else tally.skipped += 1;
      } catch (err) {
        tally.skipped += 1;
        console.error("Auto-payout failed for payout", String(p.id), err);
      }
    }
  } catch (err) {
    console.error("autoPayPendingSellerPayouts failed:", err);
  }
  return tally;
}

/**
 * Automatically pay out every seller's 90% share for a just-completed order.
 * Called from the finalization path (Paystack webhook + simulation) the
 * moment an order is finalized. Best-effort: if Paystack isn't configured
 * (or a seller has no destination) the payout stays 'pending' for the admin.
 * Never throws, so it can't break the webhook.
 */
export async function autoPaySellerPayouts(reference: string): Promise<{
  sent: number;
  skipped: number;
}> {
  const tally = { sent: 0, skipped: 0 };
  if (!transferKeysReady()) return tally;

  try {
    const admin = getAdminClient();

    const { data: order } = await admin
      .from("orders")
      .select("id")
      .eq("provider_ref", reference)
      .eq("status", "completed")
      .maybeSingle();
    if (!order) return tally;

    const { data: payouts } = await admin
      .from("payouts")
      .select("id, to")
      .eq("order_id", order.id)
      .eq("role", "seller")
      .eq("status", "pending");

    const verified = await verifiedSellerIds((payouts ?? []).map((p) => String(p.to)));

    for (const p of (payouts ?? []) as Row[]) {
      // Same first-payout gate as autoPayPendingSellerPayouts: an unverified
      // seller's share stays 'pending' for the owner's review, even on the
      // instant-pay path right after a sale completes.
      if (!verified.has(String(p.to ?? ""))) {
        tally.skipped += 1;
        continue;
      }
      try {
        const res = await sendPaystackPayout(String(p.id));
        if (res.ok) tally.sent += 1;
        else tally.skipped += 1;
      } catch (err) {
        tally.skipped += 1;
        console.error("Auto-payout failed for payout", String(p.id), err);
      }
    }
  } catch (err) {
    console.error("autoPaySellerPayouts failed:", err);
  }
  return tally;
}

/** Confirm an OTP-gated Paystack transfer with the business owner's OTP. */
export async function finalizeTransferOtp(
  payoutId: string,
  otp: string
): Promise<TransferResult> {
  const admin = getAdminClient();
  const { data: payout } = await admin
    .from("payouts")
    .select("id, provider_ref")
    .eq("id", payoutId)
    .eq("status", "processing")
    .maybeSingle();
  if (!payout || !payout.provider_ref) {
    return { ok: false, error: "NOT_FOUND", message: "No pending transfer found for this payout." };
  }

  const res = await finalizeTransfer({ transferCode: String(payout.provider_ref), otp: otp.trim() });
  if (!res.ok) {
    return {
      ok: false,
      error: "OTP_REJECTED",
      message: res.message ?? "The OTP was rejected. Check the code and try again.",
    };
  }
  // Finalized — the transfer.success webhook will settle the row, but also
  // mark it here so a lost webhook can't strand it.
  await admin
    .from("payouts")
    .update({
      status: "processing",
      failure_reason: null,
      provider_ref: String(res.data?.transfer_code ?? payout.provider_ref),
    })
    .eq("id", payoutId)
    .eq("status", "processing");
  return { ok: true, transferCode: String(res.data?.transfer_code ?? payout.provider_ref), message: "Transfer confirmed." };
}

/* ------------------------------------------------------------------ */
/* Stuck-payout reconciliation                                        */
/* ------------------------------------------------------------------ */

/** A payout in 'processing' longer than this is presumed stuck (its webhook
 *  was lost) and becomes reconcile-able. */
export const STUCK_PAYOUT_AFTER_MS = 30 * 60 * 1000;

export interface StuckPayoutRow {
  id: string;
  amountKes: number;
  role: string;
  providerRef: string | null;
  /** ISO timestamp of when the send started. */
  since: string;
  recipientPhone: string | null;
  /** The destination method snapshot (M-Pesa / bank) when known. */
  payoutMethod: string | null;
}

/** Find payouts stuck in 'processing' past the stale threshold. Report-only. */
export async function scanStuckPayouts(): Promise<StuckPayoutRow[]> {
  const admin = getAdminClient();
  const { data: payouts } = await admin
    .from("payouts")
    .select(
      `id, amount_kes, role, provider_ref, created_at, processing_started_at, "to", refund_phone, payout_method`
    )
    .eq("status", "processing")
    .limit(100);

  const cutoff = Date.now() - STUCK_PAYOUT_AFTER_MS;
  const stuck = (payouts ?? []).filter((p) => {
    const since = p.processing_started_at
      ? new Date(String(p.processing_started_at))
      : new Date(String(p.created_at));
    return since.getTime() < cutoff;
  });
  if (stuck.length === 0) return [];

  const ids = [
    ...new Set(stuck.map((p) => String(p.to)).filter((t) => t && !t.startsWith("platform:"))),
  ];
  const phoneById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, phone").in("id", ids);
    for (const pr of profiles ?? []) {
      const ph = String(pr.phone ?? "");
      if (ph) phoneById.set(String(pr.id), ph);
    }
  }

  return stuck.map((p) => {
    const since = p.processing_started_at
      ? new Date(String(p.processing_started_at))
      : new Date(String(p.created_at));
    return {
      id: String(p.id),
      amountKes: Number(p.amount_kes ?? 0),
      role: String(p.role ?? "seller"),
      providerRef: p.provider_ref ? String(p.provider_ref) : null,
      since: since.toISOString(),
      recipientPhone:
        phoneById.get(String(p.to)) ?? (p.refund_phone ? String(p.refund_phone) : null),
      payoutMethod: p.payout_method ? String(p.payout_method) : null,
    };
  });
}

/**
 * Ask Paystack for the ground truth on a stuck transfer (provider_ref =
 * transfer_code). Returns 'paid' | 'failed' | 'pending' when Paystack
 * answers, null when it can't be determined.
 */
export async function verifyStuckPayout(payoutId: string): Promise<"paid" | "failed" | "pending" | null> {
  const admin = getAdminClient();
  const { data: payout } = await admin
    .from("payouts")
    .select("provider_ref")
    .eq("id", payoutId)
    .eq("status", "processing")
    .maybeSingle();
  if (!payout?.provider_ref) return null;

  const res = await fetchTransfer(String(payout.provider_ref));
  if (!res.ok || !res.data) return null;

  const status = String(res.data.status ?? "");
  if (status === "success") {
    await admin
      .from("payouts")
      .update({ status: "paid", paid_at: new Date().toISOString(), failure_reason: null })
      .eq("id", payoutId)
      .eq("status", "processing");
    return "paid";
  }
  if (status === "failed" || status === "reversed" || status === "abandoned") {
    await admin
      .from("payouts")
      .update({
        status: "failed",
        failure_reason: `Verified with Paystack: ${String(res.data.gateway_response ?? status)}`,
        processing_started_at: null,
      })
      .eq("id", payoutId)
      .eq("status", "processing");
    return "failed";
  }
  return "pending";
}

/** Admin-verified (not via Paystack): record a stuck payout as paid. */
export async function markStuckPayoutPaid(payoutId: string): Promise<boolean> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("payouts")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      failure_reason: null,
    })
    .eq("id", payoutId)
    .eq("status", "processing")
    .select("id");
  return Boolean(data && data.length > 0);
}

/** Admin-confirmed: the money never went — free the row for a retry. */
export async function markStuckPayoutFailed(payoutId: string, note?: string): Promise<boolean> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("payouts")
    .update({
      status: "failed",
      failure_reason: note?.trim() || "Marked failed during reconciliation",
      processing_started_at: null,
      provider_ref: null,
      recipient_code: null,
    })
    .eq("id", payoutId)
    .eq("status", "processing")
    .select("id");
  return Boolean(data && data.length > 0);
}
