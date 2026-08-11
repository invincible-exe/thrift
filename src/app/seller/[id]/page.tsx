import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import type { Product } from "@/lib/types";
import SellerProfileClient from "@/components/SellerProfileClient";

type Row = Record<string, unknown>;

export interface SellerProfile {
  name: string;
  memberSince: Date | null;
  locationLabel: string | null;
  avgScore: number | null;
  ratingCount: number;
  sales: number;
}

/** Server-side row → Product mapping (mirrors db.ts — kept local so this
 *  page never imports browser-only modules). */
function productFromRow(row: Row): Product {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? "Untitled"),
    brand: String(row.brand ?? ""),
    category: (row.category ?? "Tops") as Product["category"],
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
    createdAt: new Date(String(row.created_at ?? 0)),
    boostExpiresAt: row.boost_expires_at ? new Date(String(row.boost_expires_at)) : undefined,
    locationId: row.location_id ? String(row.location_id) : undefined,
    locationLabel: row.location_label ? String(row.location_label) : undefined,
  };
}

/** The public subset of a seller's profile (get_seller_profile RPC). */
async function fetchSellerProfile(id: string): Promise<SellerProfile | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.rpc("get_seller_profile", { p_seller_id: id });
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!row) return null;
  return {
    name: String(row.name ?? ""),
    memberSince: row.member_since ? new Date(String(row.member_since)) : null,
    locationLabel: row.location_label ? String(row.location_label) : null,
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
    ratingCount: Number(row.rating_count ?? 0),
    sales: Number(row.sales ?? 0),
  };
}

/** The seller's live pieces (public products feed, filtered by seller). */
async function fetchSellerProducts(id: string): Promise<Product[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("seller_id", id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(60);
  return (data ?? []).map((r) => productFromRow(r as unknown as Row));
}

// A seller's rack changes as pieces sell — always fetch fresh.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [profile, products] = await Promise.all([fetchSellerProfile(id), fetchSellerProducts(id)]);
  if (!profile) {
    return { title: "Seller not found | 10/10 Thrifts" };
  }

  const name = profile.name.trim() || "This seller";
  const rating = profile.avgScore != null ? ` · ★ ${profile.avgScore} (${profile.ratingCount})` : "";
  const title = `${name}'s closet${rating} | 10/10 Thrifts`;
  const description = [
    profile.sales > 0 ? `${profile.sales} sale${profile.sales === 1 ? "" : "s"} on 10/10 Thrifts` : "Sells 1-of-1 thrift pieces on 10/10 Thrifts",
    profile.locationLabel ? `meets in ${profile.locationLabel}` : "",
    products.length > 0 ? `${products.length} piece${products.length === 1 ? "" : "s"} on the rack now` : "rack updates weekly",
  ]
    .filter(Boolean)
    .join(" · ");
  const url = siteUrl(`/seller/${id}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "10/10 Thrifts",
      type: "profile",
      images: products[0]?.imageUrl ? [{ url: products[0].imageUrl, alt: name }] : undefined,
    },
    twitter: {
      card: products[0]?.imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      images: products[0]?.imageUrl ? [products[0].imageUrl] : undefined,
    },
  };
}

export default async function SellerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, products] = await Promise.all([fetchSellerProfile(id), fetchSellerProducts(id)]);
  if (!profile) notFound();

  const jsonLd = profile.avgScore != null && profile.ratingCount > 0
    ? {
        "@context": "https://schema.org",
        "@type": "Person",
        name: profile.name.trim() || "Seller",
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: profile.avgScore,
          reviewCount: profile.ratingCount,
        },
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <SellerProfileClient
        sellerId={id}
        profile={profile}
        products={products}
        canonicalUrl={siteUrl(`/seller/${id}`)}
      />
    </>
  );
}
