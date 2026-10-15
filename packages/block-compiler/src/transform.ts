/**
 * Integer affine transform restricted to what builds need: any rotation/mirror around the
 * vertical axis (the 8 elements of D4 acting on x/z) plus a translation.
 *   x' = a*x + b*z + tx
 *   y' = y + ty
 *   z' = c*x + d*z + tz
 */
export class Transform {
  constructor(
    readonly a: number,
    readonly b: number,
    readonly c: number,
    readonly d: number,
    readonly tx: number,
    readonly ty: number,
    readonly tz: number,
  ) {}

  static readonly IDENTITY = new Transform(1, 0, 0, 1, 0, 0, 0);

  static translate(x: number, y: number, z: number): Transform {
    return new Transform(1, 0, 0, 1, x, y, z);
  }

  /** Clockwise as seen from above: east -> south -> west -> north. */
  static rotate(degrees: number): Transform {
    switch (((degrees % 360) + 360) % 360) {
      case 90:
        return new Transform(0, -1, 1, 0, 0, 0, 0);
      case 180:
        return new Transform(-1, 0, 0, -1, 0, 0, 0);
      case 270:
        return new Transform(0, 1, -1, 0, 0, 0, 0);
      default:
        return Transform.IDENTITY;
    }
  }

  /** Mirror across a plane: axis "x" flips x (east <-> west) around x = center. */
  static mirror(axis: 'x' | 'z', center = 0): Transform {
    return axis === 'x'
      ? new Transform(-1, 0, 0, 1, 2 * center, 0, 0)
      : new Transform(1, 0, 0, -1, 0, 0, 2 * center);
  }

  /** this ∘ other: apply `other` first, then this. */
  compose(other: Transform): Transform {
    return new Transform(
      this.a * other.a + this.b * other.c,
      this.a * other.b + this.b * other.d,
      this.c * other.a + this.d * other.c,
      this.c * other.b + this.d * other.d,
      this.a * other.tx + this.b * other.tz + this.tx,
      other.ty + this.ty,
      this.c * other.tx + this.d * other.tz + this.tz,
    );
  }

  get isIdentityLinear(): boolean {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1;
  }

  /** Index 0..7 of the linear part, used to cache transformed block states. */
  get linearKey(): number {
    return D4_KEYS.get(`${this.a},${this.b},${this.c},${this.d}`) ?? 0;
  }

  get mirrored(): boolean {
    return this.a * this.d - this.b * this.c < 0;
  }

  /** Transform a horizontal direction vector. */
  dir(dx: number, dz: number): [number, number] {
    return [this.a * dx + this.b * dz, this.c * dx + this.d * dz];
  }
}

const D4_KEYS = new Map<string, number>([
  ['1,0,0,1', 0],
  ['0,-1,1,0', 1],
  ['-1,0,0,-1', 2],
  ['0,1,-1,0', 3],
  ['-1,0,0,1', 4],
  ['1,0,0,-1', 5],
  ['0,1,1,0', 6],
  ['0,-1,-1,0', 7],
]);

export type Direction = 'north' | 'south' | 'east' | 'west';

export const DIR_VEC: Record<Direction, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

export function vecToDir(dx: number, dz: number): Direction {
  if (dx > 0) return 'east';
  if (dx < 0) return 'west';
  if (dz > 0) return 'south';
  return 'north';
}

function mapDir(t: Transform, dir: string): string {
  const v = DIR_VEC[dir as Direction];
  if (!v) return dir; // up / down / other
  const [x, z] = t.dir(v[0], v[1]);
  return vecToDir(x, z);
}

const SWAP_LR: Record<string, string> = {
  left: 'right',
  right: 'left',
  inner_left: 'inner_right',
  inner_right: 'inner_left',
  outer_left: 'outer_right',
  outer_right: 'outer_left',
};

function mapRailShape(t: Transform, shape: string): string {
  if (shape.startsWith('ascending_')) return `ascending_${mapDir(t, shape.slice(10))}`;
  const parts = shape.split('_').map((p) => mapDir(t, p));
  const set = new Set(parts);
  if (set.has('north') && set.has('south')) return 'north_south';
  if (set.has('east') && set.has('west')) return 'east_west';
  const ns = set.has('north') ? 'north' : 'south';
  const ew = set.has('east') ? 'east' : 'west';
  return `${ns}_${ew}`;
}

/**
 * Rotate/mirror the direction-dependent properties of a block state, the way the game does
 * when a structure is rotated (facing, axis, sign rotation, connections, stair shapes, …).
 */
export function transformProps(
  t: Transform,
  name: string,
  props: Record<string, string>,
): Record<string, string> {
  if (t.isIdentityLinear) return props;
  const out: Record<string, string> = {};
  const swapsAxes = t.a === 0;
  for (const [key, value] of Object.entries(props)) {
    const dirKey = DIR_VEC[key as Direction] ? mapDir(t, key) : null;
    if (dirKey) {
      out[dirKey] = value; // connection-style props: north=true -> east=true
      continue;
    }
    switch (key) {
      case 'facing':
      case 'horizontal_facing':
        out[key] = mapDir(t, value);
        break;
      case 'axis':
        out[key] = swapsAxes && value !== 'y' ? (value === 'x' ? 'z' : 'x') : value;
        break;
      case 'rotation': {
        const r = Number(value);
        const phi = (r * Math.PI) / 8;
        const [vx, vz] = t.dir(-Math.sin(phi), Math.cos(phi));
        const r2 = Math.round((Math.atan2(-vx, vz) * 8) / Math.PI);
        out[key] = String(((r2 % 16) + 16) % 16);
        break;
      }
      case 'shape':
        if (name.includes('rail')) out[key] = mapRailShape(t, value);
        else out[key] = t.mirrored ? (SWAP_LR[value] ?? value) : value;
        break;
      case 'hinge':
        out[key] = t.mirrored ? (SWAP_LR[value] ?? value) : value;
        break;
      case 'type':
        out[key] = name.includes('chest') && t.mirrored ? (SWAP_LR[value] ?? value) : value;
        break;
      case 'orientation':
        out[key] = value
          .split('_')
          .map((p) => mapDir(t, p))
          .join('_');
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}
