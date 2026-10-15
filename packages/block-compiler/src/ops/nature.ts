import type {
  ScatterOperation,
  TerrainOperation,
  TreeKind,
  TreeOperation,
} from '@minecraft-schematic-lab/build-spec';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../context';
import { hash3, makeRng, Perlin } from '../noise';
import type { BlockSource } from '../resolver';

// ---------------------------------------------------------------------------------------------
// Terrain

export function terrain(ctx: CompileContext, op: TerrainOperation): void {
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const y0 = op.from[1];
  const shape = op.shape ?? 'hills';
  const H = op.height ?? (shape === 'island' ? 3 : 4);
  const A = op.amplitude ?? (shape === 'flat' ? 0 : shape === 'mountain' ? 18 : 4);
  const S = op.scale ?? Math.max(12, Math.min(48, (x1 - x0 + z1 - z0) / 4));
  const seed = op.seed ?? ctx.seed;
  const perlin = new Perlin(seed);
  const surface = ctx.source(op.surface ?? 'grass_block');
  const sub = ctx.source(op.subsurface ?? 'dirt');
  const core = ctx.source(op.core ?? 'stone');
  const depth = op.depth ?? 3;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const rx = Math.max(1, (x1 - x0) / 2);
  const rz = Math.max(1, (z1 - z0) / 2);
  const W = x1 - x0 + 1;
  const L = z1 - z0 + 1;
  const heights = new Float32Array(W * L).fill(-Infinity);
  const bottoms = new Float32Array(W * L);

  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx;
      const nz = (z - cz) / rz;
      const r = Math.sqrt(nx * nx + nz * nz);
      const n = perlin.fbm(x / S, 0.5, z / S, 4);
      let h: number;
      let bottom = y0;
      if (shape === 'island') {
        const edge = 1 - 0.18 * perlin.fbm(x / (S * 0.6), 7.3, z / (S * 0.6), 2);
        if (r > edge) continue;
        const k = 1 - r / edge;
        h = H + A * n * k + 1.5 * k;
        const depthBelow =
          Math.pow(k, 0.65) *
          Math.min(rx, rz) *
          0.9 *
          (0.75 + 0.35 * perlin.fbm(x / 6, 3.1, z / 6, 2));
        bottom = y0 - depthBelow;
      } else if (shape === 'mountain') {
        const ridge = 1 - Math.abs(perlin.fbm(x / (S * 0.7), 1.7, z / (S * 0.7), 4));
        h = H + A * Math.max(0, 1 - r) ** 1.4 * (0.55 + 0.6 * ridge) + 2 * n;
      } else if (shape === 'plateau') {
        const raw = H + A * (0.5 + n);
        h = Math.round(raw / 3) * 3 + (raw % 3 > 2.5 ? 1 : 0);
      } else if (shape === 'flat') {
        h = H;
      } else {
        h = H + A * n;
      }
      if (op.edgeFalloff && shape !== 'island') {
        const ex = Math.min(x - x0, x1 - x) / Math.max(1, W * 0.2);
        const ez = Math.min(z - z0, z1 - z) / Math.max(1, L * 0.2);
        const f = Math.min(1, ex, ez);
        h *= f * f * (3 - 2 * f);
      }
      heights[(z - z0) * W + (x - x0)] = h;
      bottoms[(z - z0) * W + (x - x0)] = bottom;
    }
  }

  const water = op.waterLevel !== undefined ? ctx.source(op.water ?? 'water') : null;
  const at = (x: number, z: number): number => {
    if (x < x0 || x > x1 || z < z0 || z > z1) return -Infinity;
    return heights[(z - z0) * W + (x - x0)] as number;
  };
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const h = at(x, z);
      if (h === -Infinity) continue;
      const top = y0 + Math.round(h);
      const bottom = Math.round(bottoms[(z - z0) * W + (x - x0)] as number);
      // Steep spots show rock instead of grass, like real hillsides.
      let steep = 0;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nh = at(x + dx, z + dz);
        if (nh !== -Infinity) steep = Math.max(steep, Math.abs(nh - h));
      }
      const exposed = steep > 2.2;
      for (let y = bottom; y <= top; y++) {
        const src =
          y === top ? (exposed ? core : surface) : y > top - depth ? (exposed ? core : sub) : core;
        ctx.put(x, y, z, src);
      }
      if (water && op.waterLevel !== undefined) {
        for (let y = top + 1; y <= op.waterLevel; y++) ctx.put(x, y, z, water);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Trees

const TREE_DEFAULTS: Record<TreeKind, { log: string; leaves: string }> = {
  oak: { log: 'oak_log', leaves: 'oak_leaves' },
  big_oak: { log: 'oak_log', leaves: 'oak_leaves' },
  birch: { log: 'birch_log', leaves: 'birch_leaves' },
  spruce: { log: 'spruce_log', leaves: 'spruce_leaves' },
  pine: { log: 'spruce_log', leaves: 'spruce_leaves' },
  dark_oak: { log: 'dark_oak_log', leaves: 'dark_oak_leaves' },
  jungle: { log: 'jungle_log', leaves: 'jungle_leaves' },
  acacia: { log: 'acacia_log', leaves: 'acacia_leaves' },
  cherry: { log: 'cherry_log', leaves: 'cherry_leaves' },
  willow: { log: 'oak_log', leaves: 'oak_leaves' },
  palm: { log: 'jungle_log', leaves: 'jungle_leaves' },
  dead: { log: 'oak_log', leaves: '' },
  bush: { log: 'oak_log', leaves: 'oak_leaves' },
  fantasy: { log: 'dark_oak_log', leaves: 'oak_leaves' },
};

type V3 = [number, number, number];

class TreeBuilder {
  private readonly logs: Record<'x' | 'y' | 'z', BlockSource>;
  private readonly leaves: BlockSource | null;
  readonly rnd: () => number;

  constructor(
    private readonly ctx: CompileContext,
    private readonly base: V3,
    logRef: string,
    leavesRef: string,
    seed: number,
  ) {
    this.logs = {
      x: ctx.source(logRef, { axis: 'x' }),
      y: ctx.source(logRef, { axis: 'y' }),
      z: ctx.source(logRef, { axis: 'z' }),
    };
    this.leaves = leavesRef ? ctx.source(leavesRef, { persistent: 'true' }) : null;
    this.rnd = makeRng(seed);
  }

  range(a: number, b: number): number {
    return a + this.rnd() * (b - a);
  }

  log(x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y'): void {
    const [bx, by, bz] = this.base;
    this.ctx.put(bx + x, by + y, bz + z, this.logs[axis]);
  }

  leaf(x: number, y: number, z: number): void {
    if (!this.leaves) return;
    const [bx, by, bz] = this.base;
    if (this.ctx.get(bx + x, by + y, bz + z) !== 0) return; // never overwrite trunk/branches
    this.ctx.put(bx + x, by + y, bz + z, this.leaves);
  }

  /** Straight trunk, optionally 2×2 / 3×3. */
  trunk(height: number, width = 1, fromY = 0): void {
    for (let y = fromY; y < height; y++) {
      for (let dz = 0; dz < width; dz++)
        for (let dx = 0; dx < width; dx++)
          this.log(dx - (width > 2 ? 1 : 0), y, dz - (width > 2 ? 1 : 0));
    }
  }

  /** Log line from a to b with the axis following the dominant direction of each step. */
  branch(a: V3, b: V3): void {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
    let prev: V3 = [Math.round(a[0]), Math.round(a[1]), Math.round(a[2])];
    for (let i = 0; i <= n; i++) {
      const p: V3 = [
        Math.round(a[0] + ((b[0] - a[0]) * i) / n),
        Math.round(a[1] + ((b[1] - a[1]) * i) / n),
        Math.round(a[2] + ((b[2] - a[2]) * i) / n),
      ];
      const dx = Math.abs(p[0] - prev[0]);
      const dy = Math.abs(p[1] - prev[1]);
      const dz = Math.abs(p[2] - prev[2]);
      const axis = dy >= dx && dy >= dz ? 'y' : dx >= dz ? 'x' : 'z';
      this.log(p[0], p[1], p[2], i === 0 ? 'y' : axis);
      prev = p;
    }
  }

  /** Leaf blob (ellipsoid) with a ragged, hand-placed looking edge. */
  blob(c: V3, rx: number, ry: number, rz: number, ragged = 0.35): void {
    const [bx, by, bz] = this.base;
    for (let y = Math.floor(-ry - 1); y <= Math.ceil(ry + 1); y++) {
      for (let z = Math.floor(-rz - 1); z <= Math.ceil(rz + 1); z++) {
        for (let x = Math.floor(-rx - 1); x <= Math.ceil(rx + 1); x++) {
          const d = (x / (rx + 0.5)) ** 2 + (y / (ry + 0.5)) ** 2 + (z / (rz + 0.5)) ** 2;
          if (d >= 1) continue;
          if (d > 1 - ragged) {
            const h = hash3(bx + c[0] + x, by + c[1] + y, bz + c[2] + z, 77);
            if (h < (d - (1 - ragged)) / ragged) continue;
          }
          this.leaf(Math.round(c[0]) + x, Math.round(c[1]) + y, Math.round(c[2]) + z);
        }
      }
    }
  }

  /** Strand of leaves hanging down (willows). */
  hang(x: number, y: number, z: number, length: number): void {
    for (let i = 0; i < length; i++) this.leaf(x, y - i, z);
  }
}

export function tree(ctx: CompileContext, op: TreeOperation): void {
  const def = TREE_DEFAULTS[op.kind];
  const [ax, ay, az] = ctx.toWorld(op.at[0], op.at[1], op.at[2]);
  const seed = (op.seed ?? ctx.seed) ^ Math.imul(ax, 73856093) ^ Math.imul(az, 19349663) ^ ay;
  let leaves = op.leaves ?? def.leaves;
  if (op.kind === 'fantasy' && !op.leaves && ctx.catalog.has('flowering_azalea_leaves')) {
    ctx.paletteDefs['~fantasy_leaves'] ??= {
      mix: { azalea_leaves: 3, flowering_azalea_leaves: 1, oak_leaves: 2 },
      scale: 3,
    };
    leaves = '~fantasy_leaves';
  }
  const t = new TreeBuilder(ctx, op.at, op.log ?? def.log, leaves, seed);
  const r = (a: number, b: number): number => t.range(a, b);
  const ri = (a: number, b: number): number => Math.floor(t.range(a, b + 1));
  const H = op.height;
  const R = op.radius;

  switch (op.kind) {
    case 'oak': {
      const h = H ?? ri(5, 7);
      t.trunk(h);
      const rad = R ?? r(2.2, 3);
      t.blob([0, h - 1, 0], rad, rad * 0.7, rad);
      for (let i = 0; i < 3; i++) {
        const a = r(0, Math.PI * 2);
        t.blob(
          [Math.cos(a) * rad * 0.7, h - 2 + r(-0.5, 1), Math.sin(a) * rad * 0.7],
          rad * 0.6,
          rad * 0.5,
          rad * 0.6,
        );
      }
      break;
    }
    case 'big_oak':
    case 'fantasy': {
      const fantasy = op.kind === 'fantasy';
      const h = H ?? (fantasy ? ri(14, 22) : ri(10, 15));
      const width = h >= 16 ? 2 : 1;
      t.trunk(Math.round(h * 0.75), width);
      // Root flare: short logs running out from the base on each side.
      const lo = width > 2 ? -1 : 0;
      const hi = lo + width - 1;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const len = ri(1, fantasy ? 3 : 2);
        const sx = dx > 0 ? hi + 1 : dx < 0 ? lo - 1 : lo + ri(0, width - 1);
        const sz = dz > 0 ? hi + 1 : dz < 0 ? lo - 1 : lo + ri(0, width - 1);
        for (let i = 0; i < len; i++) t.log(sx + dx * i, 0, sz + dz * i, dx !== 0 ? 'x' : 'z');
      }
      const branches = fantasy ? ri(6, 9) : ri(4, 6);
      const rad = R ?? (fantasy ? r(3.5, 4.5) : r(2.5, 3.2));
      for (let i = 0; i < branches; i++) {
        const a = (i / branches) * Math.PI * 2 + r(-0.4, 0.4);
        const startY = Math.round(h * r(0.4, 0.7));
        const len = r(h * 0.25, h * 0.45);
        const end: V3 = [Math.cos(a) * len, startY + len * r(0.4, 0.8), Math.sin(a) * len];
        t.branch([0, startY, 0], end);
        t.blob(end, rad * r(0.8, 1.1), rad * 0.6, rad * r(0.8, 1.1));
      }
      t.branch([0, Math.round(h * 0.7), 0], [r(-1, 1), h, r(-1, 1)]);
      t.blob([0, h, 0], rad * 1.1, rad * 0.75, rad * 1.1);
      break;
    }
    case 'birch': {
      const h = H ?? ri(6, 9);
      t.trunk(h);
      const rad = R ?? 2;
      t.blob([0, h - 2, 0], rad, 2.2, rad, 0.25);
      t.leaf(0, h, 0);
      break;
    }
    case 'spruce':
    case 'pine': {
      const pine = op.kind === 'pine';
      const h = H ?? (pine ? ri(14, 20) : ri(10, 16));
      t.trunk(h - 1);
      const start = pine ? Math.round(h * 0.55) : 2;
      const maxR = R ?? (pine ? 2.6 : r(3, 4));
      for (let y = start; y <= h; y++) {
        const k = (h - y) / Math.max(1, h - start);
        const wobble = (y - start) % 2 === 0 ? 1 : 0.6;
        const rad = Math.max(0, maxR * k * wobble);
        if (rad < 0.6) {
          t.leaf(0, y, 0);
          continue;
        }
        t.blob([0, y, 0], rad, 0.01, rad, 0.3);
      }
      t.leaf(0, h + 1, 0);
      break;
    }
    case 'dark_oak': {
      const h = H ?? ri(6, 9);
      t.trunk(h, 2);
      const rad = R ?? r(4, 5);
      t.blob([0.5, h, 0.5], rad, 2, rad);
      for (let i = 0; i < 3; i++) {
        const a = r(0, Math.PI * 2);
        const end: V3 = [Math.cos(a) * 3, h - r(1, 3), Math.sin(a) * 3];
        t.branch([0, h - 3, 0], end);
        t.blob(end, 2.2, 1.4, 2.2);
      }
      break;
    }
    case 'jungle': {
      const h = H ?? ri(16, 24);
      t.trunk(h, 2);
      const rad = R ?? 4;
      t.blob([0.5, h, 0.5], rad, 2, rad);
      for (let y = Math.round(h * 0.5); y < h - 3; y += ri(3, 5)) {
        const a = r(0, Math.PI * 2);
        const end: V3 = [Math.cos(a) * 3, y + 1, Math.sin(a) * 3];
        t.branch([0, y, 0], end);
        t.blob(end, 2, 1, 2);
      }
      break;
    }
    case 'acacia': {
      const h = H ?? ri(6, 8);
      const lean = r(0, Math.PI * 2);
      const mid: V3 = [
        Math.round(Math.cos(lean) * 2),
        Math.round(h * 0.55),
        Math.round(Math.sin(lean) * 2),
      ];
      t.branch([0, 0, 0], mid);
      for (const s of [1, -1]) {
        const a = lean + s * r(0.6, 1.3);
        const end: V3 = [mid[0] + Math.cos(a) * 3, h, mid[2] + Math.sin(a) * 3];
        t.branch(mid, end);
        t.blob([end[0], end[1] + 1, end[2]], R ?? 3.2, 0.6, R ?? 3.2, 0.25);
      }
      break;
    }
    case 'cherry': {
      const h = H ?? ri(6, 9);
      t.trunk(Math.round(h * 0.5));
      const rad = R ?? r(3.5, 4.5);
      for (const s of [0, 1, 2]) {
        const a = (s / 3) * Math.PI * 2 + r(-0.5, 0.5);
        const end: V3 = [Math.cos(a) * 3, h - r(0, 2), Math.sin(a) * 3];
        t.branch([0, Math.round(h * 0.45), 0], end);
        t.blob([end[0], end[1] + 1, end[2]], rad, rad * 0.55, rad);
        for (let k = 0; k < 6; k++) {
          t.hang(
            Math.round(end[0] + r(-rad, rad) * 0.8),
            Math.round(end[1]) - 1,
            Math.round(end[2] + r(-rad, rad) * 0.8),
            ri(1, 2),
          );
        }
      }
      break;
    }
    case 'willow': {
      const h = H ?? ri(7, 10);
      t.trunk(h, h > 9 ? 2 : 1);
      const rad = R ?? r(4, 5.5);
      t.blob([0, h, 0], rad, rad * 0.5, rad);
      for (let i = 0; i < 4; i++) {
        const a = r(0, Math.PI * 2);
        const end: V3 = [Math.cos(a) * rad * 0.6, h - 1, Math.sin(a) * rad * 0.6];
        t.branch([0, h - 3, 0], end);
      }
      for (let z = -Math.ceil(rad); z <= Math.ceil(rad); z++) {
        for (let x = -Math.ceil(rad); x <= Math.ceil(rad); x++) {
          const d = Math.sqrt(x * x + z * z) / rad;
          if (d < 0.55 || d > 1.02 || t.rnd() > 0.55) continue;
          t.hang(
            x,
            Math.round(h - rad * 0.3 * Math.sqrt(Math.max(0, 1 - d * d))),
            z,
            ri(3, Math.max(4, Math.round(h * 0.6))),
          );
        }
      }
      break;
    }
    case 'palm': {
      const h = H ?? ri(7, 11);
      const a = r(0, Math.PI * 2);
      const bend = r(2, 4);
      let top: V3 = [0, 0, 0];
      for (let y = 0; y < h; y++) {
        const k = (y / h) ** 2 * bend;
        const p: V3 = [Math.round(Math.cos(a) * k), y, Math.round(Math.sin(a) * k)];
        t.log(p[0], p[1], p[2]);
        top = p;
      }
      for (let i = 0; i < 8; i++) {
        const fa = (i / 8) * Math.PI * 2;
        const len = R ?? r(3.5, 5);
        for (let s = 1; s <= len; s++) {
          const droop = s > len * 0.5 ? Math.round((s - len * 0.5) * 0.8) : 0;
          t.leaf(
            Math.round(top[0] + Math.cos(fa) * s),
            top[1] + 1 - droop,
            Math.round(top[2] + Math.sin(fa) * s),
          );
        }
      }
      t.leaf(top[0], top[1] + 1, top[2]);
      break;
    }
    case 'dead': {
      const h = H ?? ri(5, 9);
      t.trunk(h);
      for (let i = 0; i < ri(2, 4); i++) {
        const a = r(0, Math.PI * 2);
        const y = ri(Math.round(h * 0.4), h - 1);
        t.branch([0, y, 0], [Math.cos(a) * r(2, 3.5), y + r(1, 3), Math.sin(a) * r(2, 3.5)]);
      }
      break;
    }
    case 'bush': {
      const rad = R ?? r(1.2, 2);
      t.log(0, 0, 0);
      t.blob([0, 0.3, 0], rad, rad * 0.75, rad, 0.4);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Scatter

export function scatter(
  ctx: CompileContext,
  op: ScatterOperation,
  placeComponent: (name: string, at: [number, number, number], rotate: number) => void,
): void {
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const on = op.on
    ? (() => {
        const names = new Set<string>();
        for (const ref of op.on ?? [])
          ctx.resolver.namesOf(ref, ctx.where).names.forEach((n) => names.add(n));
        return names;
      })()
    : null;
  const src = op.block ? ctx.source(op.block) : null;
  if (!src && !op.component && !op.tree) {
    ctx.error('scatter needs "block", "component" or "tree".');
    return;
  }
  if (op.component && !ctx.components[op.component]) {
    ctx.error(`scatter: unknown component "${op.component}".`);
    return;
  }
  const seed = (op.seed ?? ctx.seed) ^ 0x5ca7;
  const spacing = op.spacing ?? 0;
  const cell = Math.max(1, spacing);
  const placed = new Map<string, [number, number][]>();
  const farEnough = (x: number, z: number): boolean => {
    if (spacing <= 0) return true;
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const [px, pz] of placed.get(`${gx + dx},${gz + dz}`) ?? []) {
          if ((px - x) ** 2 + (pz - z) ** 2 < spacing * spacing) return false;
        }
      }
    }
    return true;
  };
  const targets: [number, number, number][] = [];
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const [wx, , wz] = ctx.toWorld(x, 0, z);
      if (hash3(wx, 0, wz, seed) >= op.density) continue;
      for (let y = y1; y >= y0; y--) {
        const id = ctx.get(x, y, z);
        if (id === 0) continue;
        if (ctx.get(x, y + 1, z) !== 0) break;
        const name = ctx.palette.get(id).name;
        if (on ? on.has(name) : !/leaves|water|lava|glass/.test(name)) targets.push([x, y + 1, z]);
        break;
      }
    }
  }
  for (const [x, y, z] of targets) {
    if (!farEnough(x, z)) continue;
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    placed.set(key, [...(placed.get(key) ?? []), [x, z]]);
    const h = hash3(x, y, z, seed ^ 0x1234);
    if (src) ctx.put(x, y, z, src);
    else if (op.component) placeComponent(op.component, [x, y, z], Math.floor(h * 4) * 90);
    else if (op.tree)
      tree(ctx, { type: 'tree', kind: op.tree, at: [x, y, z], seed: Math.floor(h * 1e6) });
  }
}
