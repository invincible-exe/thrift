/**
 * The three GLB variants of the hero lineup and where they live.
 *
 * Pure module — NO side effects (no useGLTF.preload here). It is imported by
 * both the model renderer (MascotModel, which kicks off the preloads) and
 * the retry boundary (ModelRetryBoundary, which clears the loader cache
 * after a failed download). Keeping this file side-effect free means the
 * retry boundary can't accidentally start model fetches early.
 *
 * The GLBs are mirrored to the public `models` bucket on Supabase Storage
 * (uploaded from scripts/upload-models.sh) and loaded from there when
 * NEXT_PUBLIC_SUPABASE_URL is set — Supabase's CDN serves the full file at
 * full speed. Falls back to the local /models/* paths in dev / when no
 * bucket is configured.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
const modelsBase = supabaseUrl
  ? `${supabaseUrl}/storage/v1/object/public/models`
  : "";
const local = (name: string) => `/models/${name}`;

export const MODEL_FULL = modelsBase
  ? `${modelsBase}/modelToUse.glb`
  : local("modelToUse.glb");
export const MODEL_MOBILE = modelsBase
  ? `${modelsBase}/modelToUse-mobile.glb`
  : local("modelToUse-mobile.glb");
export const MODEL_LITE = modelsBase
  ? `${modelsBase}/modelToUse-lite.glb`
  : local("modelToUse-lite.glb");

/** Every variant, for cache-clearing after a failed load. */
export const MODEL_URLS = [MODEL_LITE, MODEL_MOBILE, MODEL_FULL] as const;
