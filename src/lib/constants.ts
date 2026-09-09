export const APP_NAME = "10/10 Thrifts";
export const APP_TAGLINE = "Premium curated thrift.";
export const CURRENCY = "KES";

/** Flat platform commission charged when a community-listed piece sells. */
export const PLATFORM_COMMISSION_RATE = 0.1;

/**
 * Minimum platform take per community sale (KES). Without it a KES 300 piece
 * earns the platform only KES 30 — the floor guarantees every sale pays at
 * least KES 50 (applied as max(10%, floor), never exceeding the price).
 */
export const PLATFORM_COMMISSION_MIN_KES = 50;

/** Flat fee (KES) a seller pays via M-Pesa STK to pin a live piece to the
 *  top of the feed for BOOST_DURATION_DAYS. Server-side only — the client
 *  never decides the boost price. */
export const BOOST_PRICE_KES = 50;

/** How long a paid boost pins a piece to the top of the feed. */
export const BOOST_DURATION_DAYS = 7;

/** Identifier of the platform admin wallet used in payout records. */
export const PLATFORM_WALLET = "platform:admin";

/** Items listed within this window appear under "New Drops" (24h). */
export const NEW_DROP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The seller's meetup window: a buyer can cancel a no-show order once this
 * much time has passed since payment (escrow auto-release sits at 48h).
 */
export const NO_SHOW_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Kenyan MSISDN without the leading +, e.g. 254712345678 */
export const MPESA_PHONE_REGEX = /^2547\d{8}$/;

export const SUPPORT_EMAIL = "1010thriftss@gmail.com";

/** Max video duration sellers can upload (seconds). */
export const MAX_VIDEO_DURATION_SEC = 30;

export const CONDITIONS = ["Brand new", "Like new", "Very good", "Good"] as const;

export const CATEGORIES = [
  "Tops",
  "Trousers",
  "Accessories",
  "Caps",
  "Shoes",
] as const;

/** Returns true when a URL points to a video file (by extension). */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|ogg)(\?|$)/i.test(url);
}
