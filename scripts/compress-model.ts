/**
 * Asset pipeline for the hero model (public/models/modelToUse.glb).
 *
 * Produces two files from one source:
 *  1. FULL   — the hero model, position-welded (3M → ~500K verts) then
 *              meshopt-compressed (~7MB). The weld removes the scan's
 *              per-triangle vertex duplication so every device renders ~6x
 *              fewer vertices.
 *  2. MOBILE — a decimated variant for phones / slow connections
 *              (ratio-tunable, default 0.5), served by MascotModel based on
 *              device memory, connection speed and screen size.
 *
 * Winding note: the source's triangle winding is 100% consistent with its
 * stored normals (checked by scripts/check-winding.ts), so the recomputed
 * smooth normals below point outward correctly.
 *
 * WHY a CUSTOM position-only weld: the source is effectively a triangle soup —
 * 2.99M vertices but only ~500K unique positions, and coincident vertices
 * carry different normals/UVs per triangle. Stock weld() hashes the FULL
 * vertex (position + normal + uv), so it can't merge those — and it skips
 * already-indexed primitives unless overwrite:true. This script welds by
 * position alone (grid cells of `WELD_TOLERANCE` world units), then
 * recomputes smooth normals on the merged topology.
 *
 * WHY simplifySloppy (mobile): with no edge-collapse topology available in
 * the raw soup, meshoptimizer's simplifySloppy (vertex clustering) is the
 * one that actually reduces it.
 *
 * WHY dequantize(): the meshopt() transform also applies KHR_mesh_quantization,
 * which stores POSITION as Int16Array. MascotModel reads `position.array` as a
 * Float32Array to bake per-character vertex colors — an Int16Array would
 * silently break the look. dequantize() converts accessors back to float32
 * (with correct rescaling) while the meshopt-compressed stream stays intact,
 * so the file stays small AND the runtime keeps working.
 *
 * Run: npx tsx scripts/compress-model.ts [src] [full-out] [mobile-out] [mobile-ratio] [mobile-error]
 * Verify: npx tsx scripts/verify-model.ts public/models/modelToUse.glb
 *         npx tsx scripts/verify-model.ts public/models/modelToUse-mobile.glb
 */
import * as fs from "node:fs";
import { NodeIO, Primitive, type Transform } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, dequantize, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const SRC = process.argv[2] ?? "public/models/modelToUse.glb";
const FULL_OUT = process.argv[3] ?? "public/models/modelToUse.glb";
const MOBILE_OUT = process.argv[4] ?? "public/models/modelToUse-mobile.glb";
// Target share of indices to keep in the mobile variant. 0.5 keeps
// ~1.5M indices / ~243K verts at ~3.6MB — nearly double the detail of the
// old 0.3 (142K verts / 2.2MB) for only +1.4MB, and still light enough for
// any phone GPU. Tune with argv[5] and compare via verify-model.
const MOBILE_RATIO = Number(process.argv[5] ?? 0.5);
// Cluster tolerance in world units (model spans ~2 units). Invisible at
// phone scale and gives the clustering room to work.
const MOBILE_ERROR = Number(process.argv[6] ?? 0.02);
// Position-weld cell size in world units. The mannequin lineup is ~1.7
// units tall, so 1e-5 ≈ 0.01mm — merges only the scan's duplicated
// vertices, never distinct nearby geometry.
const WELD_TOLERANCE = 1e-5;

const mb = (path: string) => `${(fs.statSync(path).size / 1024 / 1024).toFixed(1)}MB`;

/**
 * Merge vertices that share a position (within `tolerance`), then recompute
 * smooth normals on the merged topology. Stock weld() hashes the full
 * vertex, so scan vertices with identical positions but different
 * normals/uvs never merge — this one uses position only.
 */
function weldPositions(tolerance: number): Transform {
  return async (doc) => {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
        const indices = prim.getIndices();
        const position = prim.getAttribute("POSITION");
        if (!indices || !position) continue;
        const srcIdx = indices.getArray();
        const posArr = position.getArray();
        if (!srcIdx || !posArr) continue;
        const srcCount = position.getCount();
        const cell = Math.max(tolerance, 1e-7);

        // Grid-cell → representative source vertex. String keys are exact
        // (a numeric XOR hash could collide two distant cells).
        const cells = new Map<string, number>();
        const writeMap = new Uint32Array(srcCount).fill(0xffffffff);
        let dstCount = 0;
        for (let k = 0; k < srcIdx.length; k++) {
          const i = srcIdx[k];
          if (writeMap[i] !== 0xffffffff) continue;
          const key = [
            Math.round(posArr[i * 3] / cell),
            Math.round(posArr[i * 3 + 1] / cell),
            Math.round(posArr[i * 3 + 2] / cell),
          ].join(",");
          const rep = cells.get(key);
          if (rep === undefined) {
            cells.set(key, i);
            writeMap[i] = dstCount++;
          } else {
            writeMap[i] = writeMap[rep];
          }
        }

        compactPrimitive(prim, writeMap, dstCount);
        // (Winding is consistent — verified by scripts/check-winding.ts — so
        // the face-normal orientation below matches the original shading.)

        // Smooth normals: average face normals per vertex over the welded
        // (real) topology — the standard look for optimized meshes, and it
        // also hides any per-triangle scan noise in the original normals.
        const pos = prim.getAttribute("POSITION");
        const idx = prim.getIndices();
        if (!pos || !idx) continue;
        const p = pos.getArray() as Float32Array;
        const ixSrc = idx.getArray();
        if (!ixSrc) continue;
        // compactPrimitive downcasts to Uint16 when dstCount ≤ 65534 — read
        // the actual component type instead of assuming Uint32.
        const ix = ixSrc instanceof Uint32Array ? ixSrc : new Uint32Array(ixSrc);
        const verts = pos.getCount();
        const normals = new Float32Array(verts * 3);
        for (let k = 0; k < ix.length; k += 3) {
          const a = ix[k] * 3;
          const b = ix[k + 1] * 3;
          const c = ix[k + 2] * 3;
          const ux = p[b] - p[a];
          const uy = p[b + 1] - p[a + 1];
          const uz = p[b + 2] - p[a + 2];
          const vx = p[c] - p[a];
          const vy = p[c + 1] - p[a + 1];
          const vz = p[c + 2] - p[a + 2];
          const nx = uy * vz - uz * vy;
          const ny = uz * vx - ux * vz;
          const nz = ux * vy - uy * vx;
          normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
          normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
          normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
        }
        for (let i = 0; i < verts; i++) {
          const len = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
          normals[i * 3] /= len;
          normals[i * 3 + 1] /= len;
          normals[i * 3 + 2] /= len;
        }
        // float32 + unnormalized so the new array is read as-is (a source
        // with quantized normals would otherwise keep its normalized flag).
        prim.getAttribute("NORMAL")?.setArray(normals as Float32Array<ArrayBuffer>).setNormalized(false);
      }
    }
  };
}

/**
 * Topology-independent decimation (vertex clustering) via
 * MeshoptSimplifier.simplifySloppy, then drops the unused vertices so the
 * next compression pass only sees what's actually rendered.
 */
function simplifySloppy(options: {
  simplifier: typeof MeshoptSimplifier;
  ratio: number;
  error: number;
}): Transform {
  return async (doc) => {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        // Only triangle meshes are decimated; POINTS/LINES are untouched.
        if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
        const indices = prim.getIndices();
        const position = prim.getAttribute("POSITION");
        if (!indices || !position) continue;
        const srcIdx = indices.getArray();
        const posArr = position.getArray();
        if (!srcIdx || !posArr) continue;
        const idx32 = (
          srcIdx instanceof Uint32Array ? srcIdx : new Uint32Array(srcIdx as ArrayLike<number>)
        ) as Uint32Array<ArrayBuffer>;
        const target = Math.floor((options.ratio * idx32.length) / 3) * 3;
        if (target <= 0 || target >= idx32.length) continue;
        const [out] = options.simplifier.simplifySloppy(
          idx32,
          posArr as Float32Array<ArrayBuffer>,
          3,
          null,
          target,
          options.error
        ) as [Uint32Array<ArrayBuffer>, number];
        indices.setArray(out);
        compactPrimitive(prim);
      }
    }
  };
}

async function main() {
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);

  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({
      "meshopt.encoder": MeshoptEncoder,
      // Needed when the SOURCE is itself meshopt-compressed (e.g. re-decimating
      // modelToUse-mobile.glb into a lite variant) — the reader must decode
      // the compressed stream before it can simplify it.
      "meshopt.decoder": MeshoptDecoder,
    });

  // ---- FULL variant: position-weld (3M → ~500K verts) + meshopt ----
  const full = await io.read(SRC);
  await full.transform(
    weldPositions(WELD_TOLERANCE),
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
    dequantize()
  );
  await io.write(FULL_OUT, full);
  console.log(`full:   ${mb(SRC)} → ${mb(FULL_OUT)}  (${FULL_OUT})`);

  // ---- MOBILE variant: decimated, then compressed ----
  const mobile = await io.read(SRC);
  await mobile.transform(
    simplifySloppy({ simplifier: MeshoptSimplifier, ratio: MOBILE_RATIO, error: MOBILE_ERROR }),
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
    dequantize()
  );
  await io.write(MOBILE_OUT, mobile);
  console.log(`mobile: ${mb(SRC)} → ${mb(MOBILE_OUT)}  ratio=${MOBILE_RATIO} (${MOBILE_OUT})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
