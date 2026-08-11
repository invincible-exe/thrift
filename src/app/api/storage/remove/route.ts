import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

const BUCKET = "product-images";

/**
 * POST /api/storage/remove  Body: { path }
 *
 * Best-effort cleanup of an uploaded photo (e.g. when a listing fails).
 * Service-role client bypasses storage RLS, so it works without the
 * migration's delete policies. Users can only remove their own paths.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: false }, { status: 501 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const rl = rateLimit(`storage-remove:${user.id}`, 60, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  let path = "";
  try {
    const body = (await req.json()) as { path?: string };
    path = body.path ?? "";
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  // Paths are namespaced under the uploader's user id — only they can remove.
  if (!path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const admin = getAdminClient();
    const { error } = await admin.storage.from(BUCKET).remove([path]);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Photo remove failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
