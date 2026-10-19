const CHUNK_BITS = 4;
const CHUNK = 1 << CHUNK_BITS;
const MASK = CHUNK - 1;
const OFFSET = 2048; // chunk coords in [-2048, 2047] -> ±32k blocks

export interface Chunk {
  cx: number;
  cy: number;
  cz: number;
  ids: Uint16Array;
  prov: Uint16Array;
}

export const COORD_LIMIT = 30000;
/** ~100 million blocks of allocated space. */
export const MAX_CHUNKS = 25_000;

export class CompileLimitError extends Error {}

function chunkKey(cx: number, cy: number, cz: number): number {
  return ((cx + OFFSET) * 4096 + (cy + OFFSET)) * 4096 + (cz + OFFSET);
}

/**
 * Growable compile-time volume in 16³ chunks: specs need no fixed size, may use negative
 * coordinates, and empty space costs nothing.
 */
export class SparseVolume {
  readonly chunks = new Map<number, Chunk>();
  writes = 0;
  /** Lowest and highest chunk layer allocated so far (for top-down column scans). */
  minChunkY = Infinity;
  maxChunkY = -Infinity;
  private last: Chunk | null = null;
  private lastKey = -1;

  private chunkAt(x: number, y: number, z: number, create: boolean): Chunk | null {
    const cx = x >> CHUNK_BITS;
    const cy = y >> CHUNK_BITS;
    const cz = z >> CHUNK_BITS;
    const key = chunkKey(cx, cy, cz);
    if (key === this.lastKey) return this.last;
    let chunk = this.chunks.get(key) ?? null;
    if (!chunk && create) {
      if (this.chunks.size >= MAX_CHUNKS) {
        throw new CompileLimitError(
          `The build is too large (over ${MAX_CHUNKS} chunks of 16³ ≈ 100 million blocks of space). Check coordinates for a typo, or split it into several builds.`,
        );
      }
      chunk = {
        cx,
        cy,
        cz,
        ids: new Uint16Array(CHUNK * CHUNK * CHUNK),
        prov: new Uint16Array(CHUNK * CHUNK * CHUNK),
      };
      this.chunks.set(key, chunk);
      if (cy < this.minChunkY) this.minChunkY = cy;
      if (cy > this.maxChunkY) this.maxChunkY = cy;
    }
    if (chunk) {
      this.last = chunk;
      this.lastKey = key;
    }
    return chunk;
  }

  static inRange(x: number, y: number, z: number): boolean {
    return (
      x > -COORD_LIMIT &&
      x < COORD_LIMIT &&
      y > -COORD_LIMIT &&
      y < COORD_LIMIT &&
      z > -COORD_LIMIT &&
      z < COORD_LIMIT
    );
  }

  get(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return 0;
    return c.ids[((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK)] as number;
  }

  getProv(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return 0;
    return c.prov[((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK)] as number;
  }

  set(x: number, y: number, z: number, id: number, prov: number): void {
    const c = this.chunkAt(x, y, z, id !== 0);
    if (!c) return;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    c.ids[i] = id;
    c.prov[i] = prov;
    this.writes++;
  }

  /** Visit every non-air cell. */
  forEach(cb: (x: number, y: number, z: number, id: number, prov: number) => void): void {
    for (const c of this.chunks.values()) {
      const bx = c.cx << CHUNK_BITS;
      const by = c.cy << CHUNK_BITS;
      const bz = c.cz << CHUNK_BITS;
      for (let i = 0; i < c.ids.length; i++) {
        const id = c.ids[i] as number;
        if (id === 0) continue;
        cb(bx + (i & MASK), by + (i >> 8), bz + ((i >> 4) & MASK), id, c.prov[i] as number);
      }
    }
  }

  /** Bounds of non-air cells, or null when empty. */
  bounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const c of this.chunks.values()) {
      const bx = c.cx << CHUNK_BITS;
      const by = c.cy << CHUNK_BITS;
      const bz = c.cz << CHUNK_BITS;
      // Skip chunks that cannot extend the current bounds.
      if (
        bx >= minX &&
        bx + MASK <= maxX &&
        by >= minY &&
        by + MASK <= maxY &&
        bz >= minZ &&
        bz + MASK <= maxZ
      ) {
        continue;
      }
      for (let i = 0; i < c.ids.length; i++) {
        if (c.ids[i] === 0) continue;
        const x = bx + (i & MASK);
        const y = by + (i >> 8);
        const z = bz + ((i >> 4) & MASK);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }
    if (minX === Infinity) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }
}
