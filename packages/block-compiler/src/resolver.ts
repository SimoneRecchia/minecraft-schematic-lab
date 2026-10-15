import type { BlockCatalog } from '@minecraft-schematic-lab/catalog';
import type { PaletteEntry as SpecPaletteEntry } from '@minecraft-schematic-lab/build-spec';
import { hash3, hashString, UniformNoise } from './noise';
import type { InternalPalette } from './palette';

/** Where a block comes from: a fixed palette id, or a per-position choice (mixes, gradients). */
export interface BlockSource {
  /** >= 0: constant palette id; -1: use pick(); -2: nothing (unresolved). */
  readonly id: number;
  pick?(x: number, y: number, z: number): number;
}

export const SKIP: BlockSource = { id: -2 };

export function sourceAt(src: BlockSource, x: number, y: number, z: number): number {
  return src.id >= 0
    ? src.id
    : src.id === -1
      ? (src.pick as (x: number, y: number, z: number) => number)(x, y, z)
      : -2;
}

type Props = Record<string, string>;

const REF_RE = /^\s*([^[\]]+?)\s*(?:\[([^\]]*)\])?\s*$/;

function splitRef(ref: string): { key: string; props: Props } | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const props: Props = {};
  for (const pair of (m[2] ?? '').split(',')) {
    const p = pair.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq <= 0) return null;
    props[p.slice(0, eq).trim().toLowerCase()] = p
      .slice(eq + 1)
      .trim()
      .toLowerCase();
  }
  return { key: (m[1] as string).trim(), props };
}

function propsString(props: Props): string {
  const keys = Object.keys(props);
  if (keys.length === 0) return '';
  return `[${keys.map((k) => `${k}=${props[k]}`).join(',')}]`;
}

/**
 * Turns block references (palette keys, block states, both with optional [props]) into palette
 * ids, validating every block against the target version's catalog. "Strict" props were written
 * by the author and must be valid; "soft" props come from operations (stair facing, log axis…)
 * and only apply when the block actually has that property.
 */
export class BlockResolver {
  private readonly cache = new Map<string, BlockSource>();
  private readonly noise = new Map<number, UniformNoise>();
  readonly errors: string[] = [];
  readonly notes = new Set<string>();

  constructor(
    private readonly catalog: BlockCatalog,
    private readonly palette: InternalPalette,
    private readonly specPalette: Record<string, SpecPaletteEntry>,
    private readonly seed: number,
  ) {}

  source(ref: string, where: string, soft?: Props): BlockSource {
    const key = soft ? `${ref}|${JSON.stringify(soft)}` : ref;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const src = this.resolve(ref, {}, soft ?? {}, where, 0);
    this.cache.set(key, src);
    return src;
  }

  /** Every concrete block name a reference can produce (for masks and replace targets). */
  namesOf(ref: string, where: string, depth = 0): { names: string[]; states: string[] } {
    const parts = splitRef(ref);
    if (!parts) {
      this.fail(where, `"${ref}" is not a valid block reference.`);
      return { names: [], states: [] };
    }
    const entry = this.lookup(parts.key);
    if (entry !== undefined && depth < 8) {
      const refs =
        typeof entry === 'string'
          ? [entry]
          : 'mix' in entry
            ? Object.keys(entry.mix)
            : entry.gradient.blocks;
      const out = { names: [] as string[], states: [] as string[] };
      for (const r of refs) {
        const sub = this.namesOf(r, where, depth + 1);
        out.names.push(...sub.names);
        out.states.push(...sub.states);
      }
      return out;
    }
    const name = parts.key.replace(/^minecraft:/, '').toLowerCase();
    const resolved = this.catalog.resolveName(name);
    if (!resolved) {
      const r = this.catalog.normalize(name);
      this.fail(where, r.ok ? `Unknown block "${name}".` : r.error);
      return { names: [], states: [] };
    }
    if (Object.keys(parts.props).length === 0) return { names: [resolved], states: [] };
    const r = this.catalog.normalize(`${resolved}${propsString(parts.props)}`);
    if (!r.ok) {
      this.fail(where, r.error);
      return { names: [], states: [] };
    }
    return { names: [], states: [r.state] };
  }

  /** Palette entry for a key; "minecraft:…" always means the block itself. */
  private lookup(key: string): SpecPaletteEntry | undefined {
    if (key.includes(':')) return undefined;
    return this.specPalette[key] ?? this.specPalette[key.toLowerCase()];
  }

  private fail(where: string, message: string): void {
    const line = where ? `${where}: ${message}` : message;
    if (!this.errors.includes(line)) this.errors.push(line);
  }

  private noiseFor(seed: number): UniformNoise {
    let n = this.noise.get(seed);
    if (!n) {
      n = new UniformNoise(seed);
      this.noise.set(seed, n);
    }
    return n;
  }

  private resolve(
    ref: string,
    strict: Props,
    soft: Props,
    where: string,
    depth: number,
  ): BlockSource {
    if (depth > 8) {
      this.fail(where, `palette reference "${ref}" is circular or too deeply nested.`);
      return SKIP;
    }
    const parts = splitRef(ref);
    if (!parts) {
      this.fail(
        where,
        `"${ref}" is not a valid block reference (expected name or name[prop=value]).`,
      );
      return SKIP;
    }
    // Outer (more specific) properties win over the referenced entry's own.
    const merged: Props = { ...parts.props, ...strict };
    const entry = this.lookup(parts.key);
    if (entry !== undefined) {
      const ctx = `${where}${where ? ' ' : ''}(palette "${parts.key}")`;
      if (typeof entry === 'string') return this.resolve(entry, merged, soft, ctx, depth + 1);
      if ('mix' in entry) return this.mix(parts.key, entry, merged, soft, ctx, depth);
      return this.gradient(parts.key, entry, merged, soft, ctx, depth);
    }
    return this.block(parts.key, merged, soft, where);
  }

  private block(rawName: string, strict: Props, soft: Props, where: string): BlockSource {
    const name = rawName.replace(/^minecraft:/, '').toLowerCase();
    if (name === 'air' || name === 'cave_air' || name === 'void_air') return { id: 0 };
    const resolvedName = this.catalog.resolveName(name) ?? name;
    const props: Props = { ...strict };
    for (const [k, v] of Object.entries(soft)) {
      if (k in props) continue;
      if (this.catalog.propValues(resolvedName, k)?.includes(v)) props[k] = v;
    }
    if (resolvedName.endsWith('_leaves') && !('persistent' in props)) {
      if (this.catalog.propValues(resolvedName, 'persistent')) props.persistent = 'true';
    }
    const r = this.catalog.normalize(`${name}${propsString(props)}`);
    if (!r.ok) {
      this.fail(where, r.error);
      return SKIP;
    }
    if (r.renamedFrom) {
      this.notes.add(
        `"${r.renamedFrom}" is called "${r.name}" in ${this.catalog.version.id}; used that.`,
      );
    }
    const id = this.palette.add(r.name, r.props, Object.keys(strict));
    return { id };
  }

  private mix(
    key: string,
    entry: { mix: Record<string, number>; scale?: number; seed?: number },
    strict: Props,
    soft: Props,
    where: string,
    depth: number,
  ): BlockSource {
    const members = Object.entries(entry.mix).map(([r, w]) => ({
      src: this.resolve(r, strict, soft, where, depth + 1),
      w,
    }));
    const total = members.reduce((s, m) => s + m.w, 0);
    const cumulative: number[] = [];
    let acc = 0;
    for (const m of members) {
      acc += m.w / total;
      cumulative.push(acc);
    }
    const sources = members.map((m) => m.src);
    const seed = (entry.seed ?? this.seed) ^ hashString(key);
    const scale = entry.scale ?? 1;
    const noise = scale > 1 ? this.noiseFor(seed) : null;
    return {
      id: -1,
      pick: (x, y, z) => {
        const t = noise ? noise.at(x, y, z, scale) : hash3(x, y, z, seed);
        let i = 0;
        while (i < cumulative.length - 1 && t >= (cumulative[i] as number)) i++;
        const s = sources[i] as BlockSource;
        return s.id >= 0
          ? s.id
          : s.id === -1
            ? (s.pick as (a: number, b: number, c: number) => number)(x, y, z)
            : -2;
      },
    };
  }

  private gradient(
    key: string,
    entry: {
      gradient: {
        axis: 'x' | 'y' | 'z';
        from: number;
        to: number;
        blocks: string[];
        jitter?: number;
      };
    },
    strict: Props,
    soft: Props,
    where: string,
    depth: number,
  ): BlockSource {
    const g = entry.gradient;
    const sources = g.blocks.map((r) => this.resolve(r, strict, soft, where, depth + 1));
    const n = sources.length;
    const span = g.to - g.from || 1;
    const jitter = g.jitter ?? 0.35;
    const seed = this.seed ^ hashString(key);
    return {
      id: -1,
      pick: (x, y, z) => {
        const c = g.axis === 'x' ? x : g.axis === 'y' ? y : z;
        let t = (c - g.from) / span;
        if (jitter > 0) t += ((hash3(x, y, z, seed) - 0.5) * 2 * jitter) / n;
        const i = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
        const s = sources[i] as BlockSource;
        return s.id >= 0
          ? s.id
          : s.id === -1
            ? (s.pick as (a: number, b: number, c: number) => number)(x, y, z)
            : -2;
      },
    };
  }
}
