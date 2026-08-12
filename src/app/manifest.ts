import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes the site installable from the browser:
 * Android/Chrome show "Add to Home Screen / Install app", iOS uses the
 * apple-touch-icon + appleWebApp meta (set in layout.tsx) for its own
 * "Add to Home Screen". Display: standalone opens it fullscreen, app-like.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "10/10 Thrifts · Premium Curated Thrift",
    short_name: "10/10 Thrifts",
    description:
      "1-of-1 premium pieces, no doubles ever. Browse free, pay with M-Pesa or bank transfer.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#16130f", // matches the icon tile
    theme_color: "#1e1915", // matches the dark paper background
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
