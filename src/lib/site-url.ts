/**
 * The canonical public origin for this deployment — used for canonical URLs,
 * Open Graph tags, the sitemap, robots.txt and share links.
 *
 * Resolution order:
 *  1. NEXT_PUBLIC_SITE_URL — explicit override. Always wins when set so
 *     shared links point at the correct domain (e.g. the working
 *     .vercel.app URL instead of a custom domain with broken DNS).
 *  2. VERCEL_PROJECT_PRODUCTION_URL — Vercel's auto-detected production
 *     domain, used when no explicit override is configured.
 *  3. APP_URL / localhost for local dev.
 */
export function siteUrl(path = ""): string {
  const custom = process.env.NEXT_PUBLIC_SITE_URL;
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL;
  const base = custom ||
    (vercel ? `https://${vercel}` : process.env.APP_URL || "http://localhost:3000");
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}
