import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { formatKes } from "@/lib/format";
import type { Product } from "@/lib/types";
import ProductDetailClient from "@/components/ProductDetailClient";

type Row = Record<string, unknown>;

/** Server-side row → Product mapping (mirrors the client mapper in db.ts —
 *  kept local so this page never imports browser-only modules). */
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

async function fetchProduct(id: string): Promise<Product | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  return data ? productFromRow(data as unknown as Row) : null;
}

// Always re-fetch: a piece can sell (row deleted) between crawls, and the
// sold state must never be served from cache.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await fetchProduct(id);
  if (!product) {
    return { title: "This drop is gone | 10/10 Thrifts" };
  }

  const title = `${product.title} · ${formatKes(product.priceKes)} | 10/10 Thrifts`;
  const description =
    product.description?.slice(0, 155) ??
    `1-of-1 ${product.category.toLowerCase()} piece — ${product.brand}, size ${product.size}, ${product.condition}. No doubles, ever.`;
  const url = siteUrl(`/product/${product.id}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "10/10 Thrifts",
      type: "website",
      images: [{ url: product.imageUrl, alt: product.title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [product.imageUrl],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await fetchProduct(id);
  if (!product) notFound();

  // Product structured data — powers rich results (price, condition, brand).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    image: product.imageUrls ?? [product.imageUrl],
    description: product.description ?? `${product.brand} ${product.title} — 1-of-1 thrift piece.`,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    category: product.category,
    offers: {
      "@type": "Offer",
      price: product.priceKes,
      priceCurrency: "KES",
      availability:
        product.status === "active"
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
      url: siteUrl(`/product/${product.id}`),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ProductDetailClient product={product} canonicalUrl={siteUrl(`/product/${product.id}`)} />
    </>
  );
}
