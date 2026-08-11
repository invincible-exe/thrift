# Payments (Paystack)

10/10 Thrifts accepts payments and pays sellers through **Paystack**
(https://paystack.com) — a CBK-licensed payment provider live in Kenya. It
replaced the direct Safaricom Daraja integration: Paystack handles M-Pesa
STK pushes, card payments, and payouts (Transfers), so the Daraja approvals,
passkeys, B2C certificates and callback gymnastics are gone.

Everything runs through a handful of server routes. There is **no
client-callable "mark this paid"** — the browser can only start a payment;
finalization happens server-side (webhook or verified callback).

---

## Checkout

**Start:** `POST /api/payments/initiate` — `{ productId, method, phone? }`

The server identifies the buyer from the session cookie (never the body),
validates the product + price against the DB, records a `pending` order
keyed by its Paystack reference (`orders.provider_ref`, e.g. `1010-<uuid>`),
and starts the payment:

| method | What happens | Client response |
| ------ | ------------ | --------------- |
| `mpesa` | Paystack `POST /charge` with `mobile_money: { provider: "mpesa", phone }` — an STK push goes to the phone | `{ kind: "stk", orderId }` — the UI watches the order row |
| `card`  | Paystack `POST /transaction/initialize` returns `authorization_url` | `{ kind: "redirect", orderId, authorizationUrl }` — the browser is redirected |

**Settle:** either the `charge.success` webhook or (for cards) the return
callback at `GET /api/payments/card/callback?reference=…` verifies the
transaction with Paystack and calls `finalize_order_by_reference` — which
verifies the exact amount in SQL before completing the order, deleting the
1-of-1, and routing payouts. A `missing-product` (piece sold to someone
else between charge and webhook) fails the order so the buyer's refund can
be processed.

**Boosted listings** use the identical flow via `POST /api/payments/boost`
(flat `BOOST_PRICE_KES`, server-decided), recorded in `boosts.provider_ref`
and finalized by `finalize_boost_by_reference` — no payment, no boost.

### Webhook

Point the Paystack dashboard → Settings → Webhooks URL at:

    https://your-domain.com/api/payments/paystack-webhook

Events handled:

- `charge.success` → finalize the matching order or boost (amount-verified)
- `transfer.success` / `transfer.failed` → settle the payout row

The handler verifies the `x-paystack-signature` header (HMAC-SHA512 of the
raw body with the secret key) before trusting anything; invalid signatures
get 401 and Paystack retries.

---

## Payouts (Transfers)

Sellers choose where their earnings land on **My Account** (Payout details):

- **M-Pesa** (default) — just a phone number
- **Bank** — Paystack KES bank list (proxied at `GET /api/payouts/banks`),
  account number, account name

The flow (admin Settlements "Pay out" button, or the automatic dispatch that
fires when escrow releases):

1. `POST /api/payouts/transfer` (admin) → `sendPaystackPayout` claims the
   row (`pending → processing` — atomic, concurrent calls can't double-pay)
   and creates a Paystack recipient:
   - M-Pesa: `type: mobile_money`, `bank_code: MPESA`, local `07…` phone
   - Bank: `type: bank`, the chosen `bank_code`, account details
2. `POST /transfer` (source `balance`, KES) is initiated; the transfer_code
   is stored as `provider_ref` (+ `recipient_code` / `payout_method`
   snapshots).
3. The `transfer.success` / `transfer.failed` webhook flips the payout.

**OTP:** Paystack may require an OTP to release a transfer (it sends a code
to the business phone). The initiate response then has `status: "otp"` and
the admin confirms via `POST /api/payouts/finalize` (`{ payoutId, otp }`) →
`POST /transfer/finalize_transfer`. You can disable the OTP requirement in
the Paystack dashboard (Transfers settings) once recipients are trusted.

### Escrow still works unchanged

The seller's 90% is held in the `payouts` table (status `escrow`) by the DB
trigger until the buyer confirms delivery or the 24h auto-resolve passes
(`release_expired_escrow`). Only then does it become `pending` and get paid
out. The Paystack balance itself can be held with **Manual Payouts** in the
dashboard for extra control.

### Stuck payouts

`POST /api/payouts/reconcile` (admin): `scan` lists rows stuck in
`processing` past 30 min; **`verify`** asks Paystack for ground truth via
`GET /transfer/<transfer_code>` and settles the row automatically when
Paystack confirms success/failure; `markPaid` / `markFailed` record a
manually verified outcome. Only `processing` rows are ever touched.

---

## Environment variables

| Var | Public? | Purpose |
| --- | ------- | ------- |
| `PAYSTACK_SECRET_KEY` | **no** | `sk_test_…` / `sk_live_…` — checkout + payouts + webhook verification |
| `PAYSTACK_CARD_CALLBACK_URL` | no | `https://your-domain.com/api/payments/card/callback` |
| `ALLOW_SIMULATED_MPESA` | no | dev-only simulation when the key is absent; never set in production |

Legacy Daraja vars (`MPESA_ENV`, `MPESA_CONSUMER_KEY/SECRET`,
`MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, `MPESA_B2C_*`) are
no longer read by new code — they can be deleted once historical rows are
reconciled.

### SQL

Run `supabase/migrations/0014_paystack.sql` (payout columns + the
reference-based finalize/fail functions). The old Daraja functions
(`finalize_by_checkout_request`, `finalize_boost`, …) stay in the DB for
historical rows.

## Testing

- **Test mode:** a `sk_test_…` key + Paystack test cards (e.g.
  4084 0840 8408 4081) exercise the full card flow; M-Pesa test charges work
  in test mode with the test phone numbers Paystack provides.
- **Local dev without a key:** set `ALLOW_SIMULATED_MPESA=true` — checkout
  and boosts finalize server-side through the same service-role RPCs.
- **Fees (KES):** M-Pesa ~1.5%, local cards 2.9%, international 3.8% per
  transaction; transfers are tiered (M-Pesa B2C ≈ KES 20–60). Paystack
  Kenya requires a Registered Business for transfers (Starter tier caps at
  KES 600,000 collected before upgrade).
