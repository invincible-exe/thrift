/**
 * Device capability tiers for the 3D hero — one source of truth used by:
 *  - CyberCard: whether to mount the 3D at all ("static" → branded poster)
 *  - MascotModel: which GLB variant to load ("lite" | "mobile" | "full")
 *  - Hero3D: renderer tuning per tier (dpr cap, antialias)
 *
 * Tier ladder (worst → best):
 *  - static: no WebGL, or ≤1GB RAM — the 3D never mounts; the static poster
 *    shows instead. Even the 0.9MB lite model plus a WebGL loop can starve
 *    a 1GB phone, so it gets zero 3D cost.
 *  - lite:   save-data, 2G/slow-2G, ≤2GB RAM, or ≤2 CPU cores — the 0.9MB
 *    decimated model, dpr capped at 1, antialias off.
 *  - mobile: 3G, ≤4GB RAM, touch, or a <768px viewport — the 3.6MB mobile
 *    model, dpr ≤1.2, antialias off (MSAA is the biggest GPU cost at phone
 *    scale and the 1.2 cap barely hides it).
 *  - full:   everything else — the ~7MB lineup at native dpr.
 *
 * iOS Safari doesn't report deviceMemory, so the core-count / touch / width
 * checks carry the load there (a 2016-era iPhone is caught by cores or
 * width and never sees the full model).
 *
 * Test override: ?hero=static | ?hero=lite | ?hero=mobile | ?hero=full
 * forces a tier (mirrors the existing ?model= override in MascotModel), so
 * the fallback can be verified on any device.
 */
export type DeviceTier = "static" | "lite" | "mobile" | "full";

export function webglAvailable(): boolean {
  if (typeof window === "undefined") return true; // SSR-safe; re-checked on mount
  try {
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ||
      probe.getContext("webgl") ||
      probe.getContext("experimental-webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
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
