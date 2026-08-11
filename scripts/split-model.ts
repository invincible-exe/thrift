/**
 * TEMPORARY asset pipeline — the user's modelToUse.glb has all 6 characters
 * merged into one mesh, so we split it into 6 named meshes (k-means on the
 * xz footprint) so the hero can animate each character independently.
 *
 *   npx tsx scripts/split-model.ts [src.glb] [out.glb]
 */
import * as fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// --- Minimal DOM stubs so GLTFLoader/Exporter can run in Node ---
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
  get complete() {
    return true;
  }
  get naturalWidth() {
    return 1;
  }
  get naturalHeight() {
    return 1;
  }
  addEventListener() {}
  removeEventListener() {}
  decode = async () => {};
};

// GLTFExporter reads blobs via FileReader — Node only has Blob.arrayBuffer().
g.FileReader = class {
  result: string | ArrayBuffer | null = null;
  onloadend: ((this: unknown, ev: unknown) => unknown) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((ab) => {
      this.result = ab;
      if (this.onloadend) (this.onloadend as (ev: unknown) => unknown).call(this, {});
    });
  }
};

const SRC = process.argv[2] ?? "public/models/modelToUse.glb";
const OUT = process.argv[3] ?? "public/models/lineup.glb";
const K = 6;

function firstMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !found) found = o as THREE.Mesh;
  });
  if (!found) throw new Error("no mesh found");
  return found;
}

/** Spread K seed indices across the footprint (farthest-point sampling). */
function farthestSeeds(pos: THREE.BufferAttribute, k: number): number[] {
  const n = pos.count;
  const seeds: number[] = [0];
  const dist = new Float32Array(n).fill(Infinity);
  for (let s = 1; s < k; s++) {
    let best = -1;
    let bestD = -Infinity;
    const sx = pos.getX(seeds[s - 1]);
    const sz = pos.getZ(seeds[s - 1]);
    for (let i = 0; i < n; i++) {
      const dx = pos.getX(i) - sx;
      const dz = pos.getZ(i) - sz;
      const d = dx * dx + dz * dz;
      if (d < dist[i]) dist[i] = d;
      if (dist[i] > bestD) {
        bestD = dist[i];
        best = i;
      }
    }
    seeds.push(best);
  }
  return seeds;
}

const buf = fs.readFileSync(SRC);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loader = new GLTFLoader();
loader.parse(
  ab,
  "",
  (gltf) => {
    const mesh = firstMesh(gltf.scene);
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    console.log("source verts:", n.toLocaleString());

    // 1) seed centers
    const seeds = farthestSeeds(pos, K);
    const cx = new Float32Array(K);
    const cz = new Float32Array(K);
    seeds.forEach((si, i) => {
      cx[i] = pos.getX(si);
      cz[i] = pos.getZ(si);
    });

    // 2) k-means on (x, z)
    const assign = new Uint32Array(n);
    const sumX = new Float64Array(K);
    const sumZ = new Float64Array(K);
    const cnt = new Uint32Array(K);
    for (let it = 0; it < 20; it++) {
      sumX.fill(0);
      sumZ.fill(0);
      cnt.fill(0);
      for (let i = 0; i < n; i++) {
        let best = 0;
        let bestD = Infinity;
        const x = pos.getX(i);
        const z = pos.getZ(i);
        for (let c = 0; c < K; c++) {
          const dx = x - cx[c];
          const dz = z - cz[c];
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        assign[i] = best;
        sumX[best] += x;
        sumZ[best] += z;
        cnt[best]++;
      }
      for (let c = 0; c < K; c++) {
        if (cnt[c] > 0) {
          cx[c] = sumX[c] / cnt[c];
          cz[c] = sumZ[c] / cnt[c];
        }
      }
    }

    // 3) sanity checks: every cluster populated and full-height (a short
    //    cluster means k-means sliced a character horizontally)
    const counts = Array.from(cnt);
    if (counts.some((c) => c === 0)) {
      console.error("split failed: empty cluster(s) — characters likely overlap too much");
      process.exit(1);
    }

    // Copy the source normals when present so the split keeps the exact
    // original shading (computeVertexNormals on non-indexed geometry would
    // produce flat per-face normals).
    const srcNormal = mesh.geometry.attributes.normal as
      | THREE.BufferAttribute
      | undefined;

    const outScene = new THREE.Group();
    outScene.name = "lineup";
    const ySpans: number[] = [];
    for (let c = 0; c < K; c++) {
      const arr = new Float32Array(cnt[c] * 3);
      const nrm = srcNormal ? new Float32Array(cnt[c] * 3) : null;
      let w = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        if (assign[i] === c) {
          const y = pos.getY(i);
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          arr[w] = pos.getX(i);
          arr[w + 1] = y;
          arr[w + 2] = pos.getZ(i);
          if (nrm && srcNormal) {
            nrm[w] = srcNormal.getX(i);
            nrm[w + 1] = srcNormal.getY(i);
            nrm[w + 2] = srcNormal.getZ(i);
          }
          w += 3;
        }
      }
      ySpans.push(maxY - minY);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      if (nrm) geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      else geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mesh.material);
      m.name = `char-${c}`;
      outScene.add(m);

      console.log(
        `char-${c}: verts=${cnt[c].toLocaleString()} ` +
          `y[${minY.toFixed(2)}, ${maxY.toFixed(2)}] ` +
          `center[${cx[c].toFixed(2)}, ${cz[c].toFixed(2)}]`
      );
    }
    if (ySpans.some((s) => s < 0.7)) {
      console.error(
        `split failed: a cluster spans < 0.7 units vertically (${ySpans
          .map((s) => s.toFixed(2))
          .join(", ")}) — k-means sliced a character`
      );
      process.exit(1);
    }

    // 4) export binary GLB
    const exporter = new GLTFExporter();
    exporter.parse(
      outScene,
      (result) => {
        const bytes = result as ArrayBuffer;
        fs.writeFileSync(OUT, Buffer.from(bytes));
        console.log("wrote", OUT, (bytes.byteLength / 1024 / 1024).toFixed(1), "MB");
      },
      (e) => {
        console.error("export failed:", e);
        process.exit(1);
      },
      { binary: true }
    );
  },
  (err) => {
    console.error("load failed:", err);
    process.exit(1);
  }
);
