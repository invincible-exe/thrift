"use client";

import { Suspense, useContext, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import ErrorBoundary from "./ui/ErrorBoundary";
import ModelRetryBoundary, { ModelGlow, ModelStatusContext } from "./ModelRetryBoundary";
import { getDeviceTier } from "@/lib/device";
import { usePageReady } from "@/lib/use-page-ready";
import styles from "./CyberCard.module.css";

// No loading fallback here: the branded loading overlay (below) is the single
// loading indicator, so the card never shows two competing loading states
// while the chunk downloads.
const Hero3D = dynamic(() => import("./Hero3D"), { ssr: false });

// Phone GPUs are the risky case for the 3M-vertex model. The shared tier
// check (src/lib/device.ts) decides whether this device gets 3D at all:
//  - static tier (no WebGL / ≤1GB RAM): the model never loads, the poster
//    shows, and the hero costs nothing beyond the card chrome — previously a
//    WebGL failure would unmount everything.
//  - lite/mobile tiers: the decimated variants still render, and the
//    ErrorBoundary below catches any real WebGL crash and swaps in the
//    poster, so a failure can't kill the page or the experience.

// Drag-to-rotate tuning. Sensitivity in radians per pixel; vertical tilt is
// clamped so the lineup never tips over (0.9 rad ≈ 52°).
const ROTATE_SENSITIVITY = 0.012;
const MAX_VERTICAL_TILT = 0.9;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

// 5x5 tracker grid. Each cell gets a --rx/--ry pair that the single CSS hover
// rule reads, so we don't need 25 hard-coded CSS blocks (the original card
// ships one block per cell). Top rows tip the card back, bottom rows forward;
// left columns yaw left, right columns yaw right.
const TRACKER_TILTS = [
  { area: "tr-1", rx: 20, ry: -10 },
  { area: "tr-2", rx: 20, ry: -5 },
  { area: "tr-3", rx: 20, ry: 0 },
  { area: "tr-4", rx: 20, ry: 5 },
  { area: "tr-5", rx: 20, ry: 10 },
  { area: "tr-6", rx: 10, ry: -10 },
  { area: "tr-7", rx: 10, ry: -5 },
  { area: "tr-8", rx: 10, ry: 0 },
  { area: "tr-9", rx: 10, ry: 5 },
  { area: "tr-10", rx: 10, ry: 10 },
  { area: "tr-11", rx: 0, ry: -10 },
  { area: "tr-12", rx: 0, ry: -5 },
  { area: "tr-13", rx: 0, ry: 0 },
  { area: "tr-14", rx: 0, ry: 5 },
  { area: "tr-15", rx: 0, ry: 10 },
  { area: "tr-16", rx: -10, ry: -10 },
  { area: "tr-17", rx: -10, ry: -5 },
  { area: "tr-18", rx: -10, ry: 0 },
  { area: "tr-19", rx: -10, ry: 5 },
  { area: "tr-20", rx: -10, ry: 10 },
  { area: "tr-21", rx: -20, ry: -10 },
  { area: "tr-22", rx: -20, ry: -5 },
  { area: "tr-23", rx: -20, ry: 0 },
  { area: "tr-24", rx: -20, ry: 5 },
  { area: "tr-25", rx: -20, ry: 10 },
] as const;

/**
 * Premium drop-card display for the hero's 3D lineup. A dark, softly lit
 * card with an editorial header/footer and a lime-and-ember spotlight
 * behind the model, which renders in a display window between them — the
 * window's top padding guarantees headroom so the lineup never crowds the
 * card's top edge. A 5x5 grid of invisible trackers drives the 3D tilt:
 * hover any part of the card and it pivots toward your cursor.
 *
 * Pointer notes: the trackers sit above everything (z-200) and own all
 * pointer events, so the model runs without OrbitControls — instead,
 * pressing and dragging anywhere on the card spins the lineup like a
 * turntable (drag deltas feed Hero3D's rotationTarget), while hovering
 * still tilts the card.
 */
/**
 * Branded loading overlay for the model window. Rendered OVER the canvas
 * from the first moment (page ready, chunk download, GLB fetch, retry
 * backoff) and fades out the instant the model actually paints (via
 * ModelStatusContext), so a first-time visitor never stares at an
 * unexplained empty hole in the card.
 */
function ModelLoadingLayer() {
  const status = useContext(ModelStatusContext);
  const loading = status ? !status.loaded : true;
  return (
    <div
      aria-hidden={!loading}
      className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-700 ${
        loading ? "opacity-100" : "opacity-0"
      }`}
    >
      <ModelGlow />
    </div>
  );
}

/** Static poster shown when the 3D can't run (no WebGL / low-end device). */
function StaticPoster() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-24 w-24 rounded-full bg-gradient-to-br from-lime/50 via-accent/40 to-accent/20 blur-2xl" />
        <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-cream/50">
          The fit, in 3D
        </span>
      </div>
    </div>
  );
}

export default function CyberCard() {
  // Turntable state — the model only turns while the pointer drags it. The
  // targets are written here and eased toward by Hero3D every frame.
  const rotation = useRef({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // The 3D stack (three.js chunk download, WebGL context creation, GLB
  // fetch) only starts once the page has finished loading — see
  // usePageReady. Creating WebGL contexts / starting big fetches during the
  // load window is a known mobile failure mode (iOS Safari in particular):
  // the context can fail to create and in-flight fetches can be aborted,
  // which is exactly the "works on refresh but not first load" symptom.
  const pageReady = usePageReady();
  // Tier is decided exactly once, and only once the page has settled — the
  // WebGL probe inside getDeviceTier can itself fail during the load window
  // (→ wrongly "static") and succeed a moment later, so trusting it during
  // load would hide the 3D from working phones. Re-checking after pageReady
  // turns a false-static phone into a working 3D hero with no user action.
  // Render-phase adjustment (the same keyed pattern as the feed's near-me
  // auto-seed); the null guard keeps it to a single evaluation.
  const [render3D, setRender3D] = useState<boolean | null>(null);
  if (pageReady && render3D === null) {
    setRender3D(getDeviceTier() !== "static");
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    // Keep receiving moves even when the pointer races past the card edge.
    // Guarded: a second simultaneous touch can make capture throw.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already captured elsewhere — dragging still works without it.
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragStart.current = { x: e.clientX, y: e.clientY };
    // Horizontal drags spin the lineup around its vertical axis; vertical
    // drags tip it around its middle, clamped so it never tips over.
    rotation.current.y += dx * ROTATE_SENSITIVITY;
    rotation.current.x = clamp(
      rotation.current.x + dy * ROTATE_SENSITIVITY,
      -MAX_VERTICAL_TILT,
      MAX_VERTICAL_TILT
    );
  };

  const endDrag = () => {
    dragStart.current = null;
    setDragging(false);
  };

  return (
    <div className={styles.container}>
      <div
        className={dragging ? `${styles.canvas} ${styles.dragging}` : styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        {TRACKER_TILTS.map((cell) => (
          <div
            key={cell.area}
            className={styles.tracker}
            style={
              {
                gridArea: cell.area,
                "--rx": `${cell.rx}deg`,
                "--ry": `${cell.ry}deg`,
              } as CSSProperties
            }
          />
        ))}

        <div className={styles.card}>
          <div className={styles.cardContent}>
            {/* Warm lime + ember spotlight behind the lineup. */}
            <div className={styles.spotlight} />

            <div className={styles.header}>
              <span className={styles.wordmark}>10/10 Thrifts</span>
              <span className={styles.dropIndex}>Drop 001</span>
            </div>

            {/* The model renders in the display window between header and
                footer — top padding keeps it clear of the card's edge. If
                the device can't run WebGL (or is low-end), the static
                poster shows instead of the heavy model. Two layers of
                protection keep a first-load hiccup from looking broken:
                 - the Hero3D chunk (three.js + the GLB fetches) doesn't
                   even START until the page has finished loading, and
                 - ModelRetryBoundary re-mounts the 3D after any failure
                   (clearing the poisoned loader cache first), so a single
                   aborted model download self-heals instead of needing a
                   refresh; only after retries does the poster appear. */}
            <div className={styles.modelSlot}>
              {render3D === null ? (
                // Page still loading — show the branded loading state until
                // the tier is decided (the 3D is deferred to page-ready).
                <ModelLoadingLayer />
              ) : render3D === true ? (
                <ErrorBoundary fallback={<StaticPoster />}>
                  <ModelRetryBoundary>
                    <ModelLoadingLayer />
                    <Suspense fallback={null}>
                      <Hero3D interactive={false} rotationTarget={rotation} />
                    </Suspense>
                  </ModelRetryBoundary>
                </ErrorBoundary>
              ) : (
                <StaticPoster />
              )}
            </div>

            <div className={styles.footer}>
              <div className={styles.title}>
                Fresh
                <br />
                Drops
              </div>
              <div className={styles.rule} />
              <div className={styles.footerRow}>
                <span className={styles.meta}>Hand-picked · 10/10</span>
                <span className={styles.hint}>Drag to rotate</span>
              </div>
            </div>

            <div className={styles.cardGlare} />
          </div>
        </div>
      </div>
    </div>
  );
}
