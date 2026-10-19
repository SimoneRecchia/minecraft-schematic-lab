import {
  terrainClass,
  type BlockCatalog,
  type TerrainClass,
} from '@minecraft-schematic-lab/catalog';
import type {
  BuildSpec,
  Component,
  PaletteEntry as SpecPaletteEntry,
} from '@minecraft-schematic-lab/build-spec';
import type { InternalPalette } from './palette';
import { SKIP, type BlockResolver, type BlockSource } from './resolver';
import { SparseVolume } from './SparseVolume';
export { CompileLimitError } from './SparseVolume';
import { Transform } from './transform';
import { hashString } from './noise';

export interface Mask {
  kind: 'air' | 'solid' | 'list';
  names?: Set<string>;
  states?: Set<string>;
}

/** Runs a `script` operation's code against the compile API. */
export type ScriptRunner = (code: string, api: Record<string, unknown>, timeoutMs: number) => void;

/**
 * State shared by every operation while compiling. Operations work in local coordinates;
 * `put` applies the current group transform, mask and provenance.
 */
export class CompileContext {
  transform: Transform = Transform.IDENTITY;
  mask: Mask | null = null;
  prov = 0;
  where = '';
  readonly provTable: string[] = [''];
  readonly warnings = new Set<string>();
  readonly blockEntities = new Map<
    string,
    { x: number; y: number; z: number; data: Record<string, unknown> }
  >();
  readonly seed: number;
  /** Provenance ids of operations that shape the ground (terrain, flatten). */
  readonly groundProvs = new Set<number>();
  /** Spec bounds of the site the build stands on, when there is one. */
  siteBounds: { min: [number, number, number]; max: [number, number, number] } | null = null;
  /** Block entities of the site (kept while the block they belong to stays). */
  readonly siteEntities = new Map<
    string,
    { x: number; y: number; z: number; name: string; data: Record<string, unknown> }
  >();
  private outOfRange = 0;
  private readonly classes: TerrainClass[] = [];
  private readonly columnCache = new Map<number, { writes: number; ground: number | null }>();

  constructor(
    readonly spec: BuildSpec,
    readonly catalog: BlockCatalog,
    readonly volume: SparseVolume,
    readonly palette: InternalPalette,
    readonly resolver: BlockResolver,
    readonly scriptRunner: ScriptRunner | undefined,
    /** Spec palette plus synthetic entries (derived slab/stairs mixes). Shared with the resolver. */
    readonly paletteDefs: Record<string, SpecPaletteEntry>,
    readonly components: Record<string, Component>,
  ) {
    this.seed = spec.seed ?? hashString(spec.name) % 100000;
  }

  error(message: string): void {
    this.resolver.errors.push(this.where ? `${this.where}: ${message}` : message);
  }

  warn(message: string): void {
    this.warnings.add(this.where ? `${this.where}: ${message}` : message);
  }

  source(ref: string | undefined, soft?: Record<string, string>): BlockSource {
    if (!ref) return SKIP;
    return this.resolver.source(ref, this.where, soft);
  }

  /** Make a provenance entry for the current operation path. */
  enterProv(label: string): number {
    if (this.provTable.length >= 65535) return 65535;
    this.provTable.push(label);
    this.prov = this.provTable.length - 1;
    return this.prov;
  }

  toWorld(x: number, y: number, z: number): [number, number, number] {
    const t = this.transform;
    return [t.a * x + t.b * z + t.tx, y + t.ty, t.c * x + t.d * z + t.tz];
  }

  /** Read the block id at a local position. */
  get(x: number, y: number, z: number): number {
    const t = this.transform;
    return this.volume.get(t.a * x + t.b * z + t.tx, y + t.ty, t.c * x + t.d * z + t.tz);
  }

  put(x: number, y: number, z: number, src: BlockSource): void {
    const t = this.transform;
    const wx = t.a * x + t.b * z + t.tx;
    const wy = y + t.ty;
    const wz = t.c * x + t.d * z + t.tz;
    const id =
      src.id >= 0
        ? src.id
        : src.id === -1
          ? (src.pick as (a: number, b: number, c: number) => number)(wx, wy, wz)
          : -2;
    if (id < 0) return;
    this.putWorld(wx, wy, wz, id === 0 ? 0 : this.palette.transform(id, t));
  }

  /** Write an already-transformed palette id at a world position (honours the mask). */
  putWorld(wx: number, wy: number, wz: number, id: number): void {
    if (!SparseVolume.inRange(wx, wy, wz)) {
      this.outOfRange++;
      return;
    }
    const mask = this.mask;
    if (mask) {
      const existing = this.volume.get(wx, wy, wz);
      if (mask.kind === 'air') {
        if (existing !== 0) return;
      } else if (mask.kind === 'solid') {
        if (existing === 0) return;
      } else {
        if (existing === 0) return;
        const e = this.palette.get(existing);
        if (!mask.names?.has(e.name) && !mask.states?.has(e.state)) return;
      }
    }
    this.volume.set(wx, wy, wz, id, this.prov);
  }

  /** Write a block source at a world position (no transform; honours the mask). */
  putWorldSource(wx: number, wy: number, wz: number, src: BlockSource): void {
    const id =
      src.id >= 0
        ? src.id
        : src.id === -1
          ? (src.pick as (a: number, b: number, c: number) => number)(wx, wy, wz)
          : -2;
    if (id >= 0) this.putWorld(wx, wy, wz, id);
  }

  classOf(id: number): TerrainClass {
    let c = this.classes[id];
    if (c === undefined) {
      c = terrainClass(this.palette.get(id).name);
      this.classes[id] = c;
    }
    return c;
  }

  /** Top and bottom y worth scanning in a column. */
  private scanRange(): [number, number] | null {
    if (this.siteBounds) return [this.siteBounds.max[1], this.siteBounds.min[1]];
    const v = this.volume;
    if (v.maxChunkY === -Infinity) return null;
    return [v.maxChunkY * 16 + 15, v.minChunkY * 16];
  }

  /**
   * World y of the topmost ground block of a column: the site's natural ground and what terrain
   * or flatten operations made. Buildings, trees, plants and water are not ground.
   */
  groundAt(wx: number, wz: number): number | null {
    const key = (wx + 32768) * 65536 + (wz + 32768);
    const hit = this.columnCache.get(key);
    if (hit && hit.writes === this.volume.writes) return hit.ground;
    const range = this.scanRange();
    let ground: number | null = null;
    if (range) {
      for (let y = range[0]; y >= range[1]; y--) {
        const id = this.volume.get(wx, y, wz);
        if (id === 0 || this.classOf(id) !== 'ground') continue;
        const p = this.volume.getProv(wx, y, wz);
        if (p === 0 || this.groundProvs.has(p)) {
          ground = y;
          break;
        }
      }
    }
    this.columnCache.set(key, { writes: this.volume.writes, ground });
    return ground;
  }

  /** World y of the topmost block of any kind in a column. */
  surfaceAt(wx: number, wz: number): number | null {
    const range = this.scanRange();
    if (!range) return null;
    for (let y = range[0]; y >= range[1]; y--) if (this.volume.get(wx, y, wz) !== 0) return y;
    return null;
  }

  /** World y of the water (or lava) surface above the ground of a column, if any. */
  waterAt(wx: number, wz: number): number | null {
    const range = this.scanRange();
    if (!range) return null;
    const ground = this.groundAt(wx, wz) ?? range[1] - 1;
    for (let y = range[0]; y > ground; y--) {
      const id = this.volume.get(wx, y, wz);
      if (id !== 0 && this.classOf(id) === 'liquid') return y;
    }
    return null;
  }

  /** Run fn with an extra local transform (child -> current). */
  withTransform(local: Transform, fn: () => void): void {
    const prev = this.transform;
    this.transform = prev.compose(local);
    try {
      fn();
    } finally {
      this.transform = prev;
    }
  }

  get outOfRangeWrites(): number {
    return this.outOfRange;
  }

  parseMask(mask: BuildSpec['operations'][number]['mask']): Mask | null {
    if (!mask) return null;
    if (mask === 'air' || mask === 'solid') return { kind: mask };
    const names = new Set<string>();
    const states = new Set<string>();
    for (const ref of mask) {
      const r = this.resolver.namesOf(ref, this.where);
      r.names.forEach((n) => names.add(n));
      r.states.forEach((s) => states.add(s));
    }
    return { kind: 'list', names, states };
  }
}
