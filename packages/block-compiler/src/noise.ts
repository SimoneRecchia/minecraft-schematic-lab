/** Deterministic integer hash of a position + seed -> [0, 1). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Small fast seeded PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0 || 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const GRAD3 = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
] as const;

/** Seeded 3D Perlin noise, roughly in [-1, 1]. */
export class Perlin {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    const rnd = makeRng(seed);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i] as number;
      p[i] = p[j] as number;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255] as number;
  }

  noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const P = this.perm;
    const A = (P[X] as number) + Y;
    const AA = (P[A] as number) + Z;
    const AB = (P[A + 1] as number) + Z;
    const B = (P[X + 1] as number) + Y;
    const BA = (P[B] as number) + Z;
    const BB = (P[B + 1] as number) + Z;
    return (
      lerp(
        w,
        lerp(
          v,
          lerp(u, grad(P[AA] as number, x, y, z), grad(P[BA] as number, x - 1, y, z)),
          lerp(u, grad(P[AB] as number, x, y - 1, z), grad(P[BB] as number, x - 1, y - 1, z)),
        ),
        lerp(
          v,
          lerp(
            u,
            grad(P[AA + 1] as number, x, y, z - 1),
            grad(P[BA + 1] as number, x - 1, y, z - 1),
          ),
          lerp(
            u,
            grad(P[AB + 1] as number, x, y - 1, z - 1),
            grad(P[BB + 1] as number, x - 1, y - 1, z - 1),
          ),
        ),
      ) * 1.1
    );
  }

  /** Fractal sum of octaves, roughly in [-1, 1]. */
  fbm(x: number, y: number, z: number, octaves = 4): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}
function grad(hash: number, x: number, y: number, z: number): number {
  const g = GRAD3[hash % 12] as readonly [number, number, number];
  return g[0] * x + g[1] * y + g[2] * z;
}

/**
 * Map fbm noise to a ~uniform [0,1) value via an empirical CDF, so weighted mixes keep their
 * ratios while forming natural-looking clumps.
 */
export class UniformNoise {
  private readonly perlin: Perlin;
  private readonly cdf: Float32Array;

  constructor(seed: number) {
    this.perlin = new Perlin(seed);
    const samples = new Float32Array(4096);
    const rnd = makeRng(seed ^ 0x51ed27);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = this.perlin.fbm(rnd() * 256, rnd() * 256, rnd() * 256, 3);
    }
    samples.sort();
    this.cdf = samples;
  }

  at(x: number, y: number, z: number, scale: number): number {
    const v = this.perlin.fbm(x / scale, y / scale, z / scale, 3);
    let lo = 0;
    let hi = this.cdf.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.cdf[mid] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(0.999999, lo / this.cdf.length);
  }
}
