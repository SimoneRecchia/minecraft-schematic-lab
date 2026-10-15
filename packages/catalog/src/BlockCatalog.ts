import { catalogData, type PropSpec } from './data';
export type { PropSpec };
import { parseBlockState, stringifyState } from './blockState';
import { compareVersions, listVersions, resolveVersion, type VersionInfo } from './versions';

export interface PropDef {
  name: string;
  values: string[];
  default: string;
}

export type NormalizeResult =
  | {
      ok: true;
      /** Canonical full state: every property present, sorted. */
      state: string;
      name: string;
      props: Record<string, string>;
      /** Properties the input set explicitly (others came from defaults). */
      explicit: string[];
      /** Set when the input used another version's name for the same block. */
      renamedFrom?: string;
    }
  | { ok: false; error: string };

/**
 * Same block, different name across versions. Applied only when the target version lacks the
 * written name but has the alias, so specs can use modern names for old targets and vice versa.
 */
const ALIASES: Record<string, string[]> = {
  dirt_path: ['grass_path'],
  grass_path: ['dirt_path'],
  short_grass: ['grass'],
  grass: ['short_grass'],
  oak_sign: ['sign'],
  sign: ['oak_sign'],
  oak_wall_sign: ['wall_sign'],
  wall_sign: ['oak_wall_sign'],
  iron_chain: ['chain'],
  chain: ['iron_chain'],
  smooth_stone_slab: ['stone_slab'],
};

const FULL_CUBES = new Set(catalogData.fullCubes);

/** Visually closest materials, for suggesting replacements in older versions. */
const MATERIAL_SUBSTITUTES: Record<string, string[]> = {
  deepslate: ['stone', 'cobblestone', 'andesite', 'polished_andesite'],
  cobbled: ['cobblestone'],
  tuff: ['andesite', 'stone'],
  calcite: ['diorite', 'quartz', 'white_concrete'],
  mud: ['brick', 'terracotta', 'granite'],
  packed: ['terracotta'],
  cherry: ['birch', 'jungle'],
  bamboo: ['birch', 'jungle', 'oak'],
  mangrove: ['jungle', 'dark_oak', 'acacia'],
  crimson: ['dark_oak', 'jungle'],
  warped: ['dark_prismarine', 'prismarine', 'spruce'],
  pale: ['birch'],
  blackstone: ['cobblestone', 'stone'],
  basalt: ['stone', 'andesite'],
  copper: ['terracotta', 'prismarine', 'brick'],
  oxidized: ['prismarine'],
  resin: ['brick', 'red_sandstone'],
  amethyst: ['purpur', 'magenta_concrete'],
  prismarine: ['stone', 'cobblestone'],
  purpur: ['quartz', 'sandstone'],
  quartz: ['smooth_stone', 'snow', 'white_wool'],
  concrete: ['wool', 'terracotta'],
  moss: ['mossy_cobblestone', 'grass', 'oak_leaves'],
  andesite: ['stone', 'cobblestone'],
  diorite: ['quartz', 'stone'],
  granite: ['brick', 'red_sandstone'],
  cinnabar: ['red_nether', 'brick', 'granite'],
  sulfur: ['sandstone', 'yellow_terracotta'],
};

let sinceCache: Map<string, string> | null = null;

/** First (oldest) supported release that has this block name. */
export function blockAddedIn(name: string): string | undefined {
  if (!sinceCache) {
    sinceCache = new Map();
    const oldestFirst = [...listVersions()].reverse();
    for (const v of oldestFirst) {
      for (const n of getCatalog(v).names()) {
        if (!sinceCache.has(n)) sinceCache.set(n, v.id);
      }
    }
  }
  return sinceCache.get(name);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

export class BlockCatalog {
  readonly version: VersionInfo;
  private readonly blocks = new Map<string, PropSpec[]>();
  private readonly cache = new Map<string, NormalizeResult>();

  constructor(version: VersionInfo) {
    this.version = version;
    const ds = catalogData.datasets[version.dataset];
    if (!ds) throw new Error(`No block data for Minecraft ${version.id}.`);
    for (let i = 0; i < ds.blocks.length; i += 2) {
      const name = catalogData.names[ds.blocks[i] as number] as string;
      this.blocks.set(name, catalogData.sigs[ds.blocks[i + 1] as number] ?? []);
    }
  }

  has(name: string): boolean {
    return this.blocks.has(name);
  }

  /**
   * Add a block the bundled data doesn't know yet (releases newer than minecraft-data), with
   * properties taken from the game's own resources. Existing blocks are left untouched.
   */
  augment(name: string, props: PropSpec[]): boolean {
    if (this.blocks.has(name)) return false;
    this.blocks.set(name, props);
    this.cache.clear();
    return true;
  }

  /** Signature of an existing block, to reuse for a new block of the same family. */
  propSpec(name: string): PropSpec[] | undefined {
    return this.blocks.get(name);
  }

  names(): string[] {
    return [...this.blocks.keys()];
  }

  get size(): number {
    return this.blocks.size;
  }

  props(name: string): PropDef[] | undefined {
    const spec = this.blocks.get(name);
    if (!spec) return undefined;
    return spec.map(([n, values, d]) => ({ name: n, values, default: values[d] as string }));
  }

  /** Allowed values of one property, or undefined if the block lacks it. */
  propValues(name: string, prop: string): string[] | undefined {
    const spec = this.blocks.get(name);
    return spec?.find((p) => p[0] === prop)?.[1];
  }

  defaultProps(name: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [n, values, d] of this.blocks.get(name) ?? []) out[n] = values[d] as string;
    return out;
  }

  displayName(name: string): string {
    return (
      catalogData.displayNames[name] ??
      name
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    );
  }

  /** Collision shape is a full cube (fences/walls/panes connect to it). */
  isFullCube(name: string): boolean {
    return FULL_CUBES.has(name);
  }

  /** Map a name to this version's name for the same block, if it differs. */
  resolveName(name: string): string | undefined {
    if (this.blocks.has(name)) return name;
    for (const alias of ALIASES[name] ?? []) if (this.blocks.has(alias)) return alias;
    return undefined;
  }

  /**
   * Alternatives for a block that is missing or misspelled: same shape in a similar material
   * (cherry_stairs → birch_stairs, deepslate_tiles → stone_bricks), the plain variant
   * (stripped_spruce_log → spruce_log), then names sharing words, then spelling.
   */
  suggest(name: string, limit = 4): string[] {
    const out: string[] = [];
    const add = (n: string) => {
      if (this.blocks.has(n) && !out.includes(n) && n !== name) out.push(n);
    };
    const words = name.split('_');
    for (let i = 0; i < words.length; i++) {
      for (const sub of MATERIAL_SUBSTITUTES[words[i] as string] ?? []) {
        const swapped = [...words.slice(0, i), ...sub.split('_'), ...words.slice(i + 1)].join('_');
        add(swapped);
        add(swapped.replace(/_tile_/, '_brick_'));
        add(swapped.replace(/_tiles?\b/, '_bricks'));
        add(swapped.replace(/_tiles?$/, ''));
        add(swapped.replace(/^polished_/, ''));
        add(swapped.replace(/_bricks?$/, ''));
      }
    }
    add(name.replace(/^(stripped|polished|chiseled|cut|smooth|cracked|mossy|waxed|infested)_/, ''));
    add(name.replace(/_tiles$/, '_bricks'));
    add(name.replace(/_bricks$/, 's'));
    if (out.length < limit) {
      const wordSet = new Set(words);
      const scored: [string, number][] = [];
      for (const n of this.blocks.keys()) {
        if (out.includes(n)) continue;
        const nw = n.split('_');
        const shared = nw.filter((w) => wordSet.has(w)).length;
        const lev = levenshtein(name, n) / Math.max(name.length, n.length);
        const score = lev - shared * 0.25 - (n.includes(name) ? 0.2 : 0);
        if (shared > 0 || lev < 0.35) scored.push([n, score]);
      }
      scored.sort((a, b) => a[1] - b[1]);
      for (const [n] of scored) {
        if (out.length >= limit) break;
        out.push(n);
      }
    }
    return out.slice(0, limit);
  }

  /** Validate and complete a block state string for this version. Memoized. */
  normalize(input: string): NormalizeResult {
    const cached = this.cache.get(input);
    if (cached) return cached;
    const result = this.normalizeUncached(input);
    this.cache.set(input, result);
    return result;
  }

  private normalizeUncached(input: string): NormalizeResult {
    const parsed = parseBlockState(input);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    if (parsed.namespace !== 'minecraft') {
      return { ok: false, error: `"${input}": only vanilla minecraft: blocks are supported.` };
    }
    const name = this.resolveName(parsed.name);
    if (!name) return { ok: false, error: this.unknownBlockMessage(parsed.name) };

    const spec = this.blocks.get(name) ?? [];
    const props: Record<string, string> = {};
    for (const [n, values, d] of spec) props[n] = values[d] as string;
    const explicit: string[] = [];
    for (const [key, value] of Object.entries(parsed.props)) {
      const def = spec.find((p) => p[0] === key);
      if (!def) {
        const known = spec.map((p) => p[0]).join(', ') || 'none';
        return {
          ok: false,
          error: `"${input}": ${name} has no property "${key}" in ${this.version.id} (properties: ${known}).`,
        };
      }
      if (!def[1].includes(value)) {
        return {
          ok: false,
          error: `"${input}": ${key}=${value} is invalid for ${name} (allowed: ${def[1].join(', ')}).`,
        };
      }
      props[key] = value;
      explicit.push(key);
    }
    return {
      ok: true,
      state: stringifyState(name, props),
      name,
      props,
      explicit,
      ...(name !== parsed.name ? { renamedFrom: parsed.name } : {}),
    };
  }

  private unknownBlockMessage(name: string): string {
    const since = blockAddedIn(name);
    if (since && compareVersions(since, this.version.id) > 0) {
      const alt = this.suggest(name, 3);
      return (
        `minecraft:${name} does not exist in ${this.version.id} (added in ${since}).` +
        (alt.length ? ` Closest blocks available in ${this.version.id}: ${alt.join(', ')}.` : '')
      );
    }
    if (since) {
      return `minecraft:${name} is not available in ${this.version.id}.`;
    }
    const alt = this.suggest(name);
    return (
      `Unknown block "minecraft:${name}".` + (alt.length ? ` Did you mean: ${alt.join(', ')}?` : '')
    );
  }

  /** Substring search over names (all words must match), shortest names first. */
  search(query: string, limit = 60): string[] {
    const words = query
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    const out = this.names().filter((n) => words.every((w) => n.includes(w)));
    out.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return out.slice(0, limit);
  }
}

const catalogs = new Map<string, BlockCatalog>();

export function getCatalog(version: string | VersionInfo): BlockCatalog {
  const info = typeof version === 'string' ? resolveVersion(version) : version;
  if (!info) throw new Error(`Unsupported Minecraft version "${String(version)}".`);
  let cat = catalogs.get(info.id);
  if (!cat) {
    cat = new BlockCatalog(info);
    catalogs.set(info.id, cat);
  }
  return cat;
}
