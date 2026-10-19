import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  blockNameOf,
  terrainClass,
  versionForDataVersion,
  type TerrainClass,
} from '@minecraft-schematic-lab/catalog';
import {
  compoundToJson,
  getNumber,
  getString,
  type ImportedVolume,
} from '@minecraft-schematic-lab/formats';
import { AIR, decodeChunk, MIN_WRITE_DATA_VERSION, type Chunk } from './chunk';
import { RegionFile } from './region';
import { OVERWORLD, regionDir } from './saves';

export type Vec3 = [number, number, number];

/** A piece of the player's world (or of a schematic) to build on. */
export interface SiteVolume {
  version: string;
  dataVersion: number | null;
  /** World position of local cell (0,0,0). */
  worldMin: Vec3;
  size: Vec3;
  /** Index 0 is air. */
  palette: string[];
  /** Palette indices in YZX order (x fastest). */
  data: Uint16Array;
  /** Block entities at local positions. */
  blockEntities: { id: string; pos: Vec3; data: Record<string, unknown> }[];
  /** World position of BuildSpec (0,0,0): the centre column, one block above the ground. */
  origin: Vec3;
  /** True when every chunk in the area can be written back (1.14+, fully generated). */
  writable: boolean;
  warnings: string[];
}

export interface SiteOptions {
  dimension?: string;
  /** Centre column [x, z], or [x, y, z] where y is the level BuildSpec y=0 should be. */
  center: [number, number] | Vec3;
  /** Half-size of the square area, in blocks (4–128). */
  radius: number;
  /** Blocks kept below the lowest ground (default 12). */
  below?: number;
  /** Room above the highest ground (default 64). */
  above?: number;
}

export const MAX_SITE_RADIUS = 128;

const classCache = new Map<string, TerrainClass>();
export function classOf(state: string): TerrainClass {
  let c = classCache.get(state);
  if (c === undefined) {
    c = terrainClass(blockNameOf(state));
    classCache.set(state, c);
  }
  return c;
}

/** Per-column heights of a volume: top ground block, top non-air block, top water (or -1). */
export interface Heights {
  ground: Int16Array;
  top: Int16Array;
  water: Int16Array;
}

export function columnHeights(palette: readonly string[], data: Uint16Array, size: Vec3): Heights {
  const [sx, sy, sz] = size;
  const classes = palette.map(classOf);
  const n = sx * sz;
  const ground = new Int16Array(n).fill(-1);
  const top = new Int16Array(n).fill(-1);
  const water = new Int16Array(n).fill(-1);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const col = x + sx * z;
      for (let y = sy - 1; y >= 0; y--) {
        const c = classes[data[x + sx * (z + sz * y)] as number];
        if (c === 'air') continue;
        if (top[col] === -1) top[col] = y;
        if (c === 'liquid' && water[col] === -1) water[col] = y;
        if (c === 'ground') {
          ground[col] = y;
          break;
        }
      }
    }
  }
  return { ground, top, water };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

/** CamelCase pre-1.11 ids ("Chest", "MobSpawner") to namespaced snake case. */
function blockEntityId(raw: string): string {
  if (raw.includes(':')) return raw;
  return `minecraft:${raw.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`;
}

/** Read a square area of a Java world. Chunks are read straight from the region files. */
export function readWorldSite(worldDir: string, options: SiteOptions): SiteVolume {
  const dimension = options.dimension ?? OVERWORLD;
  const radius = Math.round(options.radius);
  if (!(radius >= 4 && radius <= MAX_SITE_RADIUS))
    throw new Error(`The radius must be between 4 and ${MAX_SITE_RADIUS} blocks.`);
  const dir = regionDir(worldDir, dimension);
  if (!dir) throw new Error(`This world has no saved ${dimension} chunks.`);
  const [cxw, czw] = [
    Math.floor(options.center[0]),
    Math.floor(options.center[options.center.length - 1] as number),
  ];
  const x0 = cxw - radius;
  const x1 = cxw + radius;
  const z0 = czw - radius;
  const z1 = czw + radius;

  const regions = new Map<string, RegionFile | null>();
  const regionAt = (rx: number, rz: number): RegionFile | null => {
    const key = `${rx},${rz}`;
    if (!regions.has(key)) {
      const file = join(dir, `r.${rx}.${rz}.mca`);
      regions.set(
        key,
        existsSync(file)
          ? RegionFile.parse(readFileSync(file), rx, rz, (cx, cz) => {
              const mcc = join(dir, `c.${cx}.${cz}.mcc`);
              return existsSync(mcc) ? readFileSync(mcc) : null;
            })
          : null,
      );
    }
    return regions.get(key) ?? null;
  };

  const chunks = new Map<string, Chunk>();
  let missing = 0;
  let incomplete = 0;
  let oldFormat = 0;
  let unreadable = 0;
  const unknownIds = new Set<number>();
  let minDataVersion = Infinity;
  let maxDataVersion = 0;
  let bottom = Infinity;
  let topLimit = -Infinity;
  for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) {
    for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
      const region = regionAt(cx >> 5, cz >> 5);
      let bytes: Buffer | null = null;
      try {
        bytes = region?.read(cx, cz) ?? null;
      } catch {
        unreadable++;
        continue;
      }
      if (!bytes) {
        missing++;
        continue;
      }
      let chunk: Chunk;
      try {
        chunk = decodeChunk(bytes);
      } catch {
        unreadable++;
        continue;
      }
      if (!chunk.complete) incomplete++;
      if (chunk.format === 'legacy' || chunk.dataVersion < MIN_WRITE_DATA_VERSION) oldFormat++;
      chunk.unknownIds.forEach((id) => unknownIds.add(id));
      minDataVersion = Math.min(minDataVersion, chunk.dataVersion);
      maxDataVersion = Math.max(maxDataVersion, chunk.dataVersion);
      for (const y of chunk.sections.keys()) {
        bottom = Math.min(bottom, y * 16);
        topLimit = Math.max(topLimit, y * 16 + 15);
      }
      chunks.set(`${cx},${cz}`, chunk);
    }
  }
  if (!chunks.size)
    throw new Error(
      `No saved chunks around ${cxw}, ${czw} in ${dimension}: walk there in the game, then save and quit.`,
    );

  // Column heights straight from the chunks, to crop the volume vertically.
  const sx = x1 - x0 + 1;
  const sz = z1 - z0 + 1;
  const groundCol = new Int32Array(sx * sz).fill(-100000);
  const topCol = new Int32Array(sx * sz).fill(-100000);
  for (const chunk of chunks.values()) {
    const ys = [...chunk.sections.keys()].sort((a, b) => b - a);
    for (let lz = 0; lz < 16; lz++) {
      const wz = chunk.cz * 16 + lz;
      if (wz < z0 || wz > z1) continue;
      for (let lx = 0; lx < 16; lx++) {
        const wx = chunk.cx * 16 + lx;
        if (wx < x0 || wx > x1) continue;
        const col = wx - x0 + sx * (wz - z0);
        scan: for (const sy of ys) {
          const s = chunk.sections.get(sy);
          if (!s) continue;
          for (let y = 15; y >= 0; y--) {
            const state = s.palette[s.blocks[(y << 8) | (lz << 4) | lx] as number] ?? AIR;
            const c = classOf(state);
            if (c === 'air') continue;
            if (topCol[col] === -100000) topCol[col] = sy * 16 + y;
            if (c === 'ground') {
              groundCol[col] = sy * 16 + y;
              break scan;
            }
          }
        }
      }
    }
  }
  const grounds = [...groundCol].filter((g) => g > -100000);
  let minGround = Infinity;
  let maxGround = -Infinity;
  for (const g of grounds) {
    if (g < minGround) minGround = g;
    if (g > maxGround) maxGround = g;
  }
  if (!grounds.length) minGround = maxGround = bottom;
  let maxTop = maxGround;
  for (const t of topCol) if (t > maxTop) maxTop = t;
  const y0 = Math.max(bottom, minGround - (options.below ?? 12));
  const y1 = Math.min(topLimit, Math.max(maxTop + 1, maxGround + (options.above ?? 64)));
  const sy = y1 - y0 + 1;

  const palette: string[] = [AIR];
  const index = new Map<string, number>([[AIR, 0]]);
  const data = new Uint16Array(sx * sy * sz);
  const blockEntities: SiteVolume['blockEntities'] = [];
  for (const chunk of chunks.values()) {
    for (const s of chunk.sections.values()) {
      const by = s.y * 16;
      if (by + 15 < y0 || by > y1) continue;
      const ids = s.palette.map((state) => {
        let id = index.get(state);
        if (id === undefined) {
          id = palette.length;
          if (id >= 65535) throw new Error('This area has too many different blocks to read.');
          palette.push(state);
          index.set(state, id);
        }
        return id;
      });
      for (let i = 0; i < 4096; i++) {
        const id = ids[s.blocks[i] as number] as number;
        if (id === 0) continue;
        const wy = by + (i >> 8);
        const wz = chunk.cz * 16 + ((i >> 4) & 15);
        const wx = chunk.cx * 16 + (i & 15);
        if (wy < y0 || wy > y1 || wz < z0 || wz > z1 || wx < x0 || wx > x1) continue;
        data[wx - x0 + sx * (wz - z0 + sz * (wy - y0))] = id;
      }
    }
    for (const be of chunk.blockEntities) {
      const x = getNumber(be, 'x');
      const y = getNumber(be, 'y');
      const z = getNumber(be, 'z');
      if (x === undefined || y === undefined || z === undefined) continue;
      if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue;
      const inner = { ...be };
      for (const k of ['x', 'y', 'z', 'id', 'keepPacked']) delete inner[k];
      blockEntities.push({
        id: blockEntityId(getString(be, 'id') ?? ''),
        pos: [x - x0, y - y0, z - z0],
        data: compoundToJson(inner),
      });
    }
  }

  const centerCol = cxw - x0 + sx * (czw - z0);
  const centerGround = groundCol[centerCol] ?? -100000;
  const originY =
    options.center.length === 3
      ? Math.floor(options.center[1] as number)
      : (centerGround > -100000 ? centerGround : median(grounds)) + 1;

  const version = versionForDataVersion(maxDataVersion || null);
  const warnings: string[] = [];
  if (missing)
    warnings.push(
      `${missing} chunk(s) in the area were never generated or saved and read as empty air: walk there in the game first, or pick a smaller radius.`,
    );
  if (incomplete)
    warnings.push(
      `${incomplete} chunk(s) at the edge are not fully generated (no trees or structures yet).`,
    );
  if (unreadable) warnings.push(`${unreadable} chunk(s) could not be read and were left as air.`);
  if (unknownIds.size)
    warnings.push(
      `Unknown (modded?) block ids read as air: ${[...unknownIds].slice(0, 10).join(', ')}.`,
    );
  if (minDataVersion !== maxDataVersion && minDataVersion !== Infinity)
    warnings.push(
      'Some chunks were last saved by an older Minecraft version; the game upgrades them when you walk there.',
    );
  return {
    version: version.id,
    dataVersion: maxDataVersion || null,
    worldMin: [x0, y0, z0],
    size: [sx, sy, sz],
    palette,
    data,
    blockEntities,
    origin: [cxw, originY, czw],
    writable: !missing && !incomplete && !oldFormat && !unreadable,
    warnings,
  };
}

/** A schematic as the site: its own coordinates, origin above the ground at its centre. */
export function siteFromSchematic(v: ImportedVolume): SiteVolume {
  const [sx, sy, sz] = v.size;
  const heights = columnHeights(v.palette, v.data, v.size);
  const cx = Math.floor(sx / 2);
  const cz = Math.floor(sz / 2);
  const centerGround = heights.ground[cx + sx * cz] ?? -1;
  const grounds = [...heights.ground].filter((g) => g >= 0);
  const groundY = centerGround >= 0 ? centerGround : grounds.length ? median(grounds) : -1;
  const worldMin: Vec3 = v.worldOrigin ?? [0, 0, 0];
  const version = v.dataVersion
    ? versionForDataVersion(v.dataVersion)
    : versionForDataVersion(v.format === 'mcedit' ? 1343 : null);
  const warnings = [...v.warnings];
  if (!v.worldOrigin)
    warnings.push(
      'The file does not say where it was copied from: coordinates are relative to its corner.',
    );
  return {
    version: version.id,
    dataVersion: v.dataVersion,
    worldMin,
    size: [sx, sy, sz],
    palette: v.palette,
    data: v.data,
    blockEntities: v.blockEntities,
    origin: [worldMin[0] + cx, worldMin[1] + groundY + 1, worldMin[2] + cz],
    writable: false,
    warnings,
  };
}
