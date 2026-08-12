import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Strict, nonce-based Content Security Policy — the hardening that removes
 * 'unsafe-inline' from script-src.
 *
 * Next.js parses the nonce out of this response header during SSR and
 * applies it to its own inline hydration/bootstrap scripts automatically
 * (so no per-script nonce props are needed for framework scripts).
 *
 * The one app-authored inline script (the no-flash theme-init in
 * layout.tsx) is allowlisted by its SHA-256 hash instead of a nonce — it is
 * a fixed, static string. If you change that script, recompute the hash
 * (node -e '...createHash("sha256").update(SCRIPT).digest("base64")') and
 * update it below, or the no-flash theme breaks.
 *
 * style-src keeps 'unsafe-inline': Next.js/Tailwind/framer-motion inject
 * inline <style> tags and style attributes, and style injection is a much
 * lower risk than script injection.
 *
 * NOTE: nonce-based CSP requires dynamic rendering — the root layout forces
 * it (export const dynamic = "force-dynamic") so Next can always inject the
 * per-request nonce. Static pages are generated at build time with no
 * request headers, so they'd ship nonce-less scripts and break the CSP.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' (CSP3) scopes relaxation to WebAssembly compilation
    // only — NOT JS eval — keeping the 3D mascot's meshopt/draco decoders
    // working. Dev additionally needs 'unsafe-eval' for the webpack/HMR
    // dev runtime; production ships without it.
    `script-src 'self' 'nonce-${nonce}' 'sha256-ioxkMdSjzxBsDO9wiI4FmT2aAEzopHFCE795i7yEYc0=' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
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
}

export async function updateSession(request: NextRequest) {
  // Fresh, unpredictable nonce per request. Hex (from a UUID) is a valid
  // CSP nonce (base64 alphabet) and needs no Buffer/encoding helpers.
  const nonce = crypto.randomUUID().replace(/-/g, "");

  // Pass the nonce downstream so server components could read it via
  // headers() (Next.js also extracts it from the CSP header itself).
  request.headers.set("x-csp-nonce", nonce);

  let supabaseResponse = NextResponse.next({ request });

  // Preview mode: no keys, no session cookies to refresh — but the nonce +
  // strict CSP still apply.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    supabaseResponse.headers.set("Content-Security-Policy", buildCsp(nonce));
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session if it exists (no-op otherwise).
  await supabase.auth.getUser();

  supabaseResponse.headers.set("Content-Security-Policy", buildCsp(nonce));

  return supabaseResponse;
}

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip framework internals, the favicon, and every static asset type —
    // including 3D models (.glb/.gltf) so the hero mascot is never routed
    // through the session middleware.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|glb|gltf|bin|hdr|mp4|webm|wasm|woff|woff2|ttf|otf|ico)$).*)",
  ],
};
