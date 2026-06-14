export const AIR = 'minecraft:air';

/** Return [min, max] of a pair. */
export function sortPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

export interface Vec3Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * A dense 3D grid of block states, indexed YZX (x varies fastest) to match the Sponge schematic
 * BlockData order. The palette maps states to small integer ids; index 0 is always air.
 */
export class BlockVolume {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  private readonly cells: Uint16Array;
  private readonly palette: string[] = [AIR];
  private readonly paletteIndex = new Map<string, number>([[AIR, 0]]);
  private _outOfBoundsWrites = 0;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.cells = new Uint16Array(x * y * z);
  }

  /** YZX layout: x varies fastest, then z, then y. */
  private index(x: number, y: number, z: number): number {
    return x + this.x * (z + this.z * y);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.x && y < this.y && z < this.z;
  }

  private idFor(state: string): number {
    const existing = this.paletteIndex.get(state);
    if (existing !== undefined) return existing;
    const id = this.palette.length;
    this.palette.push(state);
    this.paletteIndex.set(state, id);
    return id;
  }

  /** Place a block. Out-of-bounds writes are ignored (counted). Returns whether it was placed. */
  setBlock(x: number, y: number, z: number, state: string): boolean {
    if (!this.inBounds(x, y, z)) {
      this._outOfBoundsWrites++;
      return false;
    }
    this.cells[this.index(x, y, z)] = this.idFor(state);
    return true;
  }

  getBlock(x: number, y: number, z: number): string {
    if (!this.inBounds(x, y, z)) return AIR;
    const id = this.cells[this.index(x, y, z)] ?? 0;
    return this.palette[id] ?? AIR;
  }

  countBlocks(): number {
    let count = 0;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== 0) count++;
    }
    return count;
  }

  /** Distinct non-air states actually present, sorted. */
  getPalette(): string[] {
    const present = new Set<string>();
    for (let i = 0; i < this.cells.length; i++) {
      const id = this.cells[i] ?? 0;
      if (id !== 0) present.add(this.palette[id] ?? AIR);
    }
    return [...present].sort();
  }

  /** state -> list of [x,y,z] positions, iterating in YZX order. */
  toInstanceGroups(): Record<string, [number, number, number][]> {
    const groups: Record<string, [number, number, number][]> = {};
    this.forEachYZX((x, y, z, state) => {
      if (state === AIR) return;
      (groups[state] ??= []).push([x, y, z]);
    });
    return groups;
  }

  forEachYZX(cb: (x: number, y: number, z: number, state: string) => void): void {
    for (let y = 0; y < this.y; y++) {
      for (let z = 0; z < this.z; z++) {
        for (let x = 0; x < this.x; x++) {
          const id = this.cells[this.index(x, y, z)] ?? 0;
          cb(x, y, z, this.palette[id] ?? AIR);
        }
      }
    }
  }

  getNonAirBounds(): Vec3Bounds | null {
    let found = false;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let y = 0; y < this.y; y++) {
      for (let z = 0; z < this.z; z++) {
        for (let x = 0; x < this.x; x++) {
          if ((this.cells[this.index(x, y, z)] ?? 0) === 0) continue;
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
    }
    if (!found) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  get outOfBoundsWrites(): number {
    return this._outOfBoundsWrites;
  }
}
