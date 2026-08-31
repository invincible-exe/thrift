/**
 * The canonical public origin for this deployment — used for canonical URLs,
 * Open Graph tags, the sitemap, robots.txt and share links.
 *
 * Resolution order:
 *  1. The Vercel production URL (e.g. 10of10thrifts.vercel.app) when deployed —
 *     SEO output must always point at the site real visitors use, never at
 *     a local tunnel.
 *  2. NEXT_PUBLIC_SITE_URL / APP_URL for local dev / phone testing (e.g. an
 *     ngrok tunnel while developing).
 *  3. localhost:3000 as a last resort.
 */
export function siteUrl(path = ""): string {
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL;
  const base = vercel
    ? `https://${vercel}`
    : process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.APP_URL ||
      "http://localhost:3000";
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}
