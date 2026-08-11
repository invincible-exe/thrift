import type { PaymentMethod } from "./types";
import { mpesaMethod, cardMethod } from "./mpesa";
import { PLATFORM_COMMISSION_MIN_KES, PLATFORM_COMMISSION_RATE } from "@/lib/constants";

/** M-Pesa (Paystack mobile money) — the default checkout method. */
export const MPESA_METHOD: PaymentMethod = mpesaMethod;

/** Card (Paystack checkout) — the alternative method. */
export const CARD_METHOD: PaymentMethod = cardMethod;

/** Every checkout method, in UI order. */
export const PAYMENT_METHODS: PaymentMethod[] = [mpesaMethod, cardMethod];

export interface CommissionSplit {
  commission: number;
  sellerShare: number;
  platformShare: number;
}

/**
 * P2P commission routing.
 *  - Platform pieces: 100% of the sale goes to the platform wallet.
 *  - Community pieces: 10% commission (min KES 50) routed to the platform
 *    admin wallet; the remaining ~90% goes to the seller's wallet.
 */
export function computeCommission(priceKes: number, hasSeller: boolean): CommissionSplit {
  if (!hasSeller) {
    return { commission: 0, sellerShare: 0, platformShare: priceKes };
  }
  // Floor the platform take so low-ticket sales still pay something, and
  // clamp so the commission can never exceed the sale price (a sub-50 KES
  // piece nets the seller 0 — never a negative payout).
  const pct = Math.round(priceKes * PLATFORM_COMMISSION_RATE);
  const commission = Math.min(priceKes, Math.max(PLATFORM_COMMISSION_MIN_KES, pct));
  return {
    commission,
    sellerShare: priceKes - commission,
    platformShare: commission,
  };
}
