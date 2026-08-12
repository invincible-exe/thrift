"use client";

import { useEffect, useState } from "react";

/**
 * "Is it safe to mount the heavy client-only stuff yet?"
 *
 * Returns true once the document has finished parsing (DOMContentLoaded) AND
 * the browser has painted one more frame. Mounting WebGL / starting big
 * fetches before this point is a known first-load failure on phones:
 *  - iOS Safari can fail WebGL context creation while the page is still
 *    loading (works on refresh, when everything is cached and the GPU
 *    scheduler is free).
 *  - iOS has been observed to throttle/abort in-flight fetches (like a GLB
 *    model download) that were started during the load window.
 *  - A <Canvas> that mounts before layout settles can get a zero-size
 *    container and render nothing.
 *
 * The one-rAF after the DOM is parsed guarantees the hero container has its
 * final size before the canvas mounts. A 4s safety cap means the 3D never
 * waits forever even in an environment where DOMContentLoaded is delayed.
 */
export function usePageReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    let cancelled = false;

    const go = () => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true);
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", go, { once: true });
    } else {
      go();
    }

    // DOMContentLoaded never waits on slow images, but guard against any
    // environment where it is delayed — the hero must not wait forever.
    // Note this sets ready DIRECTLY rather than via go(): rAF is suspended
    // in backgrounded tabs, so routing the safety through it could stall
    // the 3D indefinitely.
    const safety = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 4000);

    return () => {
      cancelled = true;
      window.clearTimeout(safety);
      document.removeEventListener("DOMContentLoaded", go);
    };
  }, [ready]);

  return ready;
}
