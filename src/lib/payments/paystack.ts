import { createHmac, timingSafeEqual } from "crypto";

/**
 * Paystack API helpers (server-only — never import from a client component).
 *
 * Replaces the direct Safaricom Daraja integration: Paystack accepts M-Pesa
 * (STK push) and cards in Kenya, settles to your Paystack balance, and pays
 * sellers via Paystack Transfers (M-Pesa wallet or bank). All calls are
 * authenticated with the secret key; amounts are in KES subunits (×100).
 *
 * Paystack does not exist in the Gravity Index catalog — set up your
 * account at paystack.com, then put the key in PAYSTACK_SECRET_KEY.
 */

export const PAYSTACK_BASE = "https://api.paystack.co";

/** The Paystack secret key (sk_test_… / sk_live_…), or "" when unset. */
export function paystackSecret(): string {
  return process.env.PAYSTACK_SECRET_KEY ?? "";
}

/** True when the secret key looks like a real Paystack key. */
export function paystackKeysReady(): boolean {
  return paystackSecret().startsWith("sk_");
}

/** Public URL Paystack redirects the buyer to after a card payment. */
export function paystackCardCallbackUrl(): string {
  return process.env.PAYSTACK_CARD_CALLBACK_URL ?? "";
}

/** Normalize a Kenyan phone number to E.164 (+254…), e.g. 0712345678 → +254712345678. */
export function normalizeE164(phone: string): string {
  let p = phone.replace(/[^0-9]/g, "");
  if (p.startsWith("0")) p = `254${p.slice(1)}`;
  if (!p.startsWith("254")) p = `254${p}`;
  return `+${p}`;
}

/** Local format for Paystack M-Pesa transfer recipients (07…). */
export function toLocalPhone(phone: string): string {
  const e = normalizeE164(phone).replace(/^\+/, "");
  return e.startsWith("2547") ? `0${e.slice(3)}` : e;
}

/** The Paystack `data` envelope — known fields typed, anything else unknown. */
export interface PaystackData {
  [key: string]: unknown;
  reference?: string;
  authorization_url?: string;
  recipient_code?: string;
  transfer_code?: string;
  status?: string;
  amount?: number;
  currency?: string;
  gateway_response?: string;
}

export interface PaystackApiResult {
  ok: boolean;
  status: number;
  message?: string;
  data?: PaystackData;
}

async function api(path: string, init?: RequestInit): Promise<PaystackApiResult> {
  const secret = paystackSecret();
  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    // Network failure (timeout, DNS, connection refused) must never bubble
    // up as a 500 — every caller treats `ok: false` as "temporarily
    // unavailable" and responds gracefully (e.g. 502 with a retry hint).
    console.error(`Paystack request failed (${path}):`, err);
    return { ok: false, status: 0, message: "Paystack is unreachable. Try again shortly." };
  }
  const body = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: PaystackData;
  };
  return {
    ok: res.ok && body.status !== false,
    status: res.status,
    message: body.message,
    data: body.data,
  };
}

/** M-Pesa STK push: Paystack charges the phone and the customer approves on
 *  their phone; the charge.success webhook confirms completion. */
export function chargeMpesa(opts: {
  email: string;
  amountKes: number;
  reference: string;
  phone: string;
}): Promise<PaystackApiResult> {
  return api("/charge", {
    method: "POST",
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountKes * 100,
      currency: "KES",
      reference: opts.reference,
      mobile_money: { provider: "mpesa", phone: opts.phone },
    }),
  });
}

/** Card checkout: returns an authorization_url the buyer is redirected to. */
export function initializeCardTransaction(opts: {
  email: string;
  amountKes: number;
  reference: string;
  callbackUrl: string;
}): Promise<PaystackApiResult> {
  return api("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountKes * 100,
      currency: "KES",
      reference: opts.reference,
      callback_url: opts.callbackUrl,
    }),
  });
}

/** Server-side verification of a payment (used by the card callback). */
export function verifyTransaction(reference: string): Promise<PaystackApiResult> {
  return api(`/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Create a transfer recipient. M-Pesa: type 'mobile_money', bank_code
 *  'MPESA', account_number in local 07… format. Bank: type 'bank' with the
 *  Paystack KES bank code from /bank?currency=KES. */
export function createTransferRecipient(opts: {
  type: "mobile_money" | "bank";
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<PaystackApiResult> {
  return api("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({
      type: opts.type,
      name: opts.name,
      account_number: opts.accountNumber,
      bank_code: opts.bankCode,
      currency: "KES",
    }),
  });
}

/** Initiate a payout from the balance. May come back status 'otp' (confirm
 *  via finalizeTransfer with the OTP sent to the business owner). */
export function initiateTransfer(opts: {
  amountKes: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<PaystackApiResult> {
  return api("/transfer", {
    method: "POST",
    body: JSON.stringify({
      source: "balance",
      amount: opts.amountKes * 100,
      currency: "KES",
      recipient: opts.recipientCode,
      reference: opts.reference,
      reason: opts.reason,
    }),
  });
}

/** Confirm an OTP-gated transfer. */
export function finalizeTransfer(opts: {
  transferCode: string;
  otp: string;
}): Promise<PaystackApiResult> {
  return api("/transfer/finalize_transfer", {
    method: "POST",
    body: JSON.stringify({ transfer_code: opts.transferCode, otp: opts.otp }),
  });
}

/** Fetch a transfer by its transfer_code (accepts id_or_code). */
export function fetchTransfer(code: string): Promise<PaystackApiResult> {
  return api(`/transfer/${encodeURIComponent(code)}`);
}

/** The list of Paystack KES banks (for the seller's payout form). */
export function listBanks(): Promise<PaystackApiResult> {
  return api("/bank?currency=KES");
}

/** Verify a Paystack webhook: HMAC-SHA512 of the raw body with the secret. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = paystackSecret();
  if (!secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
