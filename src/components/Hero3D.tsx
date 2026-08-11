"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { getDeviceTier, type DeviceTier } from "@/lib/device";
import { MascotModel } from "./MascotModel";

/**
 * Procedural studio environment. Builds a neutral indoor reflection map with
 * three's built-in RoomEnvironment + PMREMGenerator — no network fetch, no
 * HDR download — so the model's PBR materials get soft, even reflections
 * instead of bouncing light off a blank white void.
 */
function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  useEffect(() => {
    // three.js scenes are mutable by design, but the immutability lint rule
    // rejects writes straight off hook values. Mirror into refs inside the
    // effect, then mutate through them.
    glRef.current = gl;
    sceneRef.current = scene;
    const renderer = glRef.current;
    const target = sceneRef.current;
    if (!renderer || !target) return;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    target.environment = envTexture;

    return () => {
      target.environment = null;
      envTexture.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  return null;
}

// Camera rig — kept as constants so the responsive fit (below) and the
// <Canvas camera> / OrbitControls stay in sync.
const CAMERA_POSITION: [number, number, number] = [0, 1.2, 5.4];
const CAMERA_FOV = 38;
const CAMERA_TARGET_Y = 0.8;

// Slight downward bias applied to the stage: the lineup sits a touch below
// the viewport's true center so its head stays comfortably clear of the
// card's top edge — and the float bob never pushes it into it.
const STAGE_OFFSET_Y = -0.2;

// Model footprint (world units, measured with scripts/inspect-glb.ts): the
// lineup spans x ∈ [-1, 1] and y ∈ [-0.834, 0.834] — 2.0 wide, 1.668 tall.
// The stage is framed around the model's MID-HEIGHT, not its feet: the
// whole stage group sits on the camera target and the model is offset so
// its center lands on the stage origin — dead-center in the card window.
const MODEL_WIDTH = 2.0;
const MODEL_HEIGHT = 1.668;

// Half the model's height. Offsetting the model down by this puts its center
// exactly on the stage origin, which doubles as the drag-rotation pivot —
// vertical drags tilt around the middle, not the feet.
const MODEL_CENTER_Y = 0.834;

// How much of the display window the model should fill on its binding axis
// (a little under 1 = breathing room on every side).
const FIT_TARGET = 0.8;
const MIN_SCALE = 0.75;
// Desktop cap — the height fit (below) would land at ~1.79, so on wider
// screens this keeps the lineup from ballooning while still filling the
// display window; phones are width-bound well below it anyway.
const MAX_SCALE = 1.55;

/**
 * Responsive stage. The model is CENTERED on the camera target (its mid-height
 * sits on the viewport's center line), so the honest fit is symmetric: half
 * the model must clear half the visible height, and half its width must clear
 * half the visible width — giving balanced margins all around. The visible
 * height/width come from the camera rig + the live canvas `size` (pixels),
 * which updates on resize — so phones, tablets, laptops and ultrawide
 * monitors all frame the lineup the same way, with no fixed-camera cropping.
 *
 * The scale lives on a wrapper group, so the model's own float animation
 * and the contact shadow stay locked relative to each other.
 */
function useResponsiveScale(): number {
  const size = useThree((s) => s.size);

  return useMemo(() => {
    if (size.width < 1 || size.height < 1) return 1;

    const dist = Math.hypot(CAMERA_POSITION[2], CAMERA_POSITION[1] - CAMERA_TARGET_Y);
    const visibleH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    const visibleW = visibleH * (size.width / size.height);

    // Height bound: the model's half-height must clear half the visible
    // height, scaled by FIT_TARGET.
    const scaleH = (visibleH * FIT_TARGET) / MODEL_HEIGHT;
    // Width bound: the model's half-width must clear half the visible width.
    const scaleW = (visibleW * FIT_TARGET) / MODEL_WIDTH;

    return THREE.MathUtils.clamp(Math.min(scaleH, scaleW), MIN_SCALE, MAX_SCALE);
  }, [size.width, size.height]);
}

function Stage({
  modelRef,
  smallScreen = false,
}: {
  modelRef?: RefObject<THREE.Group | null>;
  smallScreen?: boolean;
}) {
  const scale = useResponsiveScale();
  return (
    // Park the stage on the camera target minus a small downward bias, so
    // the model's center lands just below the viewport's center line — the
    // head stays clear of the card's top edge while margins stay balanced.
    <group position={[0, CAMERA_TARGET_Y + STAGE_OFFSET_Y, 0]} scale={scale}>
      <Suspense fallback={null}>
        {/* The rotation group wraps only the model, so the contact shadow
            below stays put. Its origin is the model's mid-height, so drag
            rotation spins the lineup around its own center. */}
        <group ref={modelRef}>
          <group position={[0, -MODEL_CENTER_Y, 0]}>
            <MascotModel />
          </group>
        </group>
        <ContactShadows
          position={[0, -MODEL_CENTER_Y + 0.02, 0]}
          opacity={0.38}
          scale={7}
          blur={2.5}
          far={1.6}
          resolution={smallScreen ? 256 : 512}
          // Render the shadow depth map ONCE instead of every frame — the
          // lineup only floats ±0.1 units, so a static blurred shadow is
          // visually identical but skips a full scene re-render per frame
          // (the single biggest GPU win on phones).
          frames={1}
          color="#000000"
        />
      </Suspense>
    </group>
  );
}

/**
 * The non-interactive stage, used when the model is embedded in a surface
 * that owns the pointer (the CyberCard's tilt trackers), so orbit-drag isn't
 * available. The lineup keeps its idle float but never rotates on its own —
 * it only turns when the host surface writes drag deltas into
 * `rotationTarget`. `autoRotate` remains for callers that still want the old
 * self-turning behavior (it respects reduced motion).
 */
// Shared rotation state between the host surface (CyberCard) and the stage:
// the host writes { x, y } target angles, the stage eases the model toward
// them every frame.
export type RotationTarget = { x: number; y: number };

function RotatingStage({
  autoRotate = false,
  rotationTarget,
  smallScreen = false,
}: {
  autoRotate?: boolean;
  rotationTarget?: RefObject<RotationTarget>;
  smallScreen?: boolean;
}) {
  const modelRef = useRef<THREE.Group>(null);
  const reducedMotion = useRef(false);

  useLayoutEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useFrame((_, delta) => {
    const model = modelRef.current;
    if (!model) return;

    if (autoRotate && !reducedMotion.current) {
      // ~a full turn every 15s — slow enough to feel alive, fast enough to
      // show the whole lineup.
      model.rotation.y += delta * 0.4;
    }

    const target = rotationTarget?.current;
    if (target) {
      // Exponential catch-up (τ ≈ 80ms): responds instantly while dragging,
      // then eases to rest the moment the pointer stops — no jitter, no
      // self-spin, and the model stays exactly where the user left it.
      const k = 1 - Math.exp(-delta * 12);
      model.rotation.y += (target.y - model.rotation.y) * k;
      model.rotation.x += (target.x - model.rotation.x) * k;
    }
  });

  return <Stage modelRef={modelRef} smallScreen={smallScreen} />;
}

/**
 * The 3D hero. The model is rendered as-is (no animations beyond its gentle
 * float); the setup around it is a proper studio:
 *  - sRGB output + ACES filmic tone mapping so materials read correctly,
 *  - a soft ambient fill + off-center directional key for natural shading,
 *  - a procedural environment map so PBR materials catch light,
 *  - a faint contact shadow so the lineup looks grounded, not washed out.
 *
 * Responsive: the model is scaled to fit the live canvas (see
 * useResponsiveScale) so it frames well on phones, laptops and ultrawide
 * screens, and the pixel ratio is capped lower on small screens — the
 * 3M-vertex model is heavy for phone GPUs.
 *
 * Props:
 *  - interactive: enable orbit controls (default true). Disable when the
 *    model sits inside the CyberCard, whose tilt trackers own the pointer.
 *  - autoRotate: when interactive is false, gently rotate the lineup.
 *  - rotationTarget: when interactive is false, a shared ref the host
 *    surface writes drag deltas into — the model only turns when the user
 *    turns it (no self-rotation).
 */
export default function Hero3D({
  interactive = true,
  autoRotate = false,
  rotationTarget,
}: {
  interactive?: boolean;
  autoRotate?: boolean;
  rotationTarget?: RefObject<RotationTarget>;
} = {}) {
  // The model has ~3M vertices — tune the renderer to the device tier:
  // native dpr on desktop, capped lower on phones, and on the lite tier
  // (≤2GB RAM / ≤2 cores / 2G) render at exactly 1x with antialiasing off
  // — MSAA is the single biggest GPU cost and barely matters at 1x.
  // `ssr: false` in Hero.tsx means `window` is safe here.
  const tier: DeviceTier = typeof window !== "undefined" ? getDeviceTier() : "full";
  const smallScreen = typeof window !== "undefined" && window.innerWidth < 768;
  const dpr: [number, number] =
    tier === "lite" || tier === "static" ? [1, 1] : smallScreen ? [1, 1.2] : [1, 2];

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: CAMERA_POSITION, fov: CAMERA_FOV }}
        gl={{
          // Weak GPUs (lite + mobile tiers) skip MSAA entirely.
          antialias: tier === "full",
          alpha: true,
          outputColorSpace: THREE.SRGBColorSpace,
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
        dpr={dpr}
        style={{ width: "100%", height: "100%" }}
      >
        <StudioEnvironment />
        {/* Sculpted studio lighting for the mannequin look: a strong key
            light, minimal fill, and a back rim to carve the silhouettes. */}
        <ambientLight intensity={0.32} />
        <directionalLight position={[4, 6, 4]} intensity={1.5} />
        <directionalLight position={[-5, 3, -2]} intensity={0.22} />
        <directionalLight position={[-1.5, 2.5, -5]} intensity={0.55} />
        {interactive ? (
          <>
            <Stage smallScreen={smallScreen} />
            <OrbitControls
              target={[0, CAMERA_TARGET_Y + STAGE_OFFSET_Y, 0]}
              enablePan={false}
              enableZoom
              minDistance={3.4}
              maxDistance={6.5}
              minPolarAngle={Math.PI / 3.4}
              maxPolarAngle={Math.PI / 1.7}
              rotateSpeed={0.9}
              zoomSpeed={0.8}
            />
          </>
        ) : (
          <RotatingStage
            autoRotate={autoRotate}
            rotationTarget={rotationTarget}
            smallScreen={smallScreen}
          />
        )}
      </Canvas>
    </div>
  );
}
