"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

/**
 * The hero model (public/models/modelToUse.glb): the 6 fashion characters as
 * a single mesh, feet at local y = -0.834. Lifted so the feet hover around
 * the ground plane, then given a slow, gentle float so the lineup bobs in
 * place like it's suspended in the air. No other animation.
 *
 * Three variants are served (built by scripts/compress-model.ts, all
 * meshopt-compressed and decoded automatically by drei — no setup needed):
 *  - modelToUse.glb        (~7MB)  the full lineup, welded to ~500K verts
 *  - modelToUse-mobile.glb (~3.6MB) a decimated variant for phones, low-RAM
 *    machines and slow connections. Same bounds, same runtime behavior.
 *  - modelToUse-lite.glb   (~0.9MB) a further-decimated fallback for the
 *    lowest-end devices (≤2GB RAM / save-data / 2G). Same bounds.
 *
 * The GLBs are mirrored to the public `models` bucket on Supabase Storage
 * (uploaded from scripts/upload-models.sh) and loaded from there when
 * NEXT_PUBLIC_SUPABASE_URL is set — Supabase's CDN serves the full file at
 * full speed, so the models never travel through a tunnel (ngrok free tier
 * truncates large downloads, which broke the hero on the phone). Falls back
 * to the local /models/* paths in dev / when no bucket is configured.
 *
 * Override for testing: ?model=mobile, ?model=lite or ?model=full forces a
 * variant.
 *
 * The GLB ships plain WHITE materials, so every mesh gets swapped for a
 * fresh PBR material. The aesthetic is a greyscale MANNEQUIN look — like
 * sculpted display figures in a studio: matte charcoal bodies, per-figure
 * tonal variation, and strong key-light contrast (bright front faces, deep
 * shadow sides) instead of a flat white wash.
 *
 * Because all 6 characters are welded into ONE mesh, we can't give each
 * character its own material. Instead we bake per-character tone into
 * vertex colors: each vertex is binned by its X position (the characters
 * stand in a row left to right), and the material runs with vertexColors so
 * every character keeps its own shade of charcoal while staying in one
 * draw call.
 *
 * Note: we build a brand-new MeshStandardMaterial instead of cloning the
 * loaded one. GLBs often ship unlit/basic materials (MeshBasicMaterial),
 * which ignore lights entirely — cloning those keeps the model flat white
 * no matter how the scene is lit. A standard material actually responds to
 * the ambient/directional lights and the environment map.
 */
// Serve the models from Supabase Storage (public bucket) when the project
// URL is configured — the files live on Supabase's CDN, not behind the app
// server, so a tunnel's throughput cap can't truncate them mid-download.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
const modelsBase = supabaseUrl
  ? `${supabaseUrl}/storage/v1/object/public/models`
  : "";
const local = (name: string) => `/models/${name}`;
const MODEL_FULL = modelsBase ? `${modelsBase}/modelToUse.glb` : local("modelToUse.glb");
const MODEL_MOBILE = modelsBase
  ? `${modelsBase}/modelToUse-mobile.glb`
  : local("modelToUse-mobile.glb");
const MODEL_LITE = modelsBase
  ? `${modelsBase}/modelToUse-lite.glb`
  : local("modelToUse-lite.glb");

/**
 * Which variant this device should load.
 *  - LITE: the truly crippled tier — save-data mode, 2G/slow-2G, or ≤2GB RAM.
 *    The 0.9MB model is all a struggling phone needs at hero scale.
 *  - MOBILE: phones and tablets (touch), ≤4GB RAM, and slow connections (3G).
 *    iOS doesn't report deviceMemory, hence the touch + width checks.
 *  - FULL: everything else — the full ~7MB lineup.
 */
function modelUrl(): string {
  if (typeof window !== "undefined") {
    const forced = new URLSearchParams(window.location.search).get("model");
    if (forced === "lite" || forced === "mobile" || forced === "full") {
      return forced === "lite" ? MODEL_LITE : forced === "mobile" ? MODEL_MOBILE : MODEL_FULL;
    }
  }
  if (typeof navigator === "undefined") return MODEL_FULL; // SSR-safe
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    maxTouchPoints?: number;
    connection?: { effectiveType?: string; saveData?: boolean };
  };
  if (nav.connection?.saveData) return MODEL_LITE;
  const eff = nav.connection?.effectiveType;
  if (eff === "slow-2g" || eff === "2g") return MODEL_LITE;
  if (eff === "3g") return MODEL_MOBILE;
  const mem = nav.deviceMemory;
  if (typeof mem === "number" && mem > 0 && mem <= 2) return MODEL_LITE;
  if (typeof mem === "number" && mem > 0 && mem <= 4) return MODEL_MOBILE;
  // Touch screens = phones/tablets (catches landscape too, where the width
  // check below would miss them); the 3.6MB variant is plenty at phone scale.
  if (nav.maxTouchPoints > 0) return MODEL_MOBILE;
  if (window.innerWidth < 768) return MODEL_MOBILE;
  return MODEL_FULL;
}

const FEET_Y = 0.834;

// Six charcoal shades — one per character, ordered left to right. The key
// light multiplies the albedo ~2x on the brightest faces while shadow sides
// get only ambient + fill, so these dark mid-tones render as sculpted
// greys: light highlights on front, deep charcoal in the shade — the
// mannequin look, not a white blowout.
const CHARACTER_TONES = [
  "#2e2f33",
  "#34353a",
  "#3b3c41",
  "#424349",
  "#494a50",
  "#505157",
] as const;
const TONE_COLORS = CHARACTER_TONES.map((hex) => new THREE.Color(hex));

// Gentle float — how high it rises above the ground and how slowly it bobs.
// The amplitude stays modest so the bobbing head never bumps the display
// window's top edge.
const FLOAT_HOVER = 0.06; // keeps the feet airborne, never below the ground plane
const FLOAT_AMPLITUDE = 0.1;
const FLOAT_SPEED = 1.1;

export function MascotModel() {
  // Decided once per mount — deterministic per device, so the preload below
  // always matches what this component renders.
  const [url] = useState(modelUrl);
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  // Respect the site-wide reduced-motion preference (checked once on mount).
  const reducedMotion = useRef(false);

  useLayoutEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useLayoutEffect(() => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    // Fresh PBR material per mesh (multi-material meshes get one each). A
    // MeshStandardMaterial responds to the scene lights + environment map,
    // so the greyscale characters shade naturally instead of staying flat.
    const makeTint = () =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff, // base is white so only the vertex colors show
        vertexColors: true,
        roughness: 0.92, // matte mannequin finish, not glossy plastic
        metalness: 0,
        // Keep the soft studio reflections subtle so the key light reads as
        // sculpted contrast instead of washing the greys out to white.
        envMapIntensity: 0.4,
      });

    meshes.forEach((mesh) => {
      const geo = mesh.geometry;
      const position = geo.attributes.position;
      if (position) {
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (bb) {
          const span = Math.max(bb.max.x - bb.min.x, 1e-6);
          const colors = new Float32Array(position.count * 3);
          const arr = position.array as Float32Array;
          for (let i = 0; i < position.count; i++) {
            // Normalize X across the lineup, then pick that character's tone.
            // (Reads straight from the position buffer — 3M desktop verts,
            // ~140K on the mobile variant.)
            const t = (arr[i * 3] - bb.min.x) / span; // 0..1 left to right
            // t ∈ [0,1] so idx can't go negative; cap at the last tone so a
            // vertex exactly on bb.max.x (t = 1) lands in the final bin.
            const idx = Math.min(
              TONE_COLORS.length - 1,
              Math.floor(t * TONE_COLORS.length)
            );
            const c = TONE_COLORS[idx];
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
          }
          geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        }
      }

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(makeTint);
      } else {
        mesh.material = makeTint();
      }
    });
  }, [scene]);

  // Slow sine bob — the lineup hovers gently in the air.
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || reducedMotion.current) return;
    // Centered upward so the feet range FLOAT_HOVER..FLOAT_HOVER+2*AMPLITUDE
    // (0.06..0.26) and never dip below the ground plane.
    group.position.y =
      FEET_Y +
      FLOAT_HOVER +
      FLOAT_AMPLITUDE +
      Math.sin(clock.elapsedTime * FLOAT_SPEED) * FLOAT_AMPLITUDE;
  });

  return (
    <group ref={groupRef} position={[0, FEET_Y, 0]}>
      <primitive object={scene} />
    </group>
  );
}

// Kick off the fetch for the variant this device will use as soon as the
// hero module loads. Safe at module scope: Hero3D is dynamically imported
// with ssr:false, so this only ever evaluates in the browser.
useGLTF.preload(modelUrl());
