import type { PaymentMethodId } from "@/lib/types";

/**
 * Checkout method metadata for the UI.
 *
 * Payment execution is server-side only: `POST /api/payments/mpesa` validates
 * the product and price, initiates the Paystack charge, and the webhook
 * finalizes the order. There is no client-callable `pay()` anymore — that was
 * the free-purchase bypass.
 */
export interface PaymentMethod {
  id: PaymentMethodId;
  name: string;
  tagline: string;
  description: string;
}
