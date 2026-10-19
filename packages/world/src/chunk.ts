import { catalogData } from '@minecraft-schematic-lab/catalog';
import {
  canonicalFromString,
  canonicalState,
  compound,
  getCompound,
  getCompounds,
  getList,
  getNumber,
  getString,
  jsonToTag,
  list,
  readNbt,
  str,
  writeNbt,
  type Compound,
  type Tag,
} from '@minecraft-schematic-lab/formats';

/**
 * Chunk NBT layouts:
 * - flat (1.18+, DataVersion ≥ 2844): root `sections[].block_states {palette, data}`;
 * - level (1.13–1.17): `Level.Sections[] {Palette, BlockStates}`;
 * - legacy (1.8–1.12): `Level.Sections[] {Blocks, Data, Add}` with numeric ids.
 */
export type ChunkFormat = 'flat' | 'level' | 'legacy';

export const AIR = 'minecraft:air';
/** Snapshot 20w17a (1.16): packed indices stopped spanning two longs. */
const NO_SPAN_DATA_VERSION = 2529;
/** 1.14: chunks carry `isLightOn`, so the game relights a chunk we mark unlit. */
export const MIN_WRITE_DATA_VERSION = 1952;

export interface Section {
  /** Section index: blocks y = 16·y … 16·y + 15. */
  y: number;
  palette: string[];
  /** 4096 palette indices, y·256 + z·16 + x within the section. */
  blocks: Uint16Array;
}

export interface Chunk {
  cx: number;
  cz: number;
  /** 0 for 1.8, which had no DataVersion. */
  dataVersion: number;
  format: ChunkFormat;
  /** True when generation finished (features, trees, structures). */
  complete: boolean;
  sections: Map<number, Section>;
  /** Block entities as stored (absolute x, y, z). */
  blockEntities: Compound[];
  /** The whole chunk NBT, kept so it can be written back. */
  rootName: string;
  root: Compound;
  /** Legacy numeric ids with no flattened name (left as air). */
  unknownIds: number[];
}

// ---------------------------------------------------------------- bit packing

/** Palette indices packed LSB-first into longs (words = [lo, hi] per long). */
export function unpackIndices(
  words: Uint32Array,
  bits: number,
  count: number,
  spanning: boolean,
): Uint16Array {
  const out = new Uint16Array(count);
  if (bits <= 0) return out;
  const mask = (1 << bits) - 1;
  const perLong = Math.floor(64 / bits);
  for (let i = 0; i < count; i++) {
    const g = spanning ? i * bits : Math.floor(i / perLong) * 64 + (i % perLong) * bits;
    const w = g >>> 5;
    const o = g & 31;
    let v = (words[w] ?? 0) >>> o;
    if (o + bits > 32) v |= (words[w + 1] ?? 0) << (32 - o);
    out[i] = v & mask;
  }
  return out;
}

export function packIndices(values: Uint16Array, bits: number, spanning: boolean): Uint32Array {
  const perLong = Math.floor(64 / bits);
  const longs = spanning
    ? Math.ceil((values.length * bits) / 64)
    : Math.ceil(values.length / perLong);
  const words = new Uint32Array(longs * 2);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (v === 0) continue;
    const g = spanning ? i * bits : Math.floor(i / perLong) * 64 + (i % perLong) * bits;
    const w = g >>> 5;
    const o = g & 31;
    words[w] = ((words[w] as number) | (v << o)) >>> 0;
    if (o + bits > 32) words[w + 1] = ((words[w + 1] as number) | (v >>> (32 - o))) >>> 0;
  }
  return words;
}

/** Bits per block-state index, as the game serializes them (4 at least). */
export function stateBits(paletteSize: number): number {
  return Math.max(4, Math.ceil(Math.log2(Math.max(2, paletteSize))));
}

// ---------------------------------------------------------------- decoding

function statesOf(paletteTags: Tag[]): string[] {
  return paletteTags.map((t) => {
    if (t.t !== 'compound') return AIR;
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(getCompound(t.v, 'Properties') ?? {}))
      if (v.t === 'string') props[k] = v.v;
    const name = getString(t.v, 'Name') ?? AIR;
    return /^minecraft:(cave_|void_)?air$/.test(name) ? AIR : canonicalState(name, props);
  });
}

function nibble(arr: Int8Array | Uint8Array | null, i: number): number {
  if (!arr) return 0;
  return ((arr[i >> 1] as number) >> ((i & 1) * 4)) & 0x0f;
}

let legacyStates: Map<number, string> | null = null;

function legacyState(id: number, meta: number): string | null {
  if (!legacyStates) {
    legacyStates = new Map();
    for (const [key, state] of Object.entries(catalogData.legacyBlocks)) {
      const [i, m] = key.split(':').map(Number) as [number, number];
      legacyStates.set(i * 16 + m, canonicalFromString(state));
    }
  }
  return legacyStates.get(id * 16 + meta) ?? legacyStates.get(id * 16) ?? null;
}

const COMPLETE = new Set(['full', 'fullchunk', 'postprocessed']);

/** Parse a chunk's NBT (uncompressed bytes from the region file). */
export function decodeChunk(nbt: Buffer): Chunk {
  const { name, root } = readNbt(nbt);
  const dataVersion = getNumber(root, 'DataVersion') ?? 0;
  const level = getCompound(root, 'Level');
  const sectionsRoot = level ?? root;
  const sectionTags = getCompounds(sectionsRoot, level ? 'Sections' : 'sections');
  const isLegacy = !!level && sectionTags.some((s) => s.Blocks?.t === 'byteArray');
  const format: ChunkFormat = level ? (isLegacy ? 'legacy' : 'level') : 'flat';
  const statusRaw = (getString(sectionsRoot, 'Status') ?? '').replace(/^minecraft:/, '');
  const complete =
    format === 'legacy'
      ? getNumber(level, 'TerrainPopulated') === 1
      : COMPLETE.has(statusRaw) || (statusRaw === '' && format !== 'flat');
  const sections = new Map<number, Section>();
  const unknown = new Set<number>();
  const spanning = dataVersion < NO_SPAN_DATA_VERSION;

  for (const s of sectionTags) {
    const y = getNumber(s, 'Y');
    if (y === undefined) continue;
    if (format === 'flat') {
      const bs = getCompound(s, 'block_states');
      if (!bs) continue;
      const palette = statesOf(getList(bs, 'palette'));
      if (!palette.length) continue;
      const data = bs.data?.t === 'longArray' ? bs.data.words : null;
      const blocks =
        palette.length === 1 || !data
          ? new Uint16Array(4096)
          : unpackIndices(data, stateBits(palette.length), 4096, false);
      sections.set(y, { y, palette, blocks });
    } else if (format === 'level') {
      const paletteTags = getList(s, 'Palette');
      if (!paletteTags.length) continue;
      const palette = statesOf(paletteTags);
      const data = s.BlockStates?.t === 'longArray' ? s.BlockStates.words : null;
      const blocks = data
        ? unpackIndices(data, stateBits(palette.length), 4096, spanning)
        : new Uint16Array(4096);
      sections.set(y, { y, palette, blocks });
    } else {
      const ids = s.Blocks?.t === 'byteArray' ? s.Blocks.v : null;
      if (!ids) continue;
      const meta = s.Data?.t === 'byteArray' ? s.Data.v : null;
      const add = s.Add?.t === 'byteArray' ? s.Add.v : null;
      const palette: string[] = [AIR];
      const index = new Map<string, number>([[AIR, 0]]);
      const blocks = new Uint16Array(4096);
      for (let i = 0; i < 4096; i++) {
        const id = ((ids[i] as number) & 0xff) | (nibble(add, i) << 8);
        if (id === 0) continue;
        const state = legacyState(id, nibble(meta, i));
        if (!state) {
          unknown.add(id);
          continue;
        }
        let p = index.get(state);
        if (p === undefined) {
          p = palette.length;
          palette.push(state);
          index.set(state, p);
        }
        blocks[i] = p;
      }
      sections.set(y, { y, palette, blocks });
    }
  }

  const cx = getNumber(sectionsRoot, 'xPos') ?? 0;
  const cz = getNumber(sectionsRoot, 'zPos') ?? 0;
  const blockEntities = getCompounds(sectionsRoot, level ? 'TileEntities' : 'block_entities');
  return {
    cx,
    cz,
    dataVersion,
    format,
    complete,
    sections,
    blockEntities,
    rootName: name,
    root,
    unknownIds: [...unknown],
  };
}

/** The state at chunk-local x, z (0–15) and absolute y. */
export function stateIn(chunk: Chunk, x: number, y: number, z: number): string {
  const s = chunk.sections.get(y >> 4);
  if (!s) return AIR;
  return s.palette[s.blocks[((y & 15) << 8) | (z << 4) | x] as number] ?? AIR;
}

// ---------------------------------------------------------------- writing changes

export interface BlockChange {
  /** Absolute world position. */
  x: number;
  y: number;
  z: number;
  /** Canonical block state ("minecraft:oak_stairs[facing=east,half=bottom]"). */
  state: string;
  /** Block entity data for the new block (JSON NBT as the BuildSpec writes it). */
  nbt?: Record<string, unknown> | null;
}

function stateTag(state: string): Tag {
  const br = state.indexOf('[');
  const name = br < 0 ? state : state.slice(0, br);
  if (br < 0) return compound({ Name: str(name) });
  const props: Record<string, Tag> = {};
  for (const pair of state.slice(br + 1, -1).split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) props[pair.slice(0, eq)] = str(pair.slice(eq + 1));
  }
  return compound({ Name: str(name), Properties: compound(props) });
}

function posOf(c: Compound): string | null {
  const x = getNumber(c, 'x');
  const y = getNumber(c, 'y');
  const z = getNumber(c, 'z');
  return x === undefined || y === undefined || z === undefined ? null : `${x},${y},${z}`;
}

/**
 * Write block changes into a decoded chunk (1.14+ layouts) and return the new NBT bytes.
 * The chunk is marked unlit with empty heightmaps, so the game recomputes light and heights the
 * first time it loads it; block entities and scheduled ticks at changed positions are replaced.
 */
export function applyChanges(chunk: Chunk, changes: readonly BlockChange[]): Buffer {
  if (chunk.format === 'legacy' || chunk.dataVersion < MIN_WRITE_DATA_VERSION)
    throw new Error(
      'This part of the world was saved by Minecraft 1.13 or older: open it once in 1.14+ first.',
    );
  const flat = chunk.format === 'flat';
  const holder = flat ? chunk.root : (getCompound(chunk.root, 'Level') as Compound);
  const sectionKey = flat ? 'sections' : 'Sections';
  const sectionList = holder[sectionKey];
  const sectionTags: Compound[] =
    sectionList?.t === 'list'
      ? sectionList.v.flatMap((t) => (t.t === 'compound' ? [t.v] : []))
      : [];
  const tagByY = new Map<number, Compound>();
  for (const s of sectionTags) {
    const y = getNumber(s, 'Y');
    if (y !== undefined) tagByY.set(y, s);
  }

  const touched = new Set<number>();
  const changedPos = new Set<string>();
  const newEntities: Compound[] = [];
  for (const c of changes) {
    const sy = c.y >> 4;
    let sec = chunk.sections.get(sy);
    if (!sec) {
      sec = { y: sy, palette: [AIR], blocks: new Uint16Array(4096) };
      chunk.sections.set(sy, sec);
    }
    let p = sec.palette.indexOf(c.state);
    if (p < 0) p = sec.palette.push(c.state) - 1;
    sec.blocks[((c.y & 15) << 8) | ((c.z & 15) << 4) | (c.x & 15)] = p;
    touched.add(sy);
    changedPos.add(`${c.x},${c.y},${c.z}`);
    if (c.nbt) {
      const data = jsonToTag(c.nbt);
      const id = c.state.replace(/\[.*$/, '');
      newEntities.push({
        ...(data.t === 'compound' ? data.v : {}),
        id: str(typeof c.nbt.id === 'string' ? c.nbt.id : id),
        x: { t: 'int', v: c.x },
        y: { t: 'int', v: c.y },
        z: { t: 'int', v: c.z },
        keepPacked: { t: 'byte', v: 0 },
      });
    }
  }

  const spanning = chunk.dataVersion < NO_SPAN_DATA_VERSION;
  for (const sy of touched) {
    const sec = chunk.sections.get(sy) as Section;
    // Compact the palette to the states still in use (air first when present).
    const used = new Uint8Array(sec.palette.length);
    for (let i = 0; i < 4096; i++) used[sec.blocks[i] as number] = 1;
    const remap = new Uint16Array(sec.palette.length);
    const palette: string[] = [];
    for (let i = 0; i < sec.palette.length; i++) {
      if (!used[i]) continue;
      remap[i] = palette.length;
      palette.push(sec.palette[i] as string);
    }
    const blocks = new Uint16Array(4096);
    for (let i = 0; i < 4096; i++) blocks[i] = remap[sec.blocks[i] as number] as number;
    sec.palette = palette;
    sec.blocks = blocks;

    let tag = tagByY.get(sy);
    if (!tag) {
      tag = { Y: { t: 'byte', v: sy } };
      if (flat) {
        const near = [...tagByY.entries()].sort(
          (a, b) => Math.abs(a[0] - sy) - Math.abs(b[0] - sy),
        )[0];
        const biomes = near ? getCompound(near[1], 'biomes') : undefined;
        tag.biomes = compound(biomes ?? { palette: list('string', [str('minecraft:plains')]) });
      }
      tagByY.set(sy, tag);
      sectionTags.push(tag);
    }
    const paletteTag = list('compound', palette.map(stateTag));
    const words = packIndices(blocks, stateBits(palette.length), flat ? false : spanning);
    if (flat) {
      tag.block_states = compound(
        palette.length === 1
          ? { palette: paletteTag }
          : { palette: paletteTag, data: { t: 'longArray', words } },
      );
    } else {
      tag.Palette = paletteTag;
      tag.BlockStates = { t: 'longArray', words };
    }
    delete tag.BlockLight;
    delete tag.SkyLight;
  }
  sectionTags.sort((a, b) => (getNumber(a, 'Y') ?? 0) - (getNumber(b, 'Y') ?? 0));
  holder[sectionKey] = list(
    'compound',
    sectionTags.map((v) => compound(v)),
  );

  // Block entities: drop the ones at changed positions, add the new ones.
  const beKey = flat ? 'block_entities' : 'TileEntities';
  const kept = getCompounds(holder, beKey).filter((be) => {
    const p = posOf(be);
    return !p || !changedPos.has(p);
  });
  holder[beKey] = list(
    'compound',
    [...kept, ...newEntities].map((v) => compound(v)),
  );

  // Scheduled ticks at changed positions belong to the old blocks.
  for (const key of flat ? ['block_ticks', 'fluid_ticks'] : ['TileTicks', 'LiquidTicks']) {
    if (holder[key]?.t !== 'list') continue;
    const ticks = getCompounds(holder, key).filter((t) => {
      const p = posOf(t);
      return !p || !changedPos.has(p);
    });
    holder[key] = list(
      'compound',
      ticks.map((v) => compound(v)),
    );
  }

  holder.isLightOn = { t: 'byte', v: 0 };
  holder.Heightmaps = compound({});
  return writeNbt(chunk.rootName, chunk.root);
}
