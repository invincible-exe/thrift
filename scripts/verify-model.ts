/**
 * VERIFY — loads a GLB with three's GLTFLoader using the SAME meshopt decoder
 * drei ships (three-stdlib), then prints geometry stats. Fails if the file
 * doesn't parse or if position attributes aren't Float32Array (MascotModel
 * reads `position.array as Float32Array` to bake per-character vertex colors,
 * so a KHR_mesh_quantization Int16Array would silently break the look).
 *
 * Run: npx tsx scripts/verify-model.ts [path]
 */
import * as fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three-stdlib";

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
// Same meshopt decoder drei registers automatically (from three-stdlib).
loader.setMeshoptDecoder(
  MeshoptDecoder() as unknown as Parameters<typeof loader.setMeshoptDecoder>[0]
);

loader.parse(
  ab,
  "",
  (gltf) => {
    let meshes = 0;
    let verts = 0;
    let posType = "";
    const box = new THREE.Box3();
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        meshes++;
        const geo = (o as THREE.Mesh).geometry;
        verts += geo.attributes.position.count;
        posType = (geo.attributes.position.array as unknown as { constructor: { name: string } })
          .constructor.name;
        if (box.isEmpty()) {
          geo.computeBoundingBox();
          if (geo.boundingBox) box.copy(geo.boundingBox);
        }
      }
    });
    console.log("OK  meshes:", meshes, "| vertices:", verts, "| position type:", posType);
    if (!box.isEmpty()) {
      const min = box.min.toArray().map((v) => +v.toFixed(3)).join(", ");
      const max = box.max.toArray().map((v) => +v.toFixed(3)).join(", ");
      console.log("    bounds:", min, "->", max);
    }
    if (posType !== "Float32Array") {
      console.error("FAIL: positions are " + posType + " — MascotModel's vertex-color code reads Float32Array");
      process.exit(2);
    }
    console.log("    ✓ Float32Array positions — safe for MascotModel");
  },
  (err) => {
    console.error("load failed:", err);
    process.exit(1);
  }
);
