import type { RoofOperation } from '@minecraft-schematic-lab/build-spec';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../context';
import type { BlockSource } from '../resolver';
import type { Direction } from '../transform';
import { deriveFamily } from './family';

interface Column {
  x: number;
  z: number;
  /** Rows from the outer edge (0 = eave). */
  d: number;
  /** Direction the stairs face (toward the ridge); null on the ridge/peak line. */
  facing: Direction | null;
}

const EPS = 1e-6;

/**
 * Pitched roofs built the way good builders do by hand: stairs facing the ridge, half steps as
 * bottom slabs, closed steep steps, a capped ridge, eaves trim, gable end walls and overhangs.
 * Corner stair shapes (hips, cones) are resolved by the stair-shape pass afterwards.
 */
export function roof(ctx: CompileContext, op: RoofOperation): void {
  const shape = op.shape;
  const overhang = op.overhang ?? (shape === 'flat' ? 0 : 1);

  if (shape === 'cone') {
    coneRoof(ctx, op, overhang);
    return;
  }
  if (!op.from || !op.to) {
    ctx.error(`roof "${shape}" needs "from" and "to" (the wall footprint).`);
    return;
  }
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const y = op.from[1];
  const X0 = x0 - overhang;
  const X1 = x1 + overhang;
  const Z0 = z0 - overhang;
  const Z1 = z1 + overhang;

  if (shape === 'flat') {
    const src = ctx.source(op.block, { type: 'bottom' });
    for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) ctx.put(x, y, z, src);
    if (op.eaves) {
      const trim = ctx.source(op.eaves);
      for (let z = Z0; z <= Z1; z++) {
        for (let x = X0; x <= X1; x++) {
          if (x === X0 || x === X1 || z === Z0 || z === Z1) ctx.put(x, y + 1, z, trim);
        }
      }
    }
    return;
  }

  const axis = op.axis ?? (x1 - x0 >= z1 - z0 ? 'x' : 'z');
  const columns: Column[] = [];
  for (let z = Z0; z <= Z1; z++) {
    for (let x = X0; x <= X1; x++) {
      const dx0 = x - X0;
      const dx1 = X1 - x;
      const dz0 = z - Z0;
      const dz1 = Z1 - z;
      let d: number;
      let facing: Direction | null;
      if (shape === 'gable') {
        if (axis === 'x') {
          d = Math.min(dz0, dz1);
          facing = dz0 < dz1 ? 'south' : dz0 > dz1 ? 'north' : null;
        } else {
          d = Math.min(dx0, dx1);
          facing = dx0 < dx1 ? 'east' : dx0 > dx1 ? 'west' : null;
        }
      } else if (shape === 'hip') {
        d = Math.min(dx0, dx1, dz0, dz1);
        if (d === dz0 && d !== dz1) facing = 'south';
        else if (d === dz1 && d !== dz0) facing = 'north';
        else if (d === dx0 && d !== dx1) facing = 'east';
        else if (d === dx1 && d !== dx0) facing = 'west';
        else facing = null; // centre line of an odd-width hip
      } else {
        // shed: rises toward `rise`
        const rise = op.rise ?? 'north';
        d = rise === 'north' ? dz1 : rise === 'south' ? dz0 : rise === 'west' ? dx1 : dx0;
        facing = rise;
      }
      columns.push({ x, z, d, facing });
    }
  }
  const ridgeAxis =
    shape === 'hip'
      ? x1 - x0 >= z1 - z0
        ? 'x'
        : 'z'
      : shape === 'gable'
        ? axis
        : op.rise === 'east' || op.rise === 'west'
          ? 'z'
          : 'x';
  buildSurface(ctx, op, columns, y, overhang, ridgeAxis);

  // Gable end walls (gable: the two ends of the ridge; shed: the two sloped sides).
  if (op.gable && (shape === 'gable' || shape === 'shed')) {
    const gable = ctx.source(op.gable);
    const along = shape === 'gable' ? axis : op.rise === 'east' || op.rise === 'west' ? 'z' : 'x';
    const ends = along === 'x' ? [x0, x1] : [z0, z1];
    const bottoms = surfaceBottoms(columns, op, y, overhang);
    for (const c of columns) {
      const atEnd = along === 'x' ? ends.includes(c.x) : ends.includes(c.z);
      const inside = along === 'x' ? c.z >= z0 && c.z <= z1 : c.x >= x0 && c.x <= x1;
      if (!atEnd || !inside) continue;
      const bottom = bottoms.get(`${c.x},${c.z}`) ?? y;
      for (let yy = y; yy < bottom; yy++) ctx.put(c.x, yy, c.z, gable);
    }
  }
}

function rowHeights(op: RoofOperation, maxD: number): number[] {
  const profile = op.profile ?? [op.pitch ?? 1];
  const t: number[] = [];
  let acc = 0;
  for (let d = 0; d <= maxD + 1; d++) {
    acc += profile[Math.min(d, profile.length - 1)] as number;
    t.push(acc);
  }
  return t;
}

/** Lowest roof cell per column (gable walls and fill stop below it). */
function surfaceBottoms(
  columns: Column[],
  op: RoofOperation,
  y: number,
  overhang: number,
): Map<string, number> {
  const maxD = columns.reduce((m, c) => Math.max(m, c.d), 0);
  const t = rowHeights(op, maxD);
  const yb = y - Math.ceil((t[overhang] ?? 1) - EPS) + 1;
  const out = new Map<string, number>();
  for (const c of columns) {
    const prevTop = c.d > 0 ? yb + Math.ceil((t[c.d - 1] as number) - EPS) - 1 : yb - 1;
    const start = c.d > 0 ? yb + Math.floor((t[c.d - 1] as number) + EPS) : yb;
    out.set(`${c.x},${c.z}`, c.facing === null ? prevTop : Math.min(start, prevTop + 1));
  }
  return out;
}

function buildSurface(
  ctx: CompileContext,
  op: RoofOperation,
  columns: Column[],
  y: number,
  overhang: number,
  ridgeAxis: 'x' | 'z' = 'x',
): void {
  const maxD = columns.reduce((m, c) => Math.max(m, c.d), 0);
  const t = rowHeights(op, maxD);
  // Row `overhang` (directly above the wall face) has its top cell at y.
  const yb = y - Math.ceil((t[overhang] ?? 1) - EPS) + 1;
  const topOf = (d: number): number => yb + Math.ceil((t[d] as number) - EPS) - 1;

  const stairs = new Map<string, BlockSource>();
  const stairsFor = (facing: Direction, half: 'bottom' | 'top' = 'bottom'): BlockSource => {
    const key = `${facing}|${half}`;
    let s = stairs.get(key);
    if (!s) {
      s = ctx.source(op.block, { facing, half });
      stairs.set(key, s);
    }
    return s;
  };
  const slabRef = op.slab ?? deriveFamily(ctx, op.block, 'slab') ?? op.block;
  const fullRef = op.full ?? deriveFamily(ctx, op.block, 'full') ?? op.block;
  const slab = ctx.source(slabRef, { type: 'bottom' });
  const full = ctx.source(fullRef);
  const fill = op.fill ? ctx.source(op.fill) : null;
  const eaves = op.eaves;
  const ridgeRef = op.ridge;
  const ridgeSoft = { type: 'bottom', axis: ridgeAxis };

  for (const c of columns) {
    const prevTop = c.d > 0 ? topOf(c.d - 1) : yb - 1;
    // First cell this column must fill: the cell holding the previous row's surface. When that
    // row ends in a half step (slab), this column still has to cover the upper half of that cell.
    const start = c.d > 0 ? yb + Math.floor((t[c.d - 1] as number) + EPS) : yb;
    let bottom: number;
    let capTop: number;
    if (c.facing === null) {
      // Ridge line of an odd width: close it at the neighbours' level, then cap half a step up.
      const prevT = c.d > 0 ? (t[c.d - 1] as number) : 0;
      const tc = prevT + ((t[c.d] as number) - prevT) / 2;
      const capHalf = Math.abs(tc - Math.floor(tc) - 0.5) < 0.01;
      const fullTo = capHalf ? yb + Math.floor(tc) - 1 : yb + Math.ceil(tc - EPS) - 1;
      bottom = prevTop;
      for (let yy = prevTop; yy <= fullTo; yy++) ctx.put(c.x, yy, c.z, full);
      if (capHalf) {
        capTop = yb + Math.floor(tc);
        if (ridgeRef) ctx.put(c.x, capTop, c.z, ctx.source(ridgeRef, ridgeSoft));
        else ctx.put(c.x, capTop, c.z, slab);
      } else {
        capTop = fullTo;
        if (ridgeRef) ctx.put(c.x, capTop + 1, c.z, ctx.source(ridgeRef, ridgeSoft));
      }
    } else {
      const tt = t[c.d] as number;
      const half = Math.abs(tt - Math.floor(tt) - 0.5) < 0.01;
      bottom = Math.min(start, prevTop + 1);
      if (half) {
        const sy = yb + Math.floor(tt);
        for (let yy = start; yy < sy; yy++) ctx.put(c.x, yy, c.z, full);
        ctx.put(c.x, sy, c.z, slab);
        capTop = sy;
      } else {
        const top = topOf(c.d);
        for (let yy = start; yy < top; yy++) ctx.put(c.x, yy, c.z, full);
        ctx.put(c.x, top, c.z, stairsFor(c.facing));
        capTop = top;
      }
      if (ridgeRef && c.d === maxD) {
        ctx.put(c.x, capTop + 1, c.z, ctx.source(ridgeRef, ridgeSoft));
      }
    }
    if (fill) {
      for (let yy = y; yy < bottom; yy++) ctx.put(c.x, yy, c.z, fill);
    }
    if (eaves && c.d === 0 && c.facing) {
      // Upside-down stairs tucked under the eave, stepping in toward the wall.
      ctx.put(
        c.x,
        bottom - 1,
        c.z,
        ctx.source(eaves, { facing: c.facing, half: 'top', type: 'top' }),
      );
    }
  }
}

function coneRoof(ctx: CompileContext, op: RoofOperation, overhang: number): void {
  if (!op.center || !op.radius) {
    ctx.error(
      'roof "cone" needs "center" ([x, y, z], y = first layer above the wall) and "radius".',
    );
    return;
  }
  const [cx, y, cz] = op.center;
  const R = op.radius + overhang;
  const columns: Column[] = [];
  let maxD = 0;
  for (let z = Math.floor(cz - R - 1); z <= Math.ceil(cz + R + 1); z++) {
    for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) {
      const dx = x - cx;
      const dz = z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= R + 0.5) continue;
      const d = Math.max(0, Math.floor(R + 0.5 - dist - EPS));
      let facing: Direction | null;
      if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) facing = null;
      else if (Math.abs(dx) >= Math.abs(dz)) facing = dx > 0 ? 'west' : 'east';
      else facing = dz > 0 ? 'north' : 'south';
      maxD = Math.max(maxD, d);
      columns.push({ x, z, d, facing });
    }
  }
  // The innermost ring becomes the peak.
  for (const c of columns) if (c.d === maxD) c.facing = null;
  buildSurface(ctx, { ...op, ridge: undefined }, columns, y, overhang);
  // Finial / spire tip on top of the peak.
  if (op.ridge) {
    const tip = columns.find((c) => c.facing === null);
    if (tip) {
      let top = y;
      for (let yy = y; yy < y + 512; yy++) if (ctx.get(tip.x, yy, tip.z) !== 0) top = yy;
      ctx.put(tip.x, top + 1, tip.z, ctx.source(op.ridge));
    }
  }
}
