import type { MetadataRoute } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";

// A catalog changes as pieces sell, but hourly is plenty for search engines.
export const revalidate = 3600;

/**
 * Public crawl map: the core pages plus one entry per live (status='active')
 * product page. Product URLs use the piece id (stable forever, even after
 * the row is deleted on sale, so a crawled URL 404s cleanly instead of
 * serving another piece's content).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("products")
    .select("id, created_at")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(5000);

  // Every seller with a live piece gets a profile URL too — that page is the
  // permanent home for their rating, so it deserves a crawl entry.
  const { data: sellers } = await supabase
    .from("products")
    .select("seller_id")
    .eq("status", "active")
    .not("seller_id", "is", null);
  const sellerIds = [...new Set((sellers ?? []).map((s) => String(s.seller_id)))];

  const entries: MetadataRoute.Sitemap = [
    {
      url: siteUrl("/"),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: siteUrl("/account"),
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: siteUrl("/wishlist"),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    ...(data ?? []).map((p) => ({
      url: siteUrl(`/product/${p.id}`),
      lastModified: p.created_at ? new Date(p.created_at) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...sellerIds.map((id) => ({
      url: siteUrl(`/seller/${id}`),
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
  ];

  return entries;
}
