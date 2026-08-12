/**
 * Client-side photo compression for listing uploads.
 *
 * Phone photos are 3–8MB raw. Vercel's serverless functions cap request
 * bodies at ~4.5MB, so uploading them as-is fails before the route runs
 * ("Failed to fetch"). Downscaling to 1600px on the long edge + WebP q82
 * turns a typical phone photo into a ~200–500KB file — well under any
 * limit, and much faster on mobile data.
 *
 * Un-decodable formats (HEIC on browsers without support, exotic types)
 * fall back to the original file — the server's sharp pipeline still
 * handles those.
 */

const MAX_EDGE = 1600;
const WEBP_QUALITY = 0.82;

/**
 * Returns a compressed File when the input is a decodable raster image
 * larger than a few hundred KB; otherwise returns the original File.
 */
export async function compressImage(file: File): Promise<File> {
  // Skip anything that isn't a common raster photo, or is already small.
  if (!/^image\/(jpeg|png|webp|avif|heic|heif)$/i.test(file.type)) return file;
  if (file.size < 300 * 1024) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    // Explicit "from-image" so EXIF rotation is applied at decode — the
    // canvas re-encode strips EXIF, so the server's sharp().rotate() can't
    // rescue a photo whose orientation was dropped here.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Can't decode (e.g. HEIC in some browsers) — let the server handle it.
    return file;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small enough that re-encoding buys nothing (avoids a second
    // generation loss on images the user already optimized).
    if (scale >= 1 && file.size < 1024 * 1024) return file;

    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, w, h);

    // WebP first — it preserves PNG transparency. Transparent pixels would
    // go black in JPEG, so the white backdrop is only painted for that
    // fallback path.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)
    );
    if (blob && blob.size < file.size) {
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
        type: "image/webp",
      });
    }

    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (jpeg && jpeg.size < file.size) {
      return new File([jpeg], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
        type: "image/jpeg",
      });
    }

    return file;
  } finally {
    bitmap.close();
  }
}
