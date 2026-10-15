import type {
  ArchOperation,
  BlocksOperation,
  LayersOperation,
  ReplaceOperation,
} from '@minecraft-schematic-lab/build-spec';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../context';
import { hash3 } from '../noise';
import type { BlockSource } from '../resolver';

export function blocks(ctx: CompileContext, op: BlocksOperation): void {
  const src = ctx.source(op.block);
  for (const [x, y, z] of op.at) {
    ctx.put(x, y, z, src);
    if (op.nbt) {
      const [wx, wy, wz] = ctx.toWorld(x, y, z);
      ctx.blockEntities.set(`${wx},${wy},${wz}`, { x: wx, y: wy, z: wz, data: op.nbt });
    }
  }
}

export function layers(ctx: CompileContext, op: LayersOperation): void {
  const plane = op.plane ?? 'xz';
  const [ox, oy, oz] = op.origin;
  const sources = new Map<string, BlockSource>();
  const missing = new Set<string>();
  for (const [ch, ref] of Object.entries(op.legend)) sources.set(ch, ctx.source(ref));
  op.layers.forEach((rows, i) => {
    rows.forEach((row, j) => {
      for (let k = 0; k < row.length; k++) {
        const ch = row[k] as string;
        const src = sources.get(ch);
        if (!src) {
          if (ch !== ' ' && ch !== '.') missing.add(ch);
          continue;
        }
        if (plane === 'xz') ctx.put(ox + k, oy + i, oz + j, src);
        else if (plane === 'xy') ctx.put(ox + k, oy + (rows.length - 1 - j), oz + i, src);
        else ctx.put(ox + i, oy + (rows.length - 1 - j), oz + k, src);
      }
    });
  });
  if (missing.size > 0) {
    ctx.error(
      `layers: character(s) ${[...missing].map((c) => `"${c}"`).join(', ')} not in legend (use " " or "." to skip).`,
    );
  }
}

export function replace(ctx: CompileContext, op: ReplaceOperation): void {
  const targets = Array.isArray(op.target) ? op.target : [op.target];
  const names = new Set<string>();
  const states = new Set<string>();
  for (const t of targets) {
    const r = ctx.resolver.namesOf(t, ctx.where);
    r.names.forEach((n) => names.add(n));
    r.states.forEach((s) => states.add(s));
  }
  const chance = op.chance ?? 1;
  const seed = (op.seed ?? ctx.seed) ^ 0x5eed;
  const cache = new Map<number, BlockSource>();
  const visit = (wx: number, wy: number, wz: number, id: number): void => {
    if (id === 0) return;
    const e = ctx.palette.get(id);
    if (!names.has(e.name) && !states.has(e.state)) return;
    if (chance < 1 && hash3(wx, wy, wz, seed) >= chance) return;
    // Keep shared properties (stairs stay stairs facing the same way, logs keep their axis).
    let src = cache.get(id);
    if (!src) {
      src = ctx.source(op.block, e.props);
      cache.set(id, src);
    }
    const nid =
      src.id >= 0
        ? src.id
        : src.id === -1
          ? (src.pick as (a: number, b: number, c: number) => number)(wx, wy, wz)
          : -1;
    if (nid >= 0) ctx.putWorld(wx, wy, wz, nid);
  };
  if (op.from && op.to) {
    const [x0, x1] = sortPair(op.from[0], op.to[0]);
    const [y0, y1] = sortPair(op.from[1], op.to[1]);
    const [z0, z1] = sortPair(op.from[2], op.to[2]);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const [wx, wy, wz] = ctx.toWorld(x, y, z);
          visit(wx, wy, wz, ctx.volume.get(wx, wy, wz));
        }
      }
    }
  } else {
    const hits: [number, number, number, number][] = [];
    ctx.volume.forEach((x, y, z, id) => hits.push([x, y, z, id]));
    for (const [x, y, z, id] of hits) visit(x, y, z, id);
  }
}

/**
 * Arch in a vertical plane. The longer horizontal side of from/to is the span, the other the
 * depth (wall thickness). from.y is the springing line.
 */
export function arch(ctx: CompileContext, op: ArchOperation): void {
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const alongX = x1 - x0 >= z1 - z0;
  const s0 = alongX ? x0 : z0;
  const s1 = alongX ? x1 : z1;
  const d0 = alongX ? z0 : x0;
  const d1 = alongX ? z1 : x1;
  const a = (s1 - s0 + 1) / 2;
  const c = (s0 + s1) / 2;
  const style = op.style ?? 'round';
  const w = op.width ?? 1;
  const rise =
    op.rise ??
    (style === 'pointed' ? a * 1.6 : style === 'segmental' ? a * 0.5 : style === 'flat' ? 1 : a);
  const src = ctx.source(op.block);
  const fill = op.fill ? ctx.source(op.fill) : null;

  const inside = (du: number, dv: number, A: number, B: number): boolean => {
    if (dv < 0) return Math.abs(du) < A;
    switch (style) {
      case 'flat':
        return Math.abs(du) < A && dv < B;
      case 'pointed': {
        const r = (B * B + A * A) / (2 * A);
        const k = A - r;
        return (du - k) ** 2 + dv * dv < r * r && (du + k) ** 2 + dv * dv < r * r;
      }
      case 'segmental': {
        const r = (A * A + B * B) / (2 * B);
        return du * du + (dv - (B - r)) ** 2 < r * r;
      }
      default:
        return (du / A) ** 2 + (dv / B) ** 2 < 1;
    }
  };

  for (let s = s0 - w; s <= s1 + w; s++) {
    const du = s - c;
    for (let y = y0; y <= y1; y++) {
      const dv = y - y0 + 0.5;
      const inOpening = inside(du, dv, a, rise);
      const inOuter = inside(du, dv, a + w, rise + w);
      let block: BlockSource | null = null;
      if (inOuter && !inOpening) block = src;
      else if (inOpening && op.cut) block = { id: 0 };
      else if (!inOuter && fill && Math.abs(du) <= a + w) block = fill;
      if (!block) continue;
      for (let d = d0; d <= d1; d++) {
        if (alongX) ctx.put(s, y, d, block);
        else ctx.put(d, y, s, block);
      }
    }
  }
}
