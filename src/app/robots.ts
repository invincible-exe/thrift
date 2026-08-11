import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Admin and auth internals are never worth crawling.
      disallow: ["/admin", "/auth", "/api"],
    },
    sitemap: siteUrl("/sitemap.xml"),
  };
}
