import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

const BUCKET = "product-images";
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/ogg"]);

function extFor(contentType: string): string {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("ogg")) return "ogg";
  return "mp4";
}

/**
 * POST /api/storage/sign-upload  { contentType, size }
 *
 * Returns a Supabase signed upload URL so the browser can send the file
 * bytes *directly* to Storage, never through this API.
 *
 * Why: Vercel rejects any serverless request body over ~4.5 MB with
 * `413 FUNCTION_PAYLOAD_TOO_LARGE`, so the old flow (POST the whole video
 * to /api/storage/upload) failed for every real-world video on production
 * while working fine locally. Photos still go through the server because
 * they're client-compressed to a few hundred KB; videos are uploaded as-is
 * and must not touch the API at all.
 *
 * The signed URL grants write access to exactly one path, so this works
 * even with storage RLS locking the bucket down. Auth + the shared
 * upload rate limit are enforced here, before any URL is minted.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json(
      {
        error: "STORAGE_NOT_CONFIGURED",
        message: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local to enable video uploads.",
      },
      { status: 501 }
    );
  }

  // Only signed-in users may upload.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  // Same 30 uploads/hour/user budget as /api/storage/upload — signed URLs
  // share the abuse cap, so this route can't be used to dodge it.
  const rl = await rateLimit(`upload:${user.id}`, 30, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Too many uploads. Try again in a little while.",
        retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000),
      },
      { status: 429 }
    );
  }

  let body: { contentType?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  const size = typeof body.size === "number" ? body.size : 0;

  // Signed uploads are for videos only — images stay on the server route
  // where sharp re-encodes them to WebP.
  if (!VIDEO_TYPES.has(contentType) && !contentType.startsWith("video/")) {
    return NextResponse.json(
      { error: "UNSUPPORTED_TYPE", message: "Only video files use signed uploads." },
      { status: 400 }
    );
  }
  if (!(size > 0) || size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: "FILE_TOO_LARGE", message: "Use a video file under 50 MB." },
      { status: 400 }
    );
  }

  try {
    const admin = getAdminClient();

    // Self-healing: make sure the bucket exists before signing a URL into
    // it (tolerate the concurrent-first-upload race, same as the upload route).
    const { data: buckets } = await admin.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      const { error: createErr } = await admin.storage.createBucket(BUCKET, { public: true });
      if (createErr && !/already exists/i.test(String(createErr.message ?? ""))) {
        throw createErr;
      }
    }

    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFor(contentType)}`;

    const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (signErr) throw signErr;

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

    return NextResponse.json({
      bucket: BUCKET,
      path: signed.path ?? path,
      token: signed.token,
      url: pub.publicUrl,
    });
  } catch (err) {
    console.error("Sign upload failed:", err);
    return NextResponse.json({ error: "SIGN_FAILED" }, { status: 500 });
  }
}
