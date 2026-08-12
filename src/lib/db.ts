import { useEffect, useState } from "react";
import { getBrowserClient, isSupabaseConfigured } from "./supabase/client";
import type {
  AppNotification,
  Listing,
  Location,
  MeetupCheckin,
  MeetupShare,
  Order,
  OrderDispute,
  OrderMessage,
  Payout,
  PayoutReport,
  PaymentMethodId,
  Product,
  ProductCategory,
} from "./types";
import { NEW_DROP_WINDOW_MS, PLATFORM_WALLET } from "./constants";

type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Row → model mappers (module-level so hooks can depend on them)      */
/* ------------------------------------------------------------------ */

function toDate(v: unknown): Date {
  if (!v) return new Date(0);
  if (typeof v === "string") return new Date(v);
  if (typeof v === "number") return new Date(v);
  return new Date(0);
}

function productFromRow(row: Row): Product {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? "Untitled"),
    brand: String(row.brand ?? ""),
    category: (row.category ?? "Tops") as ProductCategory,
    size: String(row.size ?? "M"),
    condition: String(row.condition ?? "Very good"),
    era: row.era ? String(row.era) : undefined,
    priceKes: Number(row.price_kes ?? 0),
    imageUrl: String(row.image_url ?? ""),
    imageUrls: Array.isArray(row.image_urls)
      ? (row.image_urls as string[])
      : row.image_url
        ? [String(row.image_url)]
        : undefined,
    description: row.description ? String(row.description) : undefined,
    source: row.source === "community" ? "community" : "platform",
    sellerId: row.seller_id ? String(row.seller_id) : null,
    sellerName: row.seller_name ? String(row.seller_name) : null,
    status: row.status === "sold" ? "sold" : row.status === "pending" ? "pending" : "active",
    createdAt: toDate(row.created_at),
    boostExpiresAt: row.boost_expires_at ? toDate(row.boost_expires_at) : undefined,
    locationId: row.location_id ? String(row.location_id) : undefined,
    locationLabel: row.location_label ? String(row.location_label) : undefined,
  };
}

function orderFromRow(row: Row): Order {
  const snap = (row.product_snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    productId: row.product_id ? String(row.product_id) : "",
    productSnapshot: {
      title: String(snap.title ?? ""),
      imageUrl: String(snap.imageUrl ?? ""),
      brand: String(snap.brand ?? ""),
      priceKes: Number(snap.priceKes ?? 0),
      meetupPoint: snap.meetupPoint ? String(snap.meetupPoint) : undefined,
      sellerName: snap.sellerName ? String(snap.sellerName) : undefined,
    },
    buyerId: row.buyer_id ? String(row.buyer_id) : "",
    buyerName: String(row.buyer_name ?? ""),
    buyerEmail: String(row.buyer_email ?? ""),
    method: (row.method ?? "mpesa") as PaymentMethodId,
    amountKes: Number(row.amount_kes ?? 0),
    status: (row.status ?? "pending") as Order["status"],
    providerRef: row.provider_ref ? String(row.provider_ref) : undefined,
    createdAt: toDate(row.created_at),
    completedAt: row.completed_at ? toDate(row.completed_at) : undefined,
    escrowHeldAt: row.escrow_held_at ? toDate(row.escrow_held_at) : undefined,
    receiptConfirmedAt: row.receipt_confirmed_at
      ? toDate(row.receipt_confirmed_at)
      : undefined,
    disputedAt: row.disputed_at ? toDate(row.disputed_at) : undefined,
    cancelledAt: row.cancelled_at ? toDate(row.cancelled_at) : undefined,
    cancelledBy: row.cancelled_by ? String(row.cancelled_by) : undefined,
  };
}

function payoutFromRow(row: Row): Payout {
  return {
    id: String(row.id ?? ""),
    orderId: row.order_id ? String(row.order_id) : "",
    to: String(row.to ?? ""),
    role: (row.role ?? "seller") as Payout["role"],
    amountKes: Number(row.amount_kes ?? 0),
    status:
      row.status === "paid"
        ? "paid"
        : row.status === "failed"
          ? "failed"
          : row.status === "processing"
            ? "processing"
            : row.status === "escrow"
              ? "escrow"
              : "pending",
    providerRef: row.provider_ref ? String(row.provider_ref) : undefined,
    failureReason: row.failure_reason ? String(row.failure_reason) : undefined,
    paidAt: row.paid_at ? toDate(row.paid_at) : undefined,
    createdAt: toDate(row.created_at),
    escrowReleaseAt: row.escrow_release_at ? toDate(row.escrow_release_at) : undefined,
    refundPhone: row.refund_phone ? String(row.refund_phone) : undefined,
  };
}

function locationFromRow(row: Row): Location {
  return {
    id: String(row.id ?? ""),
    city: String(row.city ?? ""),
    area: String(row.area ?? ""),
    landmark: String(row.landmark ?? ""),
  };
}

function messageFromRow(row: Row): OrderMessage {
  return {
    id: String(row.id ?? ""),
    orderId: String(row.order_id ?? ""),
    senderId: String(row.sender_id ?? ""),
    body: String(row.body ?? ""),
    createdAt: toDate(row.created_at),
  };
}

function checkinFromRow(row: Row): MeetupCheckin {
  return {
    id: String(row.id ?? ""),
    orderId: String(row.order_id ?? ""),
    userId: String(row.user_id ?? ""),
    checkedInAt: toDate(row.checked_in_at),
  };
}

function shareFromRow(row: Row): MeetupShare {
  return {
    id: String(row.id ?? ""),
    orderId: String(row.order_id ?? ""),
    userId: String(row.user_id ?? ""),
    lat: Number(row.lat ?? 0),
    lng: Number(row.lng ?? 0),
    accuracy: Number(row.accuracy ?? 0),
    expiresAt: toDate(row.expires_at),
    updatedAt: toDate(row.updated_at),
  };
}

function disputeFromRow(row: Row): OrderDispute {
  return {
    id: String(row.id ?? ""),
    orderId: String(row.order_id ?? ""),
    userId: String(row.user_id ?? ""),
    reason: String(row.reason ?? ""),
    status: row.status === "resolved" ? "resolved" : "open",
    adminNote: row.admin_note ? String(row.admin_note) : undefined,
    createdAt: toDate(row.created_at),
    resolvedAt: row.resolved_at ? toDate(row.resolved_at) : undefined,
  };
}

function notificationFromRow(row: Row): AppNotification {
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    type: (
      row.type === "new_drop"
        ? "new_drop"
        : row.type === "listing_rejected"
          ? "listing_rejected"
          : row.type === "payout_paid"
            ? "payout_paid"
            : "listing_approved"
    ) as AppNotification["type"],
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    read: Boolean(row.read),
    createdAt: toDate(row.created_at),
  };
}

function payoutReportFromRow(row: Row): PayoutReport {
  return {
    id: String(row.id ?? ""),
    payoutId: row.payout_id ? String(row.payout_id) : "",
    userId: String(row.user_id ?? ""),
    reason: String(row.reason ?? ""),
    status: row.status === "resolved" ? "resolved" : "open",
    adminNote: row.admin_note ? String(row.admin_note) : undefined,
    createdAt: toDate(row.created_at),
    resolvedAt: row.resolved_at ? toDate(row.resolved_at) : undefined,
  };
}

function listingFromRow(row: Row): Listing {
  return {
    id: String(row.id ?? ""),
    productId: row.product_id ? String(row.product_id) : "",
    title: String(row.title ?? "Untitled"),
    brand: String(row.brand ?? ""),
    category: (row.category ?? "Tops") as ProductCategory,
    size: String(row.size ?? ""),
    priceKes: Number(row.price_kes ?? 0),
    imageUrl: String(row.image_url ?? ""),
    imageUrls: Array.isArray(row.image_urls)
      ? (row.image_urls as string[])
      : row.image_url
        ? [String(row.image_url)]
        : undefined,
    status: row.status === "sold" ? "sold" : row.status === "pending" ? "pending" : "active",
    orderId: row.order_id ? String(row.order_id) : undefined,
    createdAt: toDate(row.created_at),
    boostExpiresAt: row.boost_expires_at ? toDate(row.boost_expires_at) : undefined,
    locationId: row.location_id ? String(row.location_id) : undefined,
    locationLabel: row.location_label ? String(row.location_label) : undefined,
  };
}

/**
 * Derive the time-based flags on every product. Both are recomputed against
 * `now` so pieces age out of New Drops and boosts lapse on their own even
 * if the page stays open (the 60s refresh in useProducts keeps this fresh).
 */
function withProductFlags(products: Product[], now = Date.now()): Product[] {
  return products.map((p) => ({
    ...p,
    isNewDrop: now - p.createdAt.getTime() < NEW_DROP_WINDOW_MS,
    isBoosted: Boolean(p.boostExpiresAt && p.boostExpiresAt.getTime() > now),
  }));
}

/* ------------------------------------------------------------------ */
/* Shared realtime plumbing                                            */
/* ------------------------------------------------------------------ */

/**
 * Unique channel name per subscription call. Supabase caches channels by
 * name, and React StrictMode (default in App Router dev) mounts effects
 * twice — reusing a cached, already-subscribed channel throws "cannot add
 * postgres_changes callbacks ... after subscribe()". A per-call suffix
 * sidesteps the collision entirely; cleanup still removes the channel.
 */
let realtimeChannelSeq = 0;
function uniqueChannelName(base: string): string {
  realtimeChannelSeq += 1;
  return `${base}:${realtimeChannelSeq}`;
}

/** Loose builder shape for dynamic-table queries (avoids explicit any). */
interface LooseQueryResult {
  data: Row[] | null;
  error: { message: string } | null;
}

interface LooseQuery {
  select(columns?: string): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  order(column: string, opts: { ascending: boolean }): LooseQuery;
  limit(count: number): Promise<LooseQueryResult>;
}

/**
 * Fetch a table's rows and refetch on any realtime change, optionally
 * filtered by one column. Falls back to preview data in demo mode.
 */
function useRealtimeRows<T>(
  table: string,
  mapper: (row: Row) => T,
  options: {
    filterColumn?: string;
    filterValue?: string | null;
    orderColumn?: string;
    max?: number;
  } = {}
): T[] | null {
  const { filterColumn, filterValue, orderColumn = "created_at", max = 80 } = options;
  const [rows, setRows] = useState<T[] | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (filterColumn && !filterValue) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const load = async () => {
      // Dynamic table name — the loose builder keeps the chain type-safe
      // enough without an explicit `any`.
      const q = (client as unknown as { from: (t: string) => LooseQuery }).from(table);
      const query =
        filterColumn && filterValue ? q.select("*").eq(filterColumn, filterValue) : q.select("*");
      const { data, error } = await query.order(orderColumn, { ascending: false }).limit(max);
      if (!active) return;
      if (error) {
        console.error(`${table} fetch failed:`, error);
        setRows([]);
        return;
      }
      setRows((data ?? []).map((r) => mapper(r as Row)));
    };

    load();

    const filter = filterColumn && filterValue ? `${filterColumn}=eq.${filterValue}` : undefined;
    const channel = client
      .channel(uniqueChannelName(`${table}:${filter ?? "all"}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [table, mapper, filterColumn, filterValue, orderColumn, max]);

  return rows;
}

/* ------------------------------------------------------------------ */
/* Products (public feed)                                              */
/* ------------------------------------------------------------------ */

/**
 * Real-time product feed. Browsing is completely un-gated. Live data only —
 * without Supabase configured the feed stays empty (never demo content).
 */
export function useProducts(): Product[] | null {
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const load = async () => {
      const { data, error } = await client
        .from("products")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(80);
      if (!active) return;
      if (error) {
        console.error("products fetch failed:", error);
        setProducts([]);
        return;
      }
      setProducts(
        withProductFlags((data ?? []).map((r) => productFromRow(r as unknown as Row)), Date.now())
      );
    };

    load();

    // Age pieces out of the New Drops section mid-session: the flag is
    // normally only recomputed on load/realtime events, which would leave a
    // piece in the carousel past its 24h window if the page stays open.
    // State is only updated when something actually crosses the boundary,
    // so this never causes needless re-renders.
    const refreshNewDrops = setInterval(() => {
      if (!active) return;
      setProducts((prev) => {
        if (!prev) return prev;
        const refreshed = withProductFlags(prev, Date.now());
        const changed = refreshed.some(
          (p, i) => p.isNewDrop !== prev[i]?.isNewDrop || p.isBoosted !== prev[i]?.isBoosted
        );
        return changed ? refreshed : prev;
      });
    }, 60_000);

    const channel = client
      .channel(uniqueChannelName("public:products"))
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () =>
        load()
      )
      .subscribe();

    return () => {
      active = false;
      clearInterval(refreshNewDrops);
      client.removeChannel(channel);
    };
  }, []);

  return products;
}

/* ------------------------------------------------------------------ */
/* Seller closet (view a seller's other pieces)                        */
/* ------------------------------------------------------------------ */

/**
 * A seller's other live pieces — powers the "view seller's closet" modal
 * on the feed. Filters to active community pieces by that seller; the
 * currently-viewed piece is excluded so the buyer sees what else they have.
 */
export function useSellerPieces(sellerId: string | null, excludeId?: string): Product[] | null {
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    if (!sellerId || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const load = async () => {
      const { data, error } = await client
        .from("products")
        .select("*")
        .eq("seller_id", sellerId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(40);
      if (!active) return;
      if (error) {
        console.error("seller products fetch failed:", error);
        setProducts([]);
        return;
      }
      const filtered = (data ?? [])
        .map((r) => productFromRow(r as unknown as Row))
        .filter((p) => p.id !== excludeId);
      setProducts(withProductFlags(filtered, Date.now()));
    };

    load();

    // Scoped to this seller's rows so unrelated feed changes don't re-fetch
    // the whole closet while the buyer is browsing it.
    const channel = client
      .channel(uniqueChannelName(`seller:${sellerId}`))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
          filter: `seller_id=eq.${sellerId}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [sellerId, excludeId]);

  return products;
}

/* ------------------------------------------------------------------ */
/* Purchases — the 1-of-1 inventory rule lives in the DB                */
/* ------------------------------------------------------------------ */

// Purchases are server-side only now: POST /api/payments/mpesa validates the
// product + price, pushes the STK, and the callback webhook finalizes the
// order. The `purchase_product` RPC is service-role only, so the browser can
// never complete a purchase on its own.

/* ------------------------------------------------------------------ */
/* P2P marketplace                                                     */
/* ------------------------------------------------------------------ */

export interface NewListingInput {
  item: {
    title: string;
    brand: string;
    category: ProductCategory;
    size: string;
    condition: string;
    priceKes: number;
    imageUrl: string;
    imageUrls: string[];
    description?: string;
    /** Seller's meetup area id (locations table, first row of the area). */
    locationId?: string | null;
    /** Denormalized "City · Area" string shown to buyers. */
    locationLabel?: string | null;
  };
}

/** List a piece for sale (creator is the signed-in user). */
export async function createListing(input: NewListingInput): Promise<string> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const base = {
    p_title: input.item.title,
    p_brand: input.item.brand,
    p_category: input.item.category,
    p_size: input.item.size,
    p_condition: input.item.condition,
    p_price_kes: input.item.priceKes,
    p_image_url: input.item.imageUrl,
    p_description: input.item.description ?? null,
    p_location_id: input.item.locationId ?? null,
    p_location_label: input.item.locationLabel ?? null,
  };
  // Fresh deployments accept the photo gallery (p_image_urls). Databases that
  // haven't re-run the migration only take a single cover URL, so if the RPC
  // rejects the gallery param we retry with just the cover — sellers aren't
  // blocked by a stale schema.
  const { data, error } = await client.rpc("create_listing", {
    ...base,
    p_image_urls: input.item.imageUrls,
  });
  if (error) {
    const msg = String(error.message ?? "");
    if (/could not find the function|p_image_urls/i.test(msg)) {
      const fallback = await client.rpc("create_listing", base);
      if (!fallback.error) return String(fallback.data);
    }
    // Throw a real Error with the PostgREST message so callers can display
    // it (a raw PostgrestError object stringifies to "[object Object]").
    throw new Error(msg || "Could not create the listing.");
  }
  return String(data);
}

export interface UploadedImage {
  /** Public URL to store on the product. */
  url: string;
  /** Storage path — kept so a failed listing can clean the file up. */
  path: string;
}

/**
 * Uploads a listing photo via the server (service-role) — the route creates
 * the `product-images` bucket on first use and bypasses storage RLS, so
 * uploads work even if the migration's storage section hasn't run yet.
 */
export async function uploadProductImage(userId: string, file: File): Promise<UploadedImage> {
  if (!isSupabaseConfigured) throw new Error("SUPABASE_NOT_CONFIGURED");
  const form = new FormData();
  form.append("file", file);
  // Mobile connections drop mid-upload all the time — retry once before
  // giving up, so a single blip doesn't kill the whole listing.
  let res: Response;
  try {
    res = await fetch("/api/storage/upload", { method: "POST", body: form });
  } catch {
    await new Promise((r) => setTimeout(r, 1200));
    res = await fetch("/api/storage/upload", { method: "POST", body: form });
  }
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    path?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.url || !data.path) {
    throw new Error(data.message ?? data.error ?? "Photo upload failed.");
  }
  return { url: data.url, path: data.path };
}

/** Best-effort removal of an uploaded photo (e.g. when a listing fails). */
export async function removeProductImage(path: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await fetch("/api/storage/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch {
    // Nothing to do — an orphaned object is better than a failed flow.
  }
}



/* ------------------------------------------------------------------ */
/* Notifications (listing approved / rejected)                       */
/* ------------------------------------------------------------------ */

export function useNotifications(uid: string | null): AppNotification[] | null {
  return useRealtimeRows("notifications", notificationFromRow, {
    filterColumn: "user_id",
    filterValue: uid,
    max: 30,
  });
}

/** Mark every unread notification for the user as read. */
export async function markNotificationsRead(uid: string): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client
    .from("notifications")
    .update({ read: true })
    .eq("user_id", uid)
    .eq("read", false);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Area drop alerts (county watch list)                                */
/* ------------------------------------------------------------------ */

/**
 * The location ids the user has the drop-alert bell on. Realtime-subscribed
 * so toggling from one tab reflects everywhere immediately.
 */
export function useLocationAlerts(uid: string | null): string[] | null {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!uid || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const load = async () => {
      const { data, error } = await client
        .from("location_alerts")
        .select("location_id")
        .eq("user_id", uid);
      if (!active) return;
      if (error) {
        setIds([]);
        return;
      }
      setIds((data ?? []).map((r) => String(r.location_id)));
    };

    load();

    const channel = client
      .channel(uniqueChannelName(`location_alerts:${uid}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "location_alerts", filter: `user_id=eq.${uid}` },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [uid]);

  return ids;
}

/** Subscribe / unsubscribe the user to drop alerts for a location (county). */
export async function toggleLocationAlert(
  uid: string,
  locationId: string,
  subscribed: boolean
): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  if (subscribed) {
    const { error } = await client.from("location_alerts").insert({
      user_id: uid,
      location_id: locationId,
    });
    if (error) throw error;
  } else {
    const { error } = await client
      .from("location_alerts")
      .delete()
      .eq("user_id", uid)
      .eq("location_id", locationId);
    if (error) throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Account data (orders, listings, payouts)                          */
/* ------------------------------------------------------------------ */

export function useUserOrders(uid: string | null): Order[] | null {
  return useRealtimeRows("orders", orderFromRow, {
    filterColumn: "buyer_id",
    filterValue: uid,
    max: 50,
  });
}

export function useUserListings(uid: string | null): Listing[] | null {
  return useRealtimeRows("listings", listingFromRow, {
    filterColumn: "seller_id",
    filterValue: uid,
    max: 50,
  });
}

export function useUserPayouts(uid: string | null): Payout[] | null {
  return useRealtimeRows("payouts", payoutFromRow, {
    filterColumn: "to",
    filterValue: uid,
    max: 100,
  });
}

/** Payout reports the current user has filed ("never received this"). */
export function useUserPayoutReports(uid: string | null): PayoutReport[] | null {
  return useRealtimeRows("payout_reports", payoutReportFromRow, {
    filterColumn: "user_id",
    filterValue: uid,
    max: 50,
  });
}

/** All payout reports — the admin settlements support queue. */
export function usePayoutReports(): PayoutReport[] | null {
  return useRealtimeRows("payout_reports", payoutReportFromRow, { max: 100 });
}

/**
 * Buyer confirms they received an item, releasing the seller's escrowed 90%
 * into the payout queue. The RPC verifies the caller is the order's buyer.
 * Returns the number of payouts released. Throws an Error with the server
 * message on failure.
 */
export async function confirmOrderReceipt(orderId: string): Promise<number> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("confirm_receipt", {
    p_order_id: orderId,
  });
  if (error) throw new Error(String(error.message ?? "Could not confirm receipt."));
  return Number(data ?? 0);
}

/**
 * Releases any seller payouts whose 24h escrow window has elapsed (buyer
 * silence = received). The RPC only touches payouts past their deadline.
 * Returns how many were released. Safe for any signed-in user to call — the
 * app sweeps this on page load so no cron is needed.
 */
export async function releaseExpiredEscrow(): Promise<number> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("release_expired_escrow");
  if (error) throw new Error(String(error.message ?? "Could not sweep escrow."));
  return Number(data ?? 0);
}

/**
 * File a report that a payout was never received. The server RPC verifies
 * the payout belongs to the caller and dedupes to one open report per
 * payout. Throws an Error with the server message on failure.
 */
export async function reportPayoutMissing(
  payoutId: string,
  reason?: string
): Promise<string> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("report_payout", {
    p_payout_id: payoutId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(String(error.message ?? "Could not file the report."));
  return String(data);
}

/** Admin: mark a payout report resolved (with an optional note). */
export async function resolvePayoutReportAdmin(reportId: string, note?: string): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.rpc("admin_resolve_payout_report", {
    p_report_id: reportId,
    p_admin_note: note ?? null,
  });
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Wishlist                                                            */
/* ------------------------------------------------------------------ */

export function useWishlistIds(uid: string | null): string[] | null {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!uid || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const load = async () => {
      const { data, error } = await client
        .from("wishlists")
        .select("product_id")
        .eq("user_id", uid);
      if (!active) return;
      if (error) {
        setIds([]);
        return;
      }
      setIds((data ?? []).map((r) => String(r.product_id)));
    };

    load();

    const channel = client
      .channel(uniqueChannelName(`wishlists:user_id=eq.${uid}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wishlists", filter: `user_id=eq.${uid}` },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [uid]);

  return ids;
}

/** Add or remove a piece from the user's wishlist. */
export async function toggleWishlist(
  uid: string,
  productId: string,
  currentlySaved: boolean
): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  if (currentlySaved) {
    const { error } = await client
      .from("wishlists")
      .delete()
      .eq("user_id", uid)
      .eq("product_id", productId);
    if (error) throw error;
  } else {
    const { error } = await client.from("wishlists").insert({
      user_id: uid,
      product_id: productId,
    });
    if (error) throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Admin dashboard data                                                */
/* ------------------------------------------------------------------ */

export function useAllProducts(): Product[] | null {
  return useRealtimeRows("products", productFromRow, { max: 200 });
}

/** A profile row the admin dashboard needs (no phone/email — least data). */
export interface ProfileStat {
  id: string;
  name: string;
  locationId: string | null;
  createdAt: Date;
}

// Module-level so the realtime hook's `mapper` dep stays stable (an inline
// arrow would tear down + re-subscribe the channel on every admin render).
function profileStatFromRow(row: Row): ProfileStat {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    locationId: row.location_id ? String(row.location_id) : null,
    createdAt: toDate(row.created_at),
  };
}

/**
 * Every profile row (admin only — RLS `profiles_read` lets admins see all).
 * Powers the Locations & coverage dashboard: which areas buyers live in,
 * which counties are underserved, etc. Realtime-updated so a new sign-up
 * (or area change) shows up without a refresh.
 */
export function useAllProfiles(): ProfileStat[] | null {
  return useRealtimeRows("profiles", profileStatFromRow, { max: 1000 });
}

export function usePlatformPayouts(): { payouts: Payout[] | null; denied: boolean } {
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  // Unconfigured Supabase is a known synchronous state — no effect needed.
  const [denied, setDenied] = useState(() => !isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const load = async () => {
      const { data, error } = await client
        .from("payouts")
        .select("*")
        .eq("to", PLATFORM_WALLET)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!active) return;
      if (error) {
        if (String(error.message).toLowerCase().includes("row level security")) {
          setDenied(true);
        }
        setPayouts([]);
        return;
      }
      setPayouts((data ?? []).map((r) => payoutFromRow(r as unknown as Row)));
    };

    load();

    const channel = client
      .channel(uniqueChannelName("platform:payouts"))
      .on("postgres_changes", { event: "*", schema: "public", table: "payouts" }, () =>
        load()
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, []);

  return { payouts, denied };
}

/** All seller payouts (role = 'seller') — used by the admin settlements view. */
export function useSellerPayouts(): Payout[] | null {
  return useRealtimeRows("payouts", payoutFromRow, {
    filterColumn: "role",
    filterValue: "seller",
    max: 100,
  });
}

/** Refund payouts owed back to buyers (role = 'refund') — admin refunds view. */
export function useRefundPayouts(): Payout[] | null {
  return useRealtimeRows("payouts", payoutFromRow, {
    filterColumn: "role",
    filterValue: "refund",
    max: 100,
  });
}

/** All orders — the admin dispute queue (links disputes to their order). */
export function useAllOrders(): Order[] | null {
  return useRealtimeRows("orders", orderFromRow, { max: 200 });
}

/**
 * Admin-triggered Paystack Transfer for a pending seller payout row. The
 * server initiates the transfer (M-Pesa wallet or bank per the seller's
 * profile); the transfer.success/failed webhook (or reconcile Verify)
 * settles it. Returns a friendly result; otpRequired means the admin must
 * enter the OTP Paystack sent to the business phone via finalizePayoutOtp.
 */
export async function requestPayout(
  payoutId: string
): Promise<{ ok: boolean; message: string; otpRequired?: boolean; transferCode?: string }> {
  const res = await fetch("/api/payouts/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payoutId }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    otpRequired?: boolean;
    transferCode?: string;
  };
  if (!res.ok) {
    return { ok: false, message: data.message ?? data.error ?? "Payout request failed." };
  }
  return {
    ok: true,
    message: data.message ?? "Payout sent. It settles once confirmed.",
    otpRequired: Boolean(data.otpRequired),
    transferCode: data.transferCode,
  };
}

/**
 * Confirm an OTP-gated Paystack transfer with the OTP sent to the business
 * phone (admin). Returns a friendly result for the UI.
 */
export async function finalizePayoutOtp(
  payoutId: string,
  otp: string
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/payouts/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payoutId, otp }),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) {
    return { ok: false, message: data.message ?? data.error ?? "Couldn't finalize the transfer." };
  }
  return { ok: true, message: data.message ?? "Transfer confirmed." };
}

/**
 * Guaranteed pay trigger: push every 'pending' seller payout out via Paystack.
 * Called right after a buyer confirms receipt (and by the escrow sweep) so
 * released money is sent immediately rather than waiting for an admin click.
 * Each send claims its row atomically, so concurrent calls can't double-pay.
 */
export async function dispatchPendingPayouts(): Promise<{ sent: number; skipped: number }> {
  const res = await fetch("/api/payouts/dispatch", { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as {
    sent?: number;
    skipped?: number;
    error?: string;
    message?: string;
  };
  if (!res.ok) throw new Error(data.message ?? data.error ?? "Payout dispatch failed.");
  return { sent: Number(data.sent ?? 0), skipped: Number(data.skipped ?? 0) };
}

export interface StuckPayout {
  id: string;
  amountKes: number;
  role: string;
  providerRef: string | null;
  createdAt: string;
  recipientPhone: string | null;
}

export interface ReconcileResult {
  stuck: StuckPayout[];
  updated: number;
}

/**
 * Stuck-payout reconciliation (admin). Actions:
 *  - 'scan': list payouts stuck in 'processing' past the stale threshold
 *  - 'verify': ask Paystack for ground truth (success → paid, failed →
 *    failed); returns the outcome
 *  - 'markPaid': record that the admin verified the money actually reached
 *    the recipient
 *  - 'markFailed': free the queue for a retry after verifying it never went
 * Only 'processing' rows are ever touched — never a paid or pending one.
 */
export async function reconcileStuckPayouts(
  action: "scan" | "verify" | "markPaid" | "markFailed",
  payoutId?: string,
  note?: string
): Promise<ReconcileResult> {
  const res = await fetch("/api/payouts/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payoutId, note }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ReconcileResult> & {
    error?: string;
    message?: string;
    outcome?: string;
  };
  if (!res.ok) throw new Error(data.message ?? data.error ?? "Reconcile failed.");
  return { stuck: data.stuck ?? [], updated: Number(data.updated ?? 0) };
}

/**
 * Start a boosted-listing payment for a piece the signed-in user owns.
 * The server validates ownership + status, pushes the Paystack M-Pesa STK
 * for BOOST_PRICE_KES, and records a pending `boosts` row. The webhook then
 * flips it to paid (setting boost_expires_at) — the browser never marks a
 * boost as paid itself. Returns the boost id.
 */
export async function initiateBoost(
  productId: string,
  phone: string
): Promise<{ boostId: string }> {
  if (!isSupabaseConfigured) throw new Error("SUPABASE_NOT_CONFIGURED");
  const res = await fetch("/api/payments/boost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, productId }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    boostId?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.boostId) {
    // Preserve the server's error CODE (AUTH_REQUIRED, NOT_YOUR_PIECE, …)
    // on the thrown Error so the UI can map it to friendly copy — the raw
    // message alone would lose that mapping.
    const err = new Error(
      data.message ?? data.error ?? "Couldn't start the boost payment."
    ) as Error & { code?: string };
    if (data.error) err.code = data.error;
    throw err;
  }
  return { boostId: data.boostId };
}

/** The user's M-Pesa number on their profile ("" when unset). */
export function useProfilePhone(uid: string | null): string | null {
  const [phone, setPhone] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;
    client
      .from("profiles")
      .select("phone")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setPhone(String(data.phone ?? ""));
      });
    return () => {
      active = false;
    };
  }, [uid]);

  return phone;
}

/** Save the user's M-Pesa payout number to their profile. */
export async function updateProfilePhone(uid: string, phone: string): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.from("profiles").update({ phone }).eq("id", uid);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Payout destination (M-Pesa or bank, via Paystack Transfers)          */
/* ------------------------------------------------------------------ */

/** The Paystack KES bank list for the payout form. */
export async function fetchBanks(): Promise<{ code: string; name: string }[]> {
  const res = await fetch("/api/payouts/banks");
  const data = (await res.json().catch(() => ({}))) as {
    banks?: { code: string; name: string }[];
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.banks) throw new Error(data.message ?? data.error ?? "Couldn't load banks.");
  return data.banks;
}

export interface PayoutSettings {
  payoutMethod: "mpesa" | "bank";
  bankCode: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

/** The user's payout destination on their profile (defaults to M-Pesa). */
export function usePayoutSettings(uid: string | null): PayoutSettings | null {
  const [settings, setSettings] = useState<PayoutSettings | null>(null);

  useEffect(() => {
    if (!uid || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;
    client
      .from("profiles")
      .select("payout_method, bank_code, bank_account_number, bank_account_name")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        setSettings({
          payoutMethod: data.payout_method === "bank" ? "bank" : "mpesa",
          bankCode: String(data.bank_code ?? ""),
          bankAccountNumber: String(data.bank_account_number ?? ""),
          bankAccountName: String(data.bank_account_name ?? ""),
        });
      });
    return () => {
      active = false;
    };
  }, [uid]);

  return settings;
}

/** Save the user's payout destination (method + bank details). */
export async function updatePayoutSettings(
  uid: string,
  settings: PayoutSettings
): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client
    .from("profiles")
    .update({
      payout_method: settings.payoutMethod,
      bank_code: settings.payoutMethod === "bank" ? settings.bankCode || null : null,
      bank_account_number:
        settings.payoutMethod === "bank" ? settings.bankAccountNumber.trim() || null : null,
      bank_account_name:
        settings.payoutMethod === "bank" ? settings.bankAccountName.trim() || null : null,
    })
    .eq("id", uid);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Locations (meetup points + "near me" areas)                        */
/* ------------------------------------------------------------------ */

/** The full county → area catalog (static — fetched once). */
export function useLocations(): Location[] | null {
  const [locations, setLocations] = useState<Location[] | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;
    client
      .from("locations")
      .select("*")
      .order("city")
      .then(({ data, error }) => {
        if (active && !error) {
          setLocations((data ?? []).map((r) => locationFromRow(r as unknown as Row)));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return locations;
}

/**
 * The user's chosen area id on their profile ("" when unset, null while
 * loading). Realtime-subscribed: saving the area from the onboarding prompt
 * or the account page updates the feed's "Near you" section immediately.
 */
export function useProfileLocation(uid: string | null): string | null {
  const [loc, setLoc] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const load = async () => {
      const { data } = await client
        .from("profiles")
        .select("location_id")
        .eq("id", uid)
        .maybeSingle();
      if (active && data) setLoc(String(data.location_id ?? ""));
    };

    load();

    // Refetch on any change to the user's own row (location_id, and any
    // other profile update) so the area stays in sync without a reload.
    const channel = client
      .channel(uniqueChannelName(`profiles:${uid}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [uid]);

  return loc;
}

/** Save the user's area (buyer) to their profile. */
export async function updateProfileLocation(uid: string, locationId: string | null): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client
    .from("profiles")
    .update({ location_id: locationId })
    .eq("id", uid);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Meetup coordination: per-order chat                                */
/* ------------------------------------------------------------------ */

/** All messages in one order's thread, newest last (sort client-side). */
export function useOrderMessages(orderId: string | null): OrderMessage[] | null {
  return useRealtimeRows("messages", messageFromRow, {
    filterColumn: "order_id",
    filterValue: orderId,
    max: 200,
  });
}

/** Send a message in an order thread. RLS lets only the buyer or seller in. */
export async function sendOrderMessage(orderId: string, body: string): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.from("messages").insert({
    order_id: orderId,
    sender_id: (await client.auth.getUser()).data.user?.id ?? "",
    body: body.trim(),
  });
  if (error) throw new Error(String(error.message ?? "Couldn't send the message."));
}

/* ------------------------------------------------------------------ */
/* Meetup safety: check-ins + opt-in live location shares              */
/* ------------------------------------------------------------------ */

/** All "I'm here" check-ins on one order (participants only, via RLS). */
export function useOrderCheckins(orderId: string | null): MeetupCheckin[] | null {
  return useRealtimeRows("meetup_checkins", checkinFromRow, {
    filterColumn: "order_id",
    filterValue: orderId,
    max: 10,
  });
}

/** All live location shares on one order (participants only, via RLS). */
export function useOrderShares(orderId: string | null): MeetupShare[] | null {
  return useRealtimeRows("meetup_shares", shareFromRow, {
    filterColumn: "order_id",
    filterValue: orderId,
    max: 10,
  });
}

/**
 * Tap "I'm here" on an order. The RPC verifies the caller is a participant
 * and is idempotent (one check-in per user per order).
 */
export async function checkInOrder(orderId: string): Promise<string> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("check_in_order", { p_order_id: orderId });
  if (error) throw new Error(String(error.message ?? "Couldn't check in."));
  return String(data);
}

/**
 * Opt in to sharing live location with the other party for 30 minutes.
 * The server validates the coordinates and returns the new expiry.
 */
export async function startMeetupShare(
  orderId: string,
  lat: number,
  lng: number,
  accuracy?: number
): Promise<Date> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("meetup_share_start", {
    p_order_id: orderId,
    p_lat: lat,
    p_lng: lng,
    p_accuracy: accuracy ?? 0,
  });
  if (error) throw new Error(String(error.message ?? "Couldn't start sharing."));
  return new Date(String(data));
}

/** Push a fresh position while sharing (the server throttles to ~3s). */
export async function updateMeetupShare(
  orderId: string,
  lat: number,
  lng: number,
  accuracy?: number
): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.rpc("meetup_share_update", {
    p_order_id: orderId,
    p_lat: lat,
    p_lng: lng,
    p_accuracy: accuracy ?? 0,
  });
  if (error) throw new Error(String(error.message ?? "Couldn't update the share."));
}

/** Opt out early — expires the share immediately. */
export async function stopMeetupShare(orderId: string): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.rpc("meetup_share_stop", { p_order_id: orderId });
  if (error) throw new Error(String(error.message ?? "Couldn't stop sharing."));
}

/* ------------------------------------------------------------------ */
/* Disputes ("I didn't receive it") + no-show cancellation            */
/* ------------------------------------------------------------------ */

/** All order disputes — the admin support queue. */
export function useOrderDisputes(): OrderDispute[] | null {
  return useRealtimeRows("order_disputes", disputeFromRow, { max: 100 });
}

/**
 * Buyer flags an order as not received. Pauses the escrow auto-release
 * until the owner resolves it. Returns the dispute id.
 */
export async function disputeOrder(orderId: string, reason?: string): Promise<string> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("dispute_order", {
    p_order_id: orderId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(String(error.message ?? "Couldn't file the dispute."));
  return String(data);
}

/**
 * Buyer cancels an order after the seller's 24h no-show window: seller
 * payout failed, refund payout created, piece re-listed. Returns 'cancelled'.
 */
export async function cancelOrderNoShow(orderId: string): Promise<string> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("cancel_order_no_show", {
    p_order_id: orderId,
  });
  if (error) throw new Error(String(error.message ?? "Couldn't cancel the order."));
  return String(data);
}

/**
 * Owner resolves a dispute. Outcome:
 *  - 'release': the seller delivered — release their held escrow
 *  - 'fail': the buyer never got it — seller gets nothing, no refund
 *  - 'cancel': fail the seller AND refund the buyer + re-list the piece
 */
export async function resolveOrderDisputeAdmin(
  disputeId: string,
  outcome: "release" | "fail" | "cancel" = "release",
  note?: string
): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.rpc("admin_resolve_order_dispute", {
    p_dispute_id: disputeId,
    p_admin_note: note ?? null,
    p_outcome: outcome,
  });
  if (error) throw error;
}

/**
 * Remove a product from the feed (admin-only RPC). When rejecting a pending
 * community piece, `note` is the reason shown to the seller in the in-app
 * bell + rejection email (blank = plain rejection).
 */
export async function deleteProductAdmin(productId: string, note?: string): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.rpc("admin_delete_product", {
    p_product_id: productId,
    p_note: note ?? null,
  });
  if (error) {
    // Databases that haven't re-run the migration only know the single-arg
    // signature — retry with just the product id so moderation isn't blocked
    // by a stale schema (mirrors the create_listing p_image_urls fallback).
    const msg = String(error.message ?? "");
    if (/could not find the function|p_note|does not exist/i.test(msg)) {
      const fallback = await client.rpc("admin_delete_product", { p_product_id: productId });
      if (!fallback.error) return;
    }
    throw error;
  }
}

/** Owner action: promote a pending community piece to the live feed. */
export async function setProductStatusAdmin(
  productId: string,
  status: "active" | "sold"
): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.rpc("admin_set_product_status", {
    p_product_id: productId,
    p_status: status,
  });
  if (error) throw error;
}

/**
 * Owner recovery: mark a payout stuck in 'processing' as failed so it
 * leaves the settlements queue (admin-only RPC). Never touches paid or
 * pending payouts — the DB guards on status = 'processing'.
 */
export async function resetPayoutAdmin(payoutId: string): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await client.rpc("admin_reset_payout", { p_payout_id: payoutId });
  if (error) throw error;
}

export interface NewPlatformProductInput {
  item: {
    title: string;
    brand: string;
    category: ProductCategory;
    size: string;
    condition: string;
    priceKes: number;
    imageUrl: string;
    description?: string;
    /** Platform pieces carry a meetup location too (required, like sellers). */
    locationId: string;
    locationLabel?: string | null;
  };
}

/** Owner adds a platform piece directly to the live feed (admin-only RPC). */
export async function createPlatformProduct(input: NewPlatformProductInput): Promise<string> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("admin_create_product", {
    p_title: input.item.title,
    p_brand: input.item.brand,
    p_category: input.item.category,
    p_size: input.item.size,
    p_condition: input.item.condition,
    p_price_kes: input.item.priceKes,
    p_image_url: input.item.imageUrl,
    p_description: input.item.description ?? null,
    p_location_id: input.item.locationId,
    p_location_label: input.item.locationLabel ?? null,
  });
  if (error) throw error;
  return String(data);
}

/* ------------------------------------------------------------------ */
/* Ratings (public trust signals)                                      */
/* ------------------------------------------------------------------ */

export interface RatingSummary {
  /** Average score rounded to 1 decimal; null when there are no ratings yet. */
  average: number | null;
  total: number;
}

/**
 * Average + count of post-purchase ratings for one seller (community
 * pieces) or the whole shop (sellerId null). Backed by the security-definer
 * get_rating_summary RPC so anonymous browsers can see the trust signal
 * even though ratings rows themselves are RLS-private.
 */
export async function fetchRatingSummary(sellerId: string | null): Promise<RatingSummary> {
  const client = getBrowserClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await client.rpc("get_rating_summary", {
    p_seller_id: sellerId ?? null,
  });
  if (error) {
    console.error("rating summary fetch failed:", error);
    return { average: null, total: 0 };
  }
  const row = Array.isArray(data) ? data[0] : undefined;
  return {
    average: row && row.avg_score != null ? Number(row.avg_score) : null,
    total: Number(row?.total ?? 0),
  };
}

/** Hook: one fetch per seller (or the shop-wide rating when sellerId is null). */
export function useRatingSummary(sellerId: string | null): RatingSummary | null {
  const [summary, setSummary] = useState<RatingSummary | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    fetchRatingSummary(sellerId).then((s) => {
      if (active) setSummary(s);
    });
    return () => {
      active = false;
    };
  }, [sellerId]);

  return summary;
}

/** Whether the user already rated a specific order (their own row — RLS-safe). */
export async function hasRatedOrder(uid: string, orderId: string): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;
  const { data } = await client
    .from("ratings")
    .select("id")
    .eq("order_id", orderId)
    .eq("user_id", uid)
    .maybeSingle();
  return Boolean(data);
}
