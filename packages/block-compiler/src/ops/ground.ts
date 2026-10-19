import { isReplaceablePlant } from '@minecraft-schematic-lab/catalog';
import type {
  FlattenOperation,
  FoundationOperation,
  PathOperation,
} from '@minecraft-schematic-lab/build-spec';
import type { CompileContext } from '../context';
import { hash3 } from '../noise';
import type { BlockSource } from '../resolver';

/** The plot's x/z rectangle in world coordinates (groups may have rotated it). */
function worldRect(
  ctx: CompileContext,
  from: [number, number, number],
  to: [number, number, number],
): { x0: number; x1: number; z0: number; z1: number } {
  const a = ctx.toWorld(from[0], 0, from[2]);
  const b = ctx.toWorld(to[0], 0, to[2]);
  return {
    x0: Math.min(a[0], b[0]),
    x1: Math.max(a[0], b[0]),
    z0: Math.min(a[2], b[2]),
    z1: Math.max(a[2], b[2]),
  };
}

/** Distance (in blocks) of a column outside the plot; 0 inside. */
function outside(
  r: { x0: number; x1: number; z0: number; z1: number },
  circle: boolean,
  x: number,
  z: number,
): number {
  if (!circle) {
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dz = Math.max(r.z0 - z, 0, z - r.z1);
    return Math.hypot(dx, dz);
  }
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const rx = (r.x1 - r.x0) / 2 + 0.5;
  const rz = (r.z1 - r.z0) / 2 + 0.5;
  const n = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return n <= 1 ? 0 : (n - 1) * Math.min(rx, rz);
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function mostCommon(counts: Map<number, number>): number | null {
  let best: number | null = null;
  let n = 0;
  for (const [id, c] of counts)
    if (c > n) {
      best = id;
      n = c;
    }
  return best;
}

/** Surface / subsurface / core: the spec's blocks, else what the area already has. */
function groundLayers(
  ctx: CompileContext,
  op: { surface?: string; subsurface?: string; core?: string; depth?: number },
  columns: [number, number, number | null][],
): { surface: BlockSource; sub: BlockSource; core: BlockSource; depth: number } {
  const depth = op.depth ?? 3;
  const tops = new Map<number, number>();
  const subs = new Map<number, number>();
  const cores = new Map<number, number>();
  const bump = (m: Map<number, number>, id: number) => {
    if (id !== 0 && ctx.classOf(id) === 'ground') m.set(id, (m.get(id) ?? 0) + 1);
  };
  const step = Math.max(1, Math.floor(columns.length / 400));
  for (let i = 0; i < columns.length; i += step) {
    const [x, z, g] = columns[i] as [number, number, number | null];
    if (g === null) continue;
    bump(tops, ctx.volume.get(x, g, z));
    for (let d = 1; d <= Math.max(1, depth); d++) bump(subs, ctx.volume.get(x, g - d, z));
    bump(cores, ctx.volume.get(x, g - depth - 3, z));
  }
  const pick = (ref: string | undefined, found: Map<number, number>, fallback: string) => {
    if (ref) return ctx.source(ref);
    const id = mostCommon(found);
    return id !== null ? { id } : ctx.source(fallback);
  };
  return {
    surface: pick(op.surface, tops, 'grass_block'),
    sub: pick(op.subsurface, subs, 'dirt'),
    core: pick(op.core, cores, 'stone'),
    depth,
  };
}

function topOfScan(ctx: CompileContext): number {
  if (ctx.siteBounds) return ctx.siteBounds.max[1];
  const v = ctx.volume;
  return v.maxChunkY === -Infinity ? 0 : v.maxChunkY * 16 + 15;
}

function bottomOfScan(ctx: CompileContext): number {
  if (ctx.siteBounds) return ctx.siteBounds.min[1];
  const v = ctx.volume;
  return v.minChunkY === Infinity ? -1 : v.minChunkY * 16;
}

/**
 * Level a plot: dig or fill every column to `level - 1`, ease the ground around it back to its
 * natural height over `blend` blocks, and clear what stood on the plot.
 */
export function flatten(ctx: CompileContext, op: FlattenOperation): void {
  ctx.groundProvs.add(ctx.prov);
  const r = worldRect(ctx, op.from, op.to);
  const circle = op.shape === 'circle';
  const blend = op.blend ?? 4;
  const columns: [number, number, number | null][] = [];
  const inside: number[] = [];
  for (let z = r.z0 - blend; z <= r.z1 + blend; z++)
    for (let x = r.x0 - blend; x <= r.x1 + blend; x++) {
      const d = outside(r, circle, x, z);
      if (d > blend + 0.5 || (blend === 0 && d > 0)) continue;
      const g = ctx.groundAt(x, z);
      columns.push([x, z, g]);
      if (d === 0 && g !== null) inside.push(g);
    }
  if (!columns.length) return;
  const ty = ctx.transform.ty;
  let level: number;
  if (op.level !== undefined) level = op.level + ty;
  else if (inside.length) {
    inside.sort((a, b) => a - b);
    level = (inside[Math.floor(inside.length / 2)] as number) + 1;
  } else level = ty;
  const layers = groundLayers(ctx, op, columns);
  const bottom = bottomOfScan(ctx);
  const top = topOfScan(ctx);
  const covered = (id: number) =>
    id !== 0 &&
    /^(grass_block|mycelium|podzol|dirt_path|grass_path)$/.test(ctx.palette.get(id).name);

  for (const [x, z, g0] of columns) {
    const d = outside(r, circle, x, z);
    const g = g0 ?? bottom - 1;
    const w = d === 0 ? 1 : smoothstep(1 - d / (blend + 1));
    const target = Math.round(g + (level - 1 - g) * w);
    const fillAt = (y: number) => {
      const src =
        y === target ? layers.surface : y > target - layers.depth ? layers.sub : layers.core;
      ctx.putWorldSource(x, y, z, src);
    };
    if (target > g) {
      // Bury the old top (grass under dirt turns to dirt) and fill up.
      if (g0 !== null && layers.depth > 0 && covered(ctx.volume.get(x, g, z)))
        ctx.putWorldSource(x, g, z, layers.sub);
      for (let y = Math.max(g + 1, bottom); y <= target; y++) fillAt(y);
    } else if (target < g) {
      for (let y = g + 2; y >= g + 1; y--) {
        const id = ctx.volume.get(x, y, z);
        if (id !== 0 && isReplaceablePlant(ctx.palette.get(id).name)) ctx.putWorld(x, y, z, 0);
      }
      for (let y = g; y > target; y--) ctx.putWorld(x, y, z, 0);
      ctx.putWorldSource(x, target, z, layers.surface);
    }
    if (d === 0 && op.clear !== false) {
      for (let y = top; y > target; y--)
        if (ctx.volume.get(x, y, z) !== 0) ctx.putWorld(x, y, z, 0);
    }
  }
}

/** Fill under a footprint down into the ground, so nothing floats on a slope. */
export function foundation(ctx: CompileContext, op: FoundationOperation): void {
  const r = worldRect(ctx, op.from, op.to);
  const circle = op.shape === 'circle';
  const topY = Math.max(op.from[1], op.to[1]) + ctx.transform.ty;
  const depth = op.depth ?? 1;
  const src = ctx.source(op.block);
  const spacing = op.spacing ?? 4;
  const isPillar = (x: number, z: number): boolean => {
    if (op.style !== 'pillars') return true;
    const ex = x === r.x0 || x === r.x1;
    const ez = z === r.z0 || z === r.z1;
    if (circle) {
      // On the rim, every `spacing` blocks around it.
      const rim =
        outside(r, true, x, z) === 0 &&
        outside({ x0: r.x0 + 1, x1: r.x1 - 1, z0: r.z0 + 1, z1: r.z1 - 1 }, true, x, z) > 0;
      return rim && (Math.abs(x - r.x0) + Math.abs(z - r.z0)) % spacing === 0;
    }
    if (ex && ez) return true;
    if (ez) return (x - r.x0) % spacing === 0;
    if (ex) return (z - r.z0) % spacing === 0;
    return false;
  };
  const columns: [number, number, number][] = [];
  let floating = 0;
  for (let z = r.z0; z <= r.z1; z++)
    for (let x = r.x0; x <= r.x1; x++) {
      if (circle && outside(r, true, x, z) > 0) continue;
      if (!isPillar(x, z)) continue;
      const g = ctx.groundAt(x, z);
      if (g === null) {
        floating++;
        continue;
      }
      columns.push([x, z, g]);
    }
  for (const [x, z, g] of columns) {
    for (let y = g - depth + 1; y <= topY; y++) ctx.putWorldSource(x, y, z, src);
  }
  if (floating)
    ctx.warn(
      `foundation: no ground under ${floating} column(s); they were left empty (ground comes from the site or from terrain/flatten).`,
    );
}

/** A path that follows the ground between points, replacing its top block. */
export function path(ctx: CompileContext, op: PathOperation): void {
  ctx.groundProvs.add(ctx.prov);
  const name = op.block ?? ['dirt_path', 'grass_path', 'gravel'].find((n) => ctx.catalog.has(n));
  const src = ctx.source(name ?? 'gravel');
  const edge = op.edge ? ctx.source(op.edge) : null;
  const half = (op.width ?? 3) / 2;
  const pts = op.points.map(([x, z]) => {
    const w = ctx.toWorld(x, 0, z);
    return [w[0], w[2]] as [number, number];
  });
  // Columns within half the width of a segment, with their distance to the centre line.
  const dist = new Map<number, { x: number; z: number; d: number }>();
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i] as [number, number];
    const [bx, bz] = pts[i + 1] as [number, number];
    const len = Math.hypot(bx - ax, bz - az);
    const minX = Math.floor(Math.min(ax, bx) - half);
    const maxX = Math.ceil(Math.max(ax, bx) + half);
    const minZ = Math.floor(Math.min(az, bz) - half);
    const maxZ = Math.ceil(Math.max(az, bz) + half);
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++) {
        const t =
          len === 0
            ? 0
            : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)));
        const d = Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az)));
        if (d > half) continue;
        const key = (x + 32768) * 65536 + (z + 32768);
        const prev = dist.get(key);
        if (!prev || d < prev.d) dist.set(key, { x, z, d });
      }
  }
  const cells: [number, number, number, number][] = [];
  for (const { x, z, d } of dist.values()) {
    if (ctx.waterAt(x, z) !== null) continue;
    const g = ctx.groundAt(x, z);
    if (g !== null) cells.push([x, z, g, d]);
  }
  const seed = ctx.seed ^ 0x9a7;
  for (const [x, z, g, d] of cells) {
    const atEdge = edge && d > half - 1 && hash3(x, g, z, seed) < 0.6;
    ctx.putWorldSource(x, g, z, atEdge ? edge : src);
    if (op.clear !== false) {
      for (let y = g + 1; y <= g + 2; y++) {
        const id = ctx.volume.get(x, y, z);
        if (id !== 0 && isReplaceablePlant(ctx.palette.get(id).name)) ctx.putWorld(x, y, z, 0);
      }
    }
  }
}
