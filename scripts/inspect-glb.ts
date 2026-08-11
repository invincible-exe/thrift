/**
 * TEMPORARY dev utility — inspects a GLB so we can decide between a skinned
 * rig (arm sway / head tilt) or procedural whole-body animation, and see the
 * materials we can recolor. Run: npx tsx scripts/inspect-glb.ts [path]
 */
import * as fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- Minimal DOM stubs so GLTFLoader can parse in Node (textures become blank) ---
const g = globalThis as unknown as Record<string, unknown>;
g.self = globalThis;
g.document = {
  createElementNS: () => {
    const img: Record<string, unknown> = {};
    const listeners: Record<string, Array<() => void>> = {};
    Object.defineProperty(img, "src", {
      set() {
        queueMicrotask(() => (listeners["load"] ?? []).forEach((f) => f()));
      },
    });
    img.addEventListener = (ev: string, fn: () => void) => {
      (listeners[ev] ??= []).push(fn);
    };
    img.removeEventListener = () => {};
    img.decode = async () => {};
    img.width = 1;
    img.height = 1;
    img.naturalWidth = 1;
    img.naturalHeight = 1;
    return img;
  },
} as unknown as Document;

g.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
g.Image = class {
  get complete() { return true; }
  get naturalWidth() { return 1; }
  get naturalHeight() { return 1; }
  addEventListener() {}
  removeEventListener() {}
  decode = async () => {};
};

const path = process.argv[2] ?? "public/models/modelToUse.glb";
const buf = fs.readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
loader.parse(
  ab,
  "",
  (gltf) => {
    const scene = gltf.scene;
    console.log("animations:", gltf.animations.length);
    scene.traverse((o) => {
      console.log("node:", o.type, JSON.stringify(o.name || "(unnamed)"), "parent:", o.parent?.type);
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        const geo = mesh.geometry;
        const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
        const mats = Array.isArray(mat) ? mat : [mat];
        const skinned = (o as THREE.SkinnedMesh).isSkinnedMesh;
        console.log(
          "  SKINNED:",
          skinned ? "yes" : "no",
          "| materials:",
          mats
            .map((m) => {
              const color = m.color ? `#${m.color.getHexString()}` : "none";
              const img = m.map?.image as { width?: number; height?: number } | undefined;
              const map = m.map ? `texture(${img?.width ?? "?"}x${img?.height ?? "?"})` : "no-texture";
              return `${m.name || "(unnamed)"} [${color}, ${map}]`;
            })
            .join(", ")
        );
        console.log(
          "  MESH — morphs:",
          geo.morphAttributes ? Object.keys(geo.morphAttributes).join(",") || "none" : "none",
          "| indexed:",
          geo.index ? geo.index.count : "none"
        );
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        console.log(
          "  bounds:",
          bb.min.toArray().map((v) => +v.toFixed(3)).join(", "),
          "->",
          bb.max.toArray().map((v) => +v.toFixed(3)).join(", ")
        );
        const pos = geo.attributes.position;
        console.log("  vertices:", pos.count);
        // X-extent per Y slice — reveals whether arms stick out (rig-splittable)
        const slices = 12;
        const loY = bb.min.y;
        const hiY = bb.max.y;
        const rows: string[] = [];
        for (let s = 0; s < slices; s++) {
          const y0 = loY + ((hiY - loY) * s) / slices;
          const y1 = loY + ((hiY - loY) * (s + 1)) / slices;
          let maxX = -Infinity;
          let minX = Infinity;
          for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y >= y0 && y < y1) {
              const x = pos.getX(i);
              if (x > maxX) maxX = x;
              if (x < minX) minX = x;
            }
          }
          const mid = ((y0 + y1) / 2).toFixed(2);
          rows.push(
            `  y=${mid}: x[${minX === Infinity ? "-" : minX.toFixed(2)}, ${maxX === -Infinity ? "-" : maxX.toFixed(2)}]`
          );
        }
        console.log(rows.join("\n"));
      }
    });
  },
  (err) => {
    console.error("load failed:", err);
    process.exit(1);
  }
);
