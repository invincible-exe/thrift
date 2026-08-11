import type { PaymentMethod } from "./types";

/**
 * Checkout method metadata for the UI.
 *
 * Payment execution is server-side only: `POST /api/payments/initiate`
 * validates the product and price, records the pending order, and starts the
 * payment (Paystack M-Pesa STK push or card checkout). The webhook / card
 * callback finalizes the order — there is no client-callable `pay()`.
 */

export const mpesaMethod: PaymentMethod = {
  id: "mpesa",
  name: "M-Pesa",
  tagline: "Lipa na M-Pesa",
  description: "Pay instantly from your phone with an STK push.",
};

export const cardMethod: PaymentMethod = {
  id: "card",
  name: "Card",
  tagline: "Visa · Mastercard",
  description: "Pay with any debit or credit card on the secure Paystack page.",
};
