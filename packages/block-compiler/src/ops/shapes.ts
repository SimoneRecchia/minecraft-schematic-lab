import type {
  BoxOperation,
  ConeOperation,
  CylinderOperation,
  DomeOperation,
  LineOperation,
  PolygonOperation,
  SphereOperation,
} from '@minecraft-schematic-lab/build-spec';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../context';
import type { BlockSource } from '../resolver';

export function box(ctx: CompileContext, op: BoxOperation): void {
  const src = ctx.source(op.block);
  const inner = op.inner !== undefined ? ctx.source(op.inner) : null;
  const t = op.thickness ?? 1;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const shell = op.hollow || op.walls;
  for (let y = y0; y <= y1; y++) {
    const capY = op.hollow && (y < y0 + t || y > y1 - t);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!shell) {
          ctx.put(x, y, z, src);
          continue;
        }
        const side = x < x0 + t || x > x1 - t || z < z0 + t || z > z1 - t;
        if (side || capY) ctx.put(x, y, z, src);
        else if (inner) ctx.put(x, y, z, inner);
      }
    }
  }
}

/** 3D Bresenham between two points, calling visit for each cell. */
export function bresenham3(
  a: [number, number, number],
  b: [number, number, number],
  visit: (x: number, y: number, z: number) => void,
): void {
  let [x, y, z] = a;
  const [x1, y1, z1] = b;
  const dx = Math.abs(x1 - x);
  const dy = Math.abs(y1 - y);
  const dz = Math.abs(z1 - z);
  const sx = x1 > x ? 1 : -1;
  const sy = y1 > y ? 1 : -1;
  const sz = z1 > z ? 1 : -1;
  const n = Math.max(dx, dy, dz);
  let ex = n / 2;
  let ey = n / 2;
  let ez = n / 2;
  for (let i = 0; i <= n; i++) {
    visit(x, y, z);
    ex -= dx;
    ey -= dy;
    ez -= dz;
    if (ex < 0) {
      x += sx;
      ex += n;
    }
    if (ey < 0) {
      y += sy;
      ey += n;
    }
    if (ez < 0) {
      z += sz;
      ez += n;
    }
  }
}

export function stampBall(
  ctx: CompileContext,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  src: BlockSource,
): void {
  if (r <= 0) {
    ctx.put(cx, cy, cz, src);
    return;
  }
  const reach = Math.ceil(r);
  const lim = (r + 0.5) * (r + 0.5);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy + dz * dz < lim) ctx.put(cx + dx, cy + dy, cz + dz, src);
      }
    }
  }
}

export function line(ctx: CompileContext, op: LineOperation): void {
  const pts = op.points ?? (op.from && op.to ? [op.from, op.to] : null);
  if (!pts) {
    ctx.error('line needs "from" and "to", or "points".');
    return;
  }
  const src = ctx.source(op.block);
  const r = op.radius ?? 0;
  for (let i = 0; i < pts.length - 1; i++) {
    bresenham3(
      pts[i] as [number, number, number],
      pts[i + 1] as [number, number, number],
      (x, y, z) => stampBall(ctx, x, y, z, r, src),
    );
  }
}

/** Cross-section coordinates of an axis: which spec components are (along, u, v). */
function axisIndices(axis: 'x' | 'y' | 'z'): [number, number, number] {
  if (axis === 'x') return [0, 1, 2];
  if (axis === 'z') return [2, 0, 1];
  return [1, 0, 2];
}

/**
 * Filled or hollow (elliptic) disc stack along an axis. Centers may sit on .5 for even widths:
 * diameter is 2r+1 around an integer center and 2r around a .5 center. Hollow rings keep only
 * cells that touch the outside, giving clean 1-block walls like WorldEdit's //cyl -h.
 */
export function cylinderLike(
  ctx: CompileContext,
  center: [number, number, number],
  axis: 'x' | 'y' | 'z',
  height: number,
  radiusAt: (h: number) => [number, number],
  src: BlockSource,
  hollow: boolean,
  thickness: number,
): void {
  const [ia, iu, iv] = axisIndices(axis);
  const ca = Math.floor(center[ia] as number);
  const cu = center[iu] as number;
  const cv = center[iv] as number;
  const p: [number, number, number] = [0, 0, 0];
  for (let h = 0; h < height; h++) {
    const [ru, rv] = radiusAt(h);
    const inside = (u: number, v: number, du: number, dv: number): boolean => {
      if (du < 0 || dv < 0) return false;
      const a = (u - cu) / (du + 0.5);
      const b = (v - cv) / (dv + 0.5);
      return a * a + b * b < 1;
    };
    const u0 = Math.floor(cu - ru - 1);
    const u1 = Math.ceil(cu + ru + 1);
    const v0 = Math.floor(cv - rv - 1);
    const v1 = Math.ceil(cv + rv + 1);
    p[ia] = ca + h;
    for (let v = v0; v <= v1; v++) {
      for (let u = u0; u <= u1; u++) {
        if (!inside(u, v, ru, rv)) continue;
        if (hollow) {
          const edge =
            thickness <= 1
              ? !inside(u + 1, v, ru, rv) ||
                !inside(u - 1, v, ru, rv) ||
                !inside(u, v + 1, ru, rv) ||
                !inside(u, v - 1, ru, rv)
              : !inside(u, v, ru - thickness, rv - thickness);
          if (!edge) continue;
        }
        p[iu] = u;
        p[iv] = v;
        ctx.put(p[0], p[1], p[2], src);
      }
    }
  }
}

export function cylinder(ctx: CompileContext, op: CylinderOperation): void {
  const src = ctx.source(op.block);
  const r2 = op.radius2 ?? op.radius;
  const top = op.radiusTop;
  const n = op.height;
  cylinderLike(
    ctx,
    op.center,
    op.axis ?? 'y',
    n,
    (h) => {
      if (top === undefined) return [op.radius, r2];
      const t = n <= 1 ? 0 : h / (n - 1);
      const k = (op.radius + (top - op.radius) * t) / op.radius;
      return [op.radius * k, r2 * k];
    },
    src,
    op.hollow ?? false,
    op.thickness ?? 1,
  );
}

export function cone(ctx: CompileContext, op: ConeOperation): void {
  const src = ctx.source(op.block);
  const n = op.height;
  cylinderLike(
    ctx,
    op.center,
    op.axis ?? 'y',
    n,
    (h) => {
      // Linear taper ending in a single-block tip.
      const r = (op.radius * (n - 1 - h)) / Math.max(1, n - 1);
      return [r, r];
    },
    src,
    op.hollow ?? false,
    1,
  );
}

function ellipsoid(
  ctx: CompileContext,
  center: [number, number, number],
  radii: [number, number, number],
  src: BlockSource,
  hollow: boolean,
  thickness: number,
  half: SphereOperation['half'],
): void {
  const [rx, ry, rz] = radii;
  const [cx, cy, cz] = center;
  const inside = (x: number, y: number, z: number, sx: number, sy: number, sz: number): boolean => {
    if (sx < 0 || sy < 0 || sz < 0) return false;
    const a = (x - cx) / (sx + 0.5);
    const b = (y - cy) / (sy + 0.5);
    const c = (z - cz) / (sz + 0.5);
    return a * a + b * b + c * c < 1;
  };
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    if (half === 'top' && y < cy) continue;
    if (half === 'bottom' && y > cy) continue;
    for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz + 1); z++) {
      if (half === 'north' && z > cz) continue;
      if (half === 'south' && z < cz) continue;
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (half === 'west' && x > cx) continue;
        if (half === 'east' && x < cx) continue;
        if (!inside(x, y, z, rx, ry, rz)) continue;
        if (hollow) {
          const edge =
            thickness <= 1
              ? !inside(x + 1, y, z, rx, ry, rz) ||
                !inside(x - 1, y, z, rx, ry, rz) ||
                !inside(x, y + 1, z, rx, ry, rz) ||
                !inside(x, y - 1, z, rx, ry, rz) ||
                !inside(x, y, z + 1, rx, ry, rz) ||
                !inside(x, y, z - 1, rx, ry, rz)
              : !inside(x, y, z, rx - thickness, ry - thickness, rz - thickness);
          if (!edge) continue;
        }
        ctx.put(x, y, z, src);
      }
    }
  }
}

export function sphere(ctx: CompileContext, op: SphereOperation): void {
  const radii = op.radii ?? (op.radius ? [op.radius, op.radius, op.radius] : null);
  if (!radii) {
    ctx.error('sphere needs "radius" or "radii".');
    return;
  }
  ellipsoid(
    ctx,
    op.center,
    radii,
    ctx.source(op.block),
    op.hollow ?? false,
    op.thickness ?? 1,
    op.half,
  );
}

export function dome(ctx: CompileContext, op: DomeOperation): void {
  const h = op.height ?? op.radius;
  ellipsoid(
    ctx,
    op.center,
    [op.radius, h, op.radius],
    ctx.source(op.block),
    op.hollow ?? false,
    op.thickness ?? 1,
    'top',
  );
}

function pointInPolygon(px: number, pz: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i] as [number, number];
    const [xj, zj] = pts[j] as [number, number];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px: number, pz: number, a: [number, number], b: [number, number]): number {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / len2));
  const dx = px - (a[0] + t * vx);
  const dz = pz - (a[1] + t * vz);
  return Math.sqrt(dx * dx + dz * dz);
}

export function polygon(ctx: CompileContext, op: PolygonOperation): void {
  const src = ctx.source(op.block);
  const pts = op.points as [number, number][];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const cells = new Set<number>();
  const W = maxX - minX + 1;
  const mark = (x: number, z: number): void => {
    cells.add((z - minZ) * W + (x - minX));
  };
  // Outline (always included so edges are crisp), then interior.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as [number, number];
    const b = pts[(i + 1) % pts.length] as [number, number];
    bresenham3([a[0], 0, a[1]], [b[0], 0, b[1]], (x, _y, z) => mark(x, z));
  }
  const t = op.thickness ?? 1;
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      if (!pointInPolygon(x, z, pts)) continue;
      if (op.hollow && t > 1) {
        let d = Infinity;
        for (let i = 0; i < pts.length; i++) {
          d = Math.min(
            d,
            distToSegment(
              x,
              z,
              pts[i] as [number, number],
              pts[(i + 1) % pts.length] as [number, number],
            ),
          );
        }
        if (d < t - 0.5) mark(x, z);
      } else if (!op.hollow) {
        mark(x, z);
      }
    }
  }
  for (const key of cells) {
    const x = (key % W) + minX;
    const z = Math.floor(key / W) + minZ;
    for (let y = op.y; y < op.y + op.height; y++) ctx.put(x, y, z, src);
  }
}
