/**
 * The canonical public origin for this deployment — used for canonical URLs,
 * Open Graph tags, the sitemap, robots.txt and share links.
 *
 * Resolution order:
 *  1. NEXT_PUBLIC_SITE_URL — the custom domain (e.g. https://1010thrifts.app).
 *     Always takes priority when set so shared links point at the real site,
 *     not the Vercel preview URL.
 *  2. VERCEL_PROJECT_PRODUCTION_URL — fallback on Vercel when no custom
 *     domain is configured.
 *  3. APP_URL for local dev / phone testing.
 *  4. localhost:3000 as a last resort.
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
