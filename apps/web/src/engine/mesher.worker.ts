/// <reference lib="webworker" />
import {
  FACE_NORMALS,
  FACE_SHADE,
  QUAD_STRIDE,
  type BakedBlock,
} from '@minecraft-schematic-lab/shared';
import {
  CHUNK,
  type ChunkMesh,
  type MeshBuffers,
  type WorkerIn,
  type WorkerOut,
} from './meshTypes';

/**
 * Chunk mesher. Emits Minecraft-style geometry: the game's own baked quads, faces hidden by
 * opaque neighbours culled, directional face shading and smooth-lighting ambient occlusion.
 */

interface Variants {
  cumulative: number[];
  quads: Float32Array[];
}

let generation = 0;
let SX = 0;
let SY = 0;
let SZ = 0;
let data: Uint16Array<ArrayBufferLike> = new Uint16Array(0);
let variants: (Variants | null)[] = [];
let full: Uint8Array<ArrayBuffer> = new Uint8Array(0);
let selfCull: Uint8Array<ArrayBuffer> = new Uint8Array(0);
let fluid: Uint8Array<ArrayBuffer> = new Uint8Array(0); // 0 none, 1 water, 2 lava
let fluidTex: [number, number][] = [];
let fluidTint: number[] = [];
let nameIds: Int32Array<ArrayBufferLike> = new Int32Array(0);

class Builder {
  pos: number[] = [];
  uvw: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    w: number,
    r: number,
    g: number,
    b: number,
  ): void {
    this.pos.push(x, y, z);
    this.uvw.push(u, v, w);
    this.col.push(r, g, b);
  }

  quad(flip: boolean): void {
    const base = this.pos.length / 3 - 4;
    if (flip) this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): MeshBuffers | null {
    if (this.idx.length === 0) return null;
    return {
      positions: new Float32Array(this.pos),
      uvw: new Float32Array(this.uvw),
      colors: new Uint8Array(this.col),
      indices: new Uint32Array(this.idx),
    };
  }
}

function idAt(x: number, y: number, z: number, clipY: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ || y > clipY) return 0;
  return data[x + SX * (z + SZ * y)] as number;
}

function occludes(x: number, y: number, z: number, clipY: number): number {
  const id = idAt(x, y, z, clipY);
  return id !== 0 && full[id] ? 1 : 0;
}

function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 3129871) ^ Math.imul(z, 116129781) ^ y;
  h = Math.imul(h, h * 42317861 + 11);
  return ((h >>> 16) & 0xffff) / 65536;
}

const AO_LEVELS = [0.5, 0.68, 0.84, 1];
const EPS = 1e-4;

function emitQuad(
  b: Builder,
  q: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  clipY: number,
): void {
  const dir = q[o + 22] as number;
  const tint = q[o + 23] as number;
  const useAo = (q[o + 25] as number) === 1 && dir >= 0;
  const shade = dir >= 0 ? (FACE_SHADE[dir] as number) : 1;
  let tr = 255;
  let tg = 255;
  let tb = 255;
  if (tint >= 0) {
    tr = (tint >> 16) & 255;
    tg = (tint >> 8) & 255;
    tb = tint & 255;
  }
  const ao = [1, 1, 1, 1];
  if (useAo) {
    const n = FACE_NORMALS[dir] as [number, number, number];
    const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const plane = q[o + axis] as number;
    let flat = true;
    for (let k = 1; k < 4; k++)
      if (Math.abs((q[o + k * 3 + axis] as number) - plane) > EPS) flat = false;
    if (flat) {
      const sign = n[axis] as number;
      const onBoundary = sign > 0 ? plane > 1 - EPS : plane < EPS;
      const ox = x + (onBoundary ? n[0] : 0);
      const oy = y + (onBoundary ? n[1] : 0);
      const oz = z + (onBoundary ? n[2] : 0);
      const a = axis === 0 ? 1 : 0;
      const c = axis === 2 ? 1 : 2;
      for (let k = 0; k < 4; k++) {
        const va = q[o + k * 3 + a] as number;
        const vc = q[o + k * 3 + c] as number;
        const sa = va < EPS ? -1 : va > 1 - EPS ? 1 : 0;
        const sc = vc < EPS ? -1 : vc > 1 - EPS ? 1 : 0;
        const pa = [ox, oy, oz];
        const pc = [ox, oy, oz];
        const pd = [ox, oy, oz];
        (pa[a] as number) += sa;
        (pc[c] as number) += sc;
        (pd[a] as number) += sa;
        (pd[c] as number) += sc;
        const s1 =
          sa !== 0 ? occludes(pa[0] as number, pa[1] as number, pa[2] as number, clipY) : 0;
        const s2 =
          sc !== 0 ? occludes(pc[0] as number, pc[1] as number, pc[2] as number, clipY) : 0;
        const corner =
          sa !== 0 && sc !== 0
            ? occludes(pd[0] as number, pd[1] as number, pd[2] as number, clipY)
            : 0;
        const level = s1 && s2 ? 0 : 3 - (s1 + s2 + corner);
        ao[k] = AO_LEVELS[level] as number;
      }
    }
  }
  const w = q[o + 20] as number;
  for (let k = 0; k < 4; k++) {
    const l = shade * (ao[k] as number);
    b.vertex(
      x + (q[o + k * 3] as number),
      y + (q[o + k * 3 + 1] as number),
      z + (q[o + k * 3 + 2] as number),
      q[o + 12 + k * 2] as number,
      q[o + 13 + k * 2] as number,
      w,
      Math.round(tr * l),
      Math.round(tg * l),
      Math.round(tb * l),
    );
  }
  // Flip the diagonal so ambient occlusion interpolates without the classic seam.
  b.quad((ao[0] as number) + (ao[2] as number) < (ao[1] as number) + (ao[3] as number));
}

/** Water and lava: surface 14/16 high unless the same fluid is above. */
function emitFluid(b: Builder, id: number, x: number, y: number, z: number, clipY: number): void {
  const kind = fluid[id];
  const above = idAt(x, y + 1, z, clipY);
  const sameAbove = above !== 0 && fluid[above] === kind;
  const h = sameAbove ? 1 : 0.875;
  const [still, flow] = fluidTex[id] ?? [0, 0];
  const tint = fluidTint[id] ?? -1;
  const tr = tint >= 0 ? (tint >> 16) & 255 : 255;
  const tg = tint >= 0 ? (tint >> 8) & 255 : 255;
  const tb = tint >= 0 ? tint & 255 : 255;
  const hidden = (nx: number, ny: number, nz: number): boolean => {
    const nid = idAt(nx, ny, nz, clipY);
    return nid !== 0 && (fluid[nid] === kind || full[nid] === 1);
  };
  const face = (pts: number[], tex: number, s: number, vTop = 0) => {
    for (let k = 0; k < 4; k++) {
      const u = k === 0 || k === 1 ? 0 : 1;
      const v = k === 0 || k === 3 ? vTop : 1;
      b.vertex(
        x + (pts[k * 3] as number),
        y + (pts[k * 3 + 1] as number),
        z + (pts[k * 3 + 2] as number),
        u,
        v,
        tex,
        tr * s,
        tg * s,
        tb * s,
      );
    }
    b.quad(false);
  };
  if (!sameAbove && !(above !== 0 && full[above]))
    face([0, h, 0, 0, h, 1, 1, h, 1, 1, h, 0], still, 1);
  if (!hidden(x, y - 1, z)) face([0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1], still, 0.5);
  if (!hidden(x, y, z - 1)) face([1, h, 0, 1, 0, 0, 0, 0, 0, 0, h, 0], flow, 0.8, 1 - h);
  if (!hidden(x, y, z + 1)) face([0, h, 1, 0, 0, 1, 1, 0, 1, 1, h, 1], flow, 0.8, 1 - h);
  if (!hidden(x - 1, y, z)) face([0, h, 0, 0, 0, 0, 0, 0, 1, 0, h, 1], flow, 0.6, 1 - h);
  if (!hidden(x + 1, y, z)) face([1, h, 1, 1, 0, 1, 1, 0, 0, 1, h, 0], flow, 0.6, 1 - h);
}

function meshChunk(cx: number, cy: number, cz: number, clipY: number): ChunkMesh {
  const layers = [new Builder(), new Builder(), new Builder()];
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const z0 = cz * CHUNK;
  const x1 = Math.min(SX, x0 + CHUNK);
  const y1 = Math.min(SY, y0 + CHUNK, clipY + 1);
  const z1 = Math.min(SZ, z0 + CHUNK);
  for (let y = y0; y < y1; y++) {
    for (let z = z0; z < z1; z++) {
      let i = x0 + SX * (z + SZ * y);
      for (let x = x0; x < x1; x++, i++) {
        const id = data[i] as number;
        if (id === 0) continue;
        if (fluid[id]) {
          emitFluid(layers[fluid[id] === 1 ? 2 : 0] as Builder, id, x, y, z, clipY);
          continue;
        }
        const v = variants[id];
        if (!v) continue;
        let pick = 0;
        if (v.quads.length > 1) {
          const r = hash(x, y, z);
          while (pick < v.cumulative.length - 1 && r >= (v.cumulative[pick] as number)) pick++;
        }
        const q = v.quads[pick] as Float32Array;
        for (let o = 0; o < q.length; o += QUAD_STRIDE) {
          const cull = q[o + 21] as number;
          if (cull >= 0) {
            const n = FACE_NORMALS[cull] as [number, number, number];
            const nid = idAt(x + n[0], y + n[1], z + n[2], clipY);
            if (nid !== 0 && (full[nid] || (selfCull[id] && nameIds[nid] === nameIds[id])))
              continue;
          }
          emitQuad(layers[q[o + 24] as number] as Builder, q, o, x, y, z, clipY);
        }
      }
    }
  }
  return { key: `${cx},${cy},${cz}`, cx, cy, cz, layers: layers.map((l) => l.build()) };
}

function grow(a: Uint8Array<ArrayBuffer>, n: number): Uint8Array<ArrayBuffer> {
  if (a.length >= n) return a;
  const b = new Uint8Array(Math.max(n, a.length * 2));
  b.set(a);
  return b;
}

/** Register the models of palette entries [from, from + models.length). */
function addModels(from: number, models: (BakedBlock | null)[]): void {
  const n = from + models.length;
  full = grow(full, n);
  selfCull = grow(selfCull, n);
  fluid = grow(fluid, n);
  models.forEach((m, k) => {
    const i = from + k;
    full[i] = 0;
    selfCull[i] = 0;
    fluid[i] = 0;
    variants[i] = null;
    if (!m) return;
    full[i] = m.full ? 1 : 0;
    selfCull[i] = m.self ? 1 : 0;
    if (m.fluid) {
      fluid[i] = m.fluid === 'water' ? 1 : 2;
      fluidTex[i] = m.fluidTex ?? [0, 0];
      fluidTint[i] = m.fluidTint ?? -1;
      return;
    }
    const total = m.v.reduce((s, v) => s + v.w, 0) || 1;
    let acc = 0;
    variants[i] = {
      cumulative: m.v.map((v) => (acc += v.w / total)),
      quads: m.v.map((v) => new Float32Array(v.q)),
    };
  });
}

function init(models: (BakedBlock | null)[]): void {
  full = new Uint8Array(0);
  selfCull = new Uint8Array(0);
  fluid = new Uint8Array(0);
  fluidTex = [];
  fluidTint = [];
  variants = [];
  addModels(0, models);
}

const ctx = globalThis as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    generation = msg.generation;
    [SX, SY, SZ] = msg.size;
    data = msg.data;
    nameIds = msg.nameIds;
    init(msg.models);
    return;
  }
  if (msg.generation !== generation) return;
  if (msg.type === 'patch') {
    if (msg.models.length) addModels(msg.from, msg.models);
    nameIds = msg.nameIds;
    for (let k = 0; k < msg.cells.length; k += 2)
      data[msg.cells[k] as number] = msg.cells[k + 1] as number;
    return;
  }
  const clip = msg.clipY ?? Number.MAX_SAFE_INTEGER;
  for (const [cx, cy, cz] of msg.chunks) {
    const mesh = meshChunk(cx, cy, cz, clip);
    const transfer: Transferable[] = [];
    for (const l of mesh.layers)
      if (l) transfer.push(l.positions.buffer, l.uvw.buffer, l.colors.buffer, l.indices.buffer);
    const out: WorkerOut = {
      type: 'chunk',
      generation,
      clipY: msg.clipY,
      mesh,
      ...(msg.live ? { live: true } : {}),
    };
    ctx.postMessage(out, transfer);
  }
  if (msg.live) return;
  const done: WorkerOut = { type: 'done', generation };
  ctx.postMessage(done);
};
