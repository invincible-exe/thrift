import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Auth callback — handles the redirect from Google OAuth and email
 * confirmation links. Exchanges the `code` for a session, then sends the
 * user back where they were heading.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // The redirect base comes from NEXT_PUBLIC_SITE_URL when configured — the
  // canonical public origin, immune to Host-header injection. Falling back to
  // the request's own origin (dev / unconfigured) is fine because the app's
  // only Host values there are localhost / the tunnel URL the owner chose.
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin).replace(
    /\/+$/,
    ""
  );

  // Open-redirect guard (zero trust — never trust the query string): the
  // redirect target must be a same-origin relative path. Anything that
  // isn't a bare `/path` (protocol-relative `//…`, a scheme like
  // `https:…`, a backslash escape, or an empty value) falls back to `/`.
  // The redirect is built as `${origin}${next}` with origin first, so even
  // a `//evil.com` value can't leave the app's origin — this is the belt
  // and braces that keeps the auth flow from ever landing users elsewhere.
  const safeNext =
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    !next.includes(":")
      ? next
      : "/";

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
