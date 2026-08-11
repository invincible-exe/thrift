export type ProductCategory =
  | "Trousers"
  | "Tops"
  | "Shoes"
  | "Caps"
  | "Accessories";

export type ProductSource = "platform" | "community";

export interface Product {
  id: string;
  title: string;
  brand: string;
  category: ProductCategory;
  size: string;
  condition: string;
  era?: string;
  priceKes: number;
  imageUrl: string;
  /** Full gallery; imageUrl is always the cover (first entry). */
  imageUrls?: string[];
  description?: string;
  source: ProductSource;
  sellerId?: string | null;
  sellerName?: string | null;
  status: "active" | "sold" | "pending";
  /** The seller's chosen meetup area id (locations table). */
  locationId?: string;
  /** Denormalized "City · Area" string for the meetup area. */
  locationLabel?: string;
  createdAt: Date;
  /** When a paid boost expires (7 days after payment); undefined = not boosted. */
  boostExpiresAt?: Date;
  /** Derived client-side: true while boostExpiresAt is in the future. */
  isBoosted?: boolean;
  /** Derived client-side: true when listed within the NEW_DROP_WINDOW */
  isNewDrop?: boolean;
}

export type OrderStatus = "pending" | "completed" | "failed";
export type PaymentMethodId = "mpesa" | "card" | "bank";

export interface Order {
  id: string;
  productId: string;
  productSnapshot: {
    title: string;
    imageUrl: string;
    brand: string;
    priceKes: number;
    /** The meeting area ("City · Area") suggested for the handoff. */
    meetupPoint?: string;
    /** The seller's display name at time of sale. */
    sellerName?: string;
  };
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  method: PaymentMethodId;
  amountKes: number;
  status: OrderStatus;
  providerRef?: string;
  createdAt: Date;
  /** When the M-Pesa payment completed (starts the no-show window). */
  completedAt?: Date;
  /** Set while the seller's payout is held in escrow awaiting delivery. */
  escrowHeldAt?: Date;
  /** Set once the buyer confirms they received the item (releases escrow). */
  receiptConfirmedAt?: Date;
  /** Set when the buyer files an "I didn't receive it" dispute (pauses escrow). */
  disputedAt?: Date;
  /** Set when the order is cancelled (seller no-show) and the buyer refunded. */
  cancelledAt?: Date;
  /** Who cancelled: 'buyer' | 'admin'. */
  cancelledBy?: string;
}

export interface Payout {
  id: string;
  orderId: string;
  to: string;
  role: "revenue" | "commission" | "seller";
  amountKes: number;
  /** 'escrow' = seller's 90% held until delivery is confirmed / 24h passes. */
  status: "pending" | "escrow" | "processing" | "paid" | "failed";
  providerRef?: string;
  failureReason?: string;
  paidAt?: Date;
  createdAt: Date;
  /** When the escrow auto-releases (now + 48h); null once released/paid. */
  escrowReleaseAt?: Date;
  /** Target M-Pesa number for a `refund` payout (the buyer's payment phone). */
  refundPhone?: string;
}

export interface Listing {
  id: string;
  productId: string;
  title: string;
  brand: string;
  category: ProductCategory;
  size: string;
  priceKes: number;
  imageUrl: string;
  /** Full gallery; imageUrl is always the cover (first entry). */
  imageUrls?: string[];
  status: "active" | "sold" | "pending";
  orderId?: string;
  /** The seller's chosen meetup area id (locations table). */
  locationId?: string;
  /** Denormalized "City · Area" string for the meetup area. */
  locationLabel?: string;
  /** When a paid boost expires; undefined = not boosted. */
  boostExpiresAt?: Date;
  createdAt: Date;
}

/** A county → area meeting point (locations table). The first level holds
 *  the county name (Nairobi, Kiambu, Uasin Gishu…) — Jumia-style. The
 *  landmark column still exists in the DB (rows are seeded per landmark so
 *  each area has a stable id), but the UI is deliberately coarser — area
 *  only. */
export interface Location {
  id: string;
  city: string; // county name (kept as `city` for DB/column compatibility)
  area: string;
  landmark: string;
}

/** One message in a private buyer↔seller order thread. */
export interface OrderMessage {
  id: string;
  orderId: string;
  senderId: string;
  body: string;
  createdAt: Date;
}

/** A buyer's "I didn't receive it" flag on an order. */
export interface OrderDispute {
  id: string;
  orderId: string;
  userId: string;
  reason: string;
  status: "open" | "resolved";
  adminNote?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

/** A seller's paid boost (M-Pesa STK), matched to the callback by
 *  checkout_request_id — the `orders` mirror for boosted listings. */
export interface Boost {
  id: string;
  productId: string;
  listingId?: string;
  sellerId: string;
  amountKes: number;
  status: "pending" | "paid" | "failed";
  checkoutRequestId?: string;
  mpesaReceipt?: string;
  providerRef?: string;
  createdAt: Date;
  paidAt?: Date;
}

export type NotificationType =
  | "listing_approved"
  | "listing_rejected"
  | "new_drop"
  | "payout_paid";

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}

/** A seller's "I never received this payout" flag, queued for the owner. */
export interface PayoutReport {
  id: string;
  payoutId: string;
  userId: string;
  reason: string;
  status: "open" | "resolved";
  adminNote?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

/** A participant's "I'm here" check-in on an order (one per user per order). */
export interface MeetupCheckin {
  id: string;
  orderId: string;
  userId: string;
  checkedInAt: Date;
}

/**
 * An opt-in live location share between an order's two parties. Coordinates
 * are only readable by the participants; every share auto-expires.
 */
export interface MeetupShare {
  id: string;
  orderId: string;
  userId: string;
  lat: number;
  lng: number;
  accuracy: number;
  /** Shares stop being shown once now() passes this. */
  expiresAt: Date;
  updatedAt: Date;
}

