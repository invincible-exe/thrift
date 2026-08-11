import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships a platform-native binary (libvips) that Turbopack can't
  // bundle — bundling its JS but dropping the .so makes every upload route
  // 500 with "Could not load the sharp module". Loading it from node_modules
  // at runtime (server-only) keeps the native binary with the package.
  serverExternalPackages: ["sharp"],
  images: {
    // Default-deny image hosts (zero trust). Only these hosts are ever used:
    //  - images.unsplash.com / plus.unsplash.com / source.unsplash.com — the
    //    demo catalog seed photos (all three hostname variants appear in
    //    real Unsplash URLs)
    //  - *.supabase.co — community listing photos (server re-encoded WebP in
    //    the product-images bucket) and the 3D model GLBs
    // The previous `hostname: "**"` wildcard let the /_next/image optimizer
    // fetch any HTTPS URL server-side (an SSRF probe surface); anything a
    // user can cause the optimizer to fetch must now match this allowlist.
    // NOTE: if any legacy `products.image_url` row holds a URL from another
    // host (the pre-upload-flow era allowed pasting arbitrary URLs), that
    // image stops rendering — re-host it to the product-images bucket.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "plus.unsplash.com" },
      { protocol: "https", hostname: "source.unsplash.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  // Security headers — the edge-level half of the CIA triad + zero trust.
  // Sent on every response (pages, API routes, static assets):
  //  - CSP: baseline injection defense (blocks external script/object/iframe
  //    loading, form exfiltration, clickjacking). 'unsafe-inline' is required
  //    for Next's inline hydration bootstrap + the theme-init script; the
  //    larger win is that script-src has NO remote sources, so an injected
  //    <script src="https://evil…"> payload cannot load. Dev additionally
  //    needs 'unsafe-eval' for the webpack/HMR dev runtime — production
  //    ships without it. 'wasm-unsafe-eval' (CSP3, scoped to WebAssembly
  //    compilation only — NOT JS eval) keeps the 3D mascot's meshopt/draco
  //    decoders working in production.
  //  - HSTS: force HTTPS (browsers ignore it on plain http/localhost).
  //  - nosniff / DENY frame / strict referrer / empty Permissions-Policy:
  //    prevent content-type sniffing, framing, referrer leakage, and
  //    camera/mic/geo/payment API abuse.
  async headers() {
    const isDev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Browser → Supabase (REST + realtime WebSocket) and Daraja (server-side
      // calls are unaffected by CSP; these entries only matter if the browser
      // ever calls them directly).
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.safaricom.co.ke https://sandbox.safaricom.co.ke",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // Same-origin windows only (allows the Google OAuth top-level
          // redirect, which doesn't rely on window.opener).
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  // Next.js 16 blocks cross-origin access to dev-only resources (HMR
  // websocket, dev client chunks, fonts) for safety. Without explicit entries,
  // opening the app from the LAN IP (10.203.160.16), 127.0.0.1, or an
  // ngrok/Cloudflare tunnel leaves the page rendering SSR HTML but with dead
  // HMR and a 403'd font. A bare "*" is NOT valid — Next only accepts explicit
  // hostnames plus subdomain wildcards (e.g. "*.ngrok-free.dev").
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "10.203.160.16",
    "192.168.119.25",
    "*.ngrok-free.dev",
    "*.ngrok.app",
  ],
};

export default nextConfig;
