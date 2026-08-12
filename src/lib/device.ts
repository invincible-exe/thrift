/**
 * Device capability tiers for the 3D hero — one source of truth used by:
 *  - CyberCard: whether to mount the 3D at all ("static" → branded poster)
 *  - MascotModel: which GLB variant to load ("lite" | "mobile" | "full")
 *  - Hero3D: renderer tuning per tier (dpr cap, antialias)
 *
 * Tier ladder (worst → best), and the model each tier gets:
 *  - static: no WebGL, or ≤1GB RAM — the 3D never mounts; the static poster
 *    shows instead. Even the 0.9MB lite model plus a WebGL loop can starve
 *    a 1GB phone, so it gets zero 3D cost.
 *  - lite:   save-data, 2G/slow-2G, ≤2GB RAM, ≤2 CPU cores, or a weak GPU
 *    (see weakGpuDetected) — the 0.9MB decimated model, dpr capped at 1,
 *    antialias off. Old/cheap phones and weak GPUs land here.
 *  - mobile: 3G, ≤4GB RAM, touch, or a <768px viewport — the 3.6MB mobile
 *    variant (decimated specifically for phones; looks near-identical at
 *    phone pixel ratios), dpr ≤1.2, antialias off (MSAA is the biggest GPU
 *    cost at phone scale). Mid-range phones land here.
 *  - full:   everything else — the ~7MB lineup at native dpr. Desktops and
 *    high-end machines with WebGL, >4GB RAM and plenty of cores.
 *
 * iOS Safari doesn't report deviceMemory, so the core-count / touch / width
 * checks carry the load there (a 2016-era iPhone is caught by cores or
 * width and never sees the full model).
 *
 * Test override: ?hero=static | ?hero=lite | ?hero=mobile | ?hero=full
 * forces a tier (mirrors the ?model= override in MascotModel), so the
 * fallback can be verified on any device.
 */
export type DeviceTier = "static" | "lite" | "mobile" | "full";

// One probe canvas + context, reused across the WebGL checks. A single
// context keeps iOS happy (it's strict about how many live contexts a page
// may hold) and means weakGpuDetected() never pays for a second one.
let probeCanvas: HTMLCanvasElement | null = null;
let probeContext: WebGLRenderingContext | WebGL2RenderingContext | null = null;

function getProbeContext(): WebGLRenderingContext | WebGL2RenderingContext | null {
  if (probeContext) return probeContext;
  if (!probeCanvas) probeCanvas = document.createElement("canvas");
  try {
    probeContext =
      (probeCanvas.getContext("webgl2") as WebGL2RenderingContext | null) ||
      (probeCanvas.getContext("webgl") as WebGLRenderingContext | null) ||
      (probeCanvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
  } catch {
    probeContext = null;
  }
  return probeContext;
}

export function webglAvailable(): boolean {
  if (typeof window === "undefined") return true; // SSR-safe; re-checked on mount
  return Boolean(getProbeContext());
}

// GPU strings that reliably mean "this chip can't push the 3.6MB mobile
// model without choking". Reads the real (unmasked) renderer via
// WEBGL_debug_renderer_info when the browser exposes it; iOS masks the name
// (→ "Apple GPU"), in which case we can't tell and assume the best — the
// RAM/core/width checks already catch old iPhones.
const WEAK_GPU_PATTERNS = [
  /mali-[34]\d\d?/i, // Mali-300/400/450 — pre-2016 budget GPUs
  /mali-g[35]\d/i, // entry Mali G-series (G31/G51/G52/G57)
  /adreno(?: \(tm\))? [234]\d\d/i, // Adreno 200/300/400 series
  /powervr (sgx|ge\d+)/i, // ancient PowerVR cores
  /swiftshader/i, // Chrome's software renderer
  /llvmpipe/i, // Mesa's software renderer
] as const;

/** True when the device's GPU is too weak for the mid-size model. */
function weakGpuDetected(): boolean {
  const gl = getProbeContext();
  if (!gl) return true; // no WebGL at all → treat as incapable
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (!ext) return false; // can't see the GPU name → assume capable
  const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "");
  return WEAK_GPU_PATTERNS.some((re) => re.test(renderer));
}

export function getDeviceTier(): DeviceTier {
  if (typeof window === "undefined") return "full";

  // Debug/test override — force a tier from the URL (?hero=static etc.).
  const forced = new URLSearchParams(window.location.search).get("hero");
  if (forced === "static" || forced === "lite" || forced === "mobile" || forced === "full") {
    return forced;
  }

  if (!webglAvailable()) return "static";

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    maxTouchPoints?: number;
    connection?: { effectiveType?: string; saveData?: boolean };
  };

  // Network first — a starving connection can't afford a 3.6MB download even
  // on a strong phone.
  if (nav.connection?.saveData) return "lite";
  const eff = nav.connection?.effectiveType;
  if (eff === "slow-2g" || eff === "2g") return "lite";

  // GPU BEFORE RAM: the renderer can be the bottleneck even when memory is
  // fine — a 4GB phone with a 2014-era GPU would otherwise pass the RAM
  // check below and land on the 3.6MB model it can't push. Downgrade the
  // visibly-weak renderers to lite no matter what RAM says.
  if (weakGpuDetected()) return "lite";

  const mem = nav.deviceMemory;
  if (typeof mem === "number" && mem > 0) {
    if (mem <= 1) return "static";
    if (mem <= 2) return "lite";
    if (mem <= 4) return "mobile";
  }

  // Low core count = weak device regardless of RAM (covers iOS, which hides
  // deviceMemory entirely).
  const cores = nav.hardwareConcurrency;
  if (typeof cores === "number" && cores > 0 && cores <= 2) return "lite";

  if (eff === "3g") return "mobile";
  if (nav.maxTouchPoints > 0) return "mobile";
  if (window.innerWidth < 768) return "mobile";
  return "full";
}
