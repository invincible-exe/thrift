import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";
import sharp from "sharp";

export const runtime = "nodejs";

const BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Seller photos are compressed + converted to WebP before hitting storage,
// so the realtime feed stays fast on mobile data. 2048px on the long edge at
// q90 keeps details sharp when buyers zoom in the lightbox (a retina
// full-screen view wants ~1600-2000px) without ballooning the source file.
// The feed never downloads the full file — Next's optimizer serves a
// width-matched crop — so only the lightbox pays the larger size.
const MAX_EDGE = 2048;
const WEBP_QUALITY = 90;

/**
 * POST /api/storage/upload (multipart form: file)
 *
 * Uploads a listing photo with the service-role client (bypasses storage
 * RLS), so listings work even when the migration's storage policies haven't
 * been applied yet. Creates the `product-images` bucket automatically on
 * first use — no SQL editor needed.
 *
 * Every photo is re-encoded server-side with sharp: downscaled to at most
 * 2048px on the long edge, converted to WebP at q90, and EXIF orientation
 * applied. A typical phone photo (~4MB JPEG) lands around 300-600KB WebP
 * (the feed only ever downloads a width-matched crop of it via the image
 * optimizer). Returns { url, path } — the URL always ends in .webp.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json(
      {
        error: "STORAGE_NOT_CONFIGURED",
        message:
          "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local to enable photo uploads.",
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

  // 30 uploads/hour/user — generous for real listings, stops storage abuse.
  const rl = rateLimit(`upload:${user.id}`, 30, WINDOWS.hour);
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "NOT_IMAGE" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "FILE_TOO_LARGE", message: "Use an image file under 5 MB." },
      { status: 400 }
    );
  }

  try {
    const admin = getAdminClient();

    // Self-healing: make sure the bucket exists on first upload. Two
    // concurrent first-uploads can race here — tolerate an "already exists"
    // createBucket error and just carry on.
    const { data: buckets } = await admin.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      const { error: createErr } = await admin.storage.createBucket(BUCKET, {
        public: true,
      });
      if (createErr && !/already exists/i.test(String(createErr.message ?? ""))) {
        throw createErr;
      }
    }

    // Compress + convert to WebP server-side. Falls back to the original
    // bytes only if sharp can't process the image (never fails the upload
    // because of an exotic format).
    const input = Buffer.from(await file.arrayBuffer());
    let webp: Buffer;
    let compressed = false;
    try {
      webp = await sharp(input)
        .rotate() // apply EXIF orientation
        .resize({
          width: MAX_EDGE,
          height: MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      compressed = true;
    } catch {
      webp = input;
    }

    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;

    const { error: uploadErr } = await admin.storage.from(BUCKET).upload(path, webp, {
      cacheControl: "3600",
      upsert: false,
      contentType: compressed ? "image/webp" : file.type,
    });
    if (uploadErr) throw uploadErr;

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  } catch (err) {
    console.error("Photo upload failed:", err);
    return NextResponse.json({ error: "UPLOAD_FAILED" }, { status: 500 });
  }
}
