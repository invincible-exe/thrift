/**
 * Does the mesh's triangle winding agree with its stored normals? For each
 * triangle, faceNormal = cross(b-a, c-a); it should point the same way as the
 * stored normal at vertex a. If >90% agree, winding is consistent (safe to
 * average face normals for smooth shading). If ~50-60%, winding is mixed and
 * naive averaging would produce wrong shading.
 *
 * Run: npx tsx scripts/check-winding.ts [path]
 */
import * as fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three-stdlib";

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

const path = process.argv[2] ?? "/tmp/modelToUse.original.glb";
const buf = fs.readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(
  MeshoptDecoder() as unknown as Parameters<typeof loader.setMeshoptDecoder>[0]
);

loader.parse(
  ab,
  "",
  (gltf) => {
    let agree = 0;
    let total = 0;
    gltf.scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const geo = (o as THREE.Mesh).geometry;
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const idx = geo.index;
      if (!pos || !nor || !idx) return;
      const tri = idx.count / 3;
      for (let t = 0; t < tri; t++) {
        const a = idx.getX(t * 3);
        const b = idx.getX(t * 3 + 1);
        const c = idx.getX(t * 3 + 2);
        const ux = pos.getX(b) - pos.getX(a);
        const uy = pos.getY(b) - pos.getY(a);
        const uz = pos.getZ(b) - pos.getZ(a);
        const vx = pos.getX(c) - pos.getX(a);
        const vy = pos.getY(c) - pos.getY(a);
        const vz = pos.getZ(c) - pos.getZ(a);
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const dot =
          nx * nor.getX(a) + ny * nor.getY(a) + nz * nor.getZ(a);
        if (dot >= 0) agree++;
        total++;
      }
    });
    const pct = (100 * agree) / total;
    console.log(`winding vs stored normals: ${agree}/${total} (${pct.toFixed(1)}%) — ${pct > 90 ? "CONSISTENT ✓" : "MIXED ✗"}`);
  },
  (err) => {
    console.error("load failed:", err);
    process.exit(1);
  }
);
