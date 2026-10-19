import { catalogData } from '@minecraft-schematic-lab/catalog';
import type { Tag } from './nbt';
import {
  compoundToJson,
  getCompound,
  getCompounds,
  getInts,
  getList,
  getNumber,
  getString,
  readNbt,
  type Compound,
} from './nbtRead';

/** A schematic read from a file, as a dense volume (index 0 of the palette is air). */
export interface ImportedVolume {
  format: 'sponge' | 'mcedit' | 'litematica' | 'structure';
  size: [number, number, number];
  palette: string[];
  /** Palette indices in YZX order (x fastest). */
  data: Uint16Array;
  blockEntities: { id: string; pos: [number, number, number]; data: Record<string, unknown> }[];
  dataVersion: number | null;
  /** World position of the volume's (0,0,0) where it was copied, when the file says. */
  worldOrigin: [number, number, number] | null;
  name: string | null;
  warnings: string[];
}

const AIR = 'minecraft:air';

/** "minecraft:oak_stairs[half=top,facing=north]" with properties sorted, namespace added. */
export function canonicalState(name: string, props?: Record<string, string>): string {
  const n = name.includes(':') ? name : `minecraft:${name}`;
  const keys = Object.keys(props ?? {}).sort();
  return keys.length ? `${n}[${keys.map((k) => `${k}=${props?.[k]}`).join(',')}]` : n;
}

/** Parse "name[k=v,…]" (as stored in Sponge palettes) into the canonical form. */
export function canonicalFromString(state: string): string {
  const br = state.indexOf('[');
  if (br < 0) return canonicalState(state);
  const props: Record<string, string> = {};
  for (const pair of state.slice(br + 1, state.lastIndexOf(']')).split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) props[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return canonicalState(state.slice(0, br), props);
}

function stateOfCompound(c: Compound): string {
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(getCompound(c, 'Properties') ?? {}))
    if (v.t === 'string') props[k] = v.v;
  return canonicalState(getString(c, 'Name') ?? AIR, props);
}

/** Varint-encoded palette indices (Sponge BlockData). */
function readVarints(bytes: Int8Array, count: number): Uint32Array {
  const out = new Uint32Array(count);
  let p = 0;
  for (let i = 0; i < count; i++) {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (p >= bytes.length) throw new Error('The block data ends too early.');
      const b = (bytes[p++] as number) & 0xff;
      v |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new Error('Malformed block data.');
    }
    out[i] = v;
  }
  return out;
}

/** Remap a palette so air is index 0, as BlockVolume expects. */
function withAirFirst(
  palette: string[],
  raw: ArrayLike<number>,
): { palette: string[]; data: Uint16Array } {
  const out = [AIR];
  const index = new Map<string, number>([[AIR, 0]]);
  const remap = palette.map((s) => {
    const st = /^minecraft:(cave_|void_)?air$/.test(s) ? AIR : s;
    let id = index.get(st);
    if (id === undefined) {
      id = out.length;
      out.push(st);
      index.set(st, id);
    }
    return id;
  });
  if (out.length > 65535) throw new Error('Too many different block states (over 65535).');
  const data = new Uint16Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = remap[raw[i] as number] ?? 0;
  return { palette: out, data };
}

function checkSize(x: number, y: number, z: number): void {
  if (x <= 0 || y <= 0 || z <= 0) throw new Error('The schematic is empty.');
  if (x * y * z > 64_000_000)
    throw new Error(`The schematic is too big to open (${x}×${y}×${z}, over 64 million blocks).`);
}

// ---------------------------------------------------------------- Sponge (.schem)

function readSponge(root: Compound, name: string | null): ImportedVolume {
  const nested = getCompound(root, 'Schematic');
  const s = nested ?? root;
  const version = getNumber(s, 'Version') ?? 1;
  const w = getNumber(s, 'Width') ?? 0;
  const h = getNumber(s, 'Height') ?? 0;
  const l = getNumber(s, 'Length') ?? 0;
  const sx = w & 0xffff;
  const sy = h & 0xffff;
  const sz = l & 0xffff;
  checkSize(sx, sy, sz);
  const blocks = version >= 3 ? getCompound(s, 'Blocks') : s;
  const paletteTag = getCompound(blocks, 'Palette') ?? {};
  const palette: string[] = [];
  for (const [state, idx] of Object.entries(paletteTag))
    if (idx.t === 'int') palette[idx.v] = canonicalFromString(state);
  for (let i = 0; i < palette.length; i++) palette[i] ??= AIR;
  const dataTag = version >= 3 ? blocks?.Data : s.BlockData;
  if (dataTag?.t !== 'byteArray') throw new Error('The .schem file has no block data.');
  const raw = readVarints(dataTag.v as Int8Array, sx * sy * sz);
  const { palette: pal, data } = withAirFirst(palette, raw);
  const beList = getCompounds(blocks, version >= 3 ? 'BlockEntities' : 'BlockEntities').length
    ? getCompounds(blocks, 'BlockEntities')
    : getCompounds(s, 'TileEntities');
  const blockEntities = beList.flatMap((be) => {
    const pos = getInts(be, 'Pos');
    if (!pos || pos.length < 3) return [];
    const id = getString(be, 'Id') ?? getString(be, 'id') ?? '';
    const inner = version >= 3 ? (getCompound(be, 'Data') ?? {}) : { ...be };
    delete inner.Pos;
    delete inner.Id;
    return [
      {
        id: id.includes(':') ? id : `minecraft:${id}`,
        pos: [pos[0], pos[1], pos[2]] as [number, number, number],
        data: compoundToJson(inner),
      },
    ];
  });
  const offset = getInts(s, 'Offset') ?? [0, 0, 0];
  let worldOrigin: [number, number, number] | null = null;
  if (version >= 3) {
    const origin = getInts(getCompound(getCompound(s, 'Metadata'), 'WorldEdit'), 'Origin');
    if (origin)
      worldOrigin = [
        (origin[0] ?? 0) + (offset[0] ?? 0),
        (origin[1] ?? 0) + (offset[1] ?? 0),
        (origin[2] ?? 0) + (offset[2] ?? 0),
      ];
  } else if (offset.some((v) => v !== 0)) {
    worldOrigin = [offset[0] ?? 0, offset[1] ?? 0, offset[2] ?? 0];
  }
  return {
    format: 'sponge',
    size: [sx, sy, sz],
    palette: pal,
    data,
    blockEntities,
    dataVersion: getNumber(s, 'DataVersion') ?? null,
    worldOrigin,
    name: getString(getCompound(s, 'Metadata'), 'Name') ?? name,
    warnings: [],
  };
}

// ---------------------------------------------------------------- MCEdit (.schematic)

function readMcEdit(root: Compound, name: string | null): ImportedVolume {
  const sx = getNumber(root, 'Width') ?? 0;
  const sy = getNumber(root, 'Height') ?? 0;
  const sz = getNumber(root, 'Length') ?? 0;
  checkSize(sx, sy, sz);
  const blocks = root.Blocks;
  const meta = root.Data;
  if (blocks?.t !== 'byteArray' || meta?.t !== 'byteArray')
    throw new Error('The .schematic file has no block data.');
  const add = root.AddBlocks?.t === 'byteArray' ? root.AddBlocks.v : null;
  const n = sx * sy * sz;
  const legacy = catalogData.legacyBlocks;
  const palette: string[] = [];
  const index = new Map<number, number>();
  const raw = new Uint32Array(n);
  const unknown = new Set<number>();
  for (let i = 0; i < n; i++) {
    let id = (blocks.v[i] as number) & 0xff;
    if (add) {
      const a = (add[i >> 1] as number) & 0xff;
      id |= ((i & 1) === 0 ? a & 0x0f : a >> 4) << 8;
    }
    const m = (meta.v[i] as number) & 0x0f;
    const key = id * 16 + m;
    let p = index.get(key);
    if (p === undefined) {
      const state = legacy[`${id}:${m}`] ?? legacy[`${id}:0`];
      if (!state) unknown.add(id);
      p = palette.length;
      palette.push(state ? canonicalFromString(state) : AIR);
      index.set(key, p);
    }
    raw[i] = p;
  }
  const { palette: pal, data } = withAirFirst(palette, raw);
  const blockEntities = getCompounds(root, 'TileEntities').flatMap((be) => {
    const x = getNumber(be, 'x');
    const y = getNumber(be, 'y');
    const z = getNumber(be, 'z');
    if (x === undefined || y === undefined || z === undefined) return [];
    const inner = { ...be };
    for (const k of ['x', 'y', 'z', 'id']) delete inner[k];
    return [
      {
        id: `minecraft:${(getString(be, 'id') ?? '').replace(/^minecraft:/, '').toLowerCase()}`,
        pos: [x, y, z] as [number, number, number],
        data: compoundToJson(inner),
      },
    ];
  });
  const ox = getNumber(root, 'WEOriginX');
  const oy = getNumber(root, 'WEOriginY');
  const oz = getNumber(root, 'WEOriginZ');
  return {
    format: 'mcedit',
    size: [sx, sy, sz],
    palette: pal,
    data,
    blockEntities,
    dataVersion: null,
    worldOrigin:
      ox !== undefined && oy !== undefined && oz !== undefined && (ox || oy || oz)
        ? [ox, oy, oz]
        : null,
    name,
    warnings: unknown.size
      ? [`Unknown block ids left as air: ${[...unknown].slice(0, 12).join(', ')}.`]
      : [],
  };
}

// ---------------------------------------------------------------- Litematica (.litematic)

function readLitematic(root: Compound, name: string | null): ImportedVolume {
  const regions = getCompound(root, 'Regions') ?? {};
  type Region = {
    min: [number, number, number];
    size: [number, number, number];
    palette: string[];
    states: Uint32Array;
    bits: number;
    tiles: Compound[];
  };
  const parsed: Region[] = [];
  for (const tag of Object.values(regions)) {
    if (tag.t !== 'compound') continue;
    const r = tag.v;
    const pos = getCompound(r, 'Position');
    const size = getCompound(r, 'Size');
    const px = getNumber(pos, 'x') ?? 0;
    const py = getNumber(pos, 'y') ?? 0;
    const pz = getNumber(pos, 'z') ?? 0;
    const sx = getNumber(size, 'x') ?? 0;
    const sy = getNumber(size, 'y') ?? 0;
    const sz = getNumber(size, 'z') ?? 0;
    const min: [number, number, number] = [
      px + (sx < 0 ? sx + 1 : 0),
      py + (sy < 0 ? sy + 1 : 0),
      pz + (sz < 0 ? sz + 1 : 0),
    ];
    const abs: [number, number, number] = [Math.abs(sx), Math.abs(sy), Math.abs(sz)];
    checkSize(...abs);
    const palette = getCompounds(r, 'BlockStatePalette').map(stateOfCompound);
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length))));
    const states = r.BlockStates?.t === 'longArray' ? r.BlockStates.words : new Uint32Array(0);
    parsed.push({ min, size: abs, palette, states, bits, tiles: getCompounds(r, 'TileEntities') });
  }
  if (!parsed.length) throw new Error('The .litematic file has no regions.');
  const lo = [0, 1, 2].map((a) => Math.min(...parsed.map((p) => p.min[a] as number)));
  const hi = [0, 1, 2].map((a) =>
    Math.max(...parsed.map((p) => (p.min[a] as number) + (p.size[a] as number))),
  );
  const size: [number, number, number] = [
    (hi[0] as number) - (lo[0] as number),
    (hi[1] as number) - (lo[1] as number),
    (hi[2] as number) - (lo[2] as number),
  ];
  checkSize(...size);
  const palette: string[] = [AIR];
  const pIndex = new Map<string, number>([[AIR, 0]]);
  const data = new Uint16Array(size[0] * size[1] * size[2]);
  const blockEntities: ImportedVolume['blockEntities'] = [];
  for (const r of parsed) {
    const ids = r.palette.map((s) => {
      const st = /^minecraft:(cave_|void_)?air$/.test(s) ? AIR : s;
      let id = pIndex.get(st);
      if (id === undefined) {
        id = palette.length;
        palette.push(st);
        pIndex.set(st, id);
      }
      return id;
    });
    const [rx, ry, rz] = r.size;
    const mask = (1 << r.bits) - 1;
    let i = 0;
    for (let y = 0; y < ry; y++)
      for (let z = 0; z < rz; z++)
        for (let x = 0; x < rx; x++, i++) {
          const bit = i * r.bits;
          const w = bit >>> 5;
          const off = bit & 31;
          let v = (r.states[w] ?? 0) >>> off;
          if (off + r.bits > 32) v |= (r.states[w + 1] ?? 0) << (32 - off);
          const pi = v & mask;
          const id = ids[pi] ?? 0;
          if (id === 0) continue;
          const gx = x + r.min[0] - (lo[0] as number);
          const gy = y + r.min[1] - (lo[1] as number);
          const gz = z + r.min[2] - (lo[2] as number);
          data[gx + size[0] * (gz + size[2] * gy)] = id;
        }
    for (const be of r.tiles) {
      const x = getNumber(be, 'x');
      const y = getNumber(be, 'y');
      const z = getNumber(be, 'z');
      if (x === undefined || y === undefined || z === undefined) continue;
      const inner = { ...be };
      for (const k of ['x', 'y', 'z', 'id']) delete inner[k];
      const gx = x + r.min[0] - (lo[0] as number);
      const gy = y + r.min[1] - (lo[1] as number);
      const gz = z + r.min[2] - (lo[2] as number);
      const state = palette[data[gx + size[0] * (gz + size[2] * gy)] as number] ?? AIR;
      blockEntities.push({
        id: getString(be, 'id') ?? state.replace(/\[.*$/, ''),
        pos: [gx, gy, gz],
        data: compoundToJson(inner),
      });
    }
  }
  return {
    format: 'litematica',
    size,
    palette,
    data,
    blockEntities,
    dataVersion: getNumber(root, 'MinecraftDataVersion') ?? null,
    worldOrigin: null,
    name: getString(getCompound(root, 'Metadata'), 'Name') ?? name,
    warnings: parsed.length > 1 ? [`${parsed.length} regions were merged into one volume.`] : [],
  };
}

// ---------------------------------------------------------------- vanilla structure (.nbt)

function readStructure(root: Compound, name: string | null): ImportedVolume {
  const size = getInts(root, 'size') ?? [];
  const sx = size[0] ?? 0;
  const sy = size[1] ?? 0;
  const sz = size[2] ?? 0;
  checkSize(sx, sy, sz);
  const palettes = getList(root, 'palettes');
  const paletteTags =
    palettes.length && palettes[0]?.t === 'list'
      ? (palettes[0] as { t: 'list'; v: Tag[] }).v
      : getList(root, 'palette');
  const palette = paletteTags.flatMap((t) => (t.t === 'compound' ? [stateOfCompound(t.v)] : []));
  const raw = new Uint32Array(sx * sy * sz);
  const air = palette.length;
  palette.push(AIR);
  raw.fill(air);
  const blockEntities: ImportedVolume['blockEntities'] = [];
  for (const b of getCompounds(root, 'blocks')) {
    const pos = getInts(b, 'pos');
    const state = getNumber(b, 'state');
    if (!pos || state === undefined) continue;
    const [x = 0, y = 0, z = 0] = pos;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) continue;
    raw[x + sx * (z + sz * y)] = state;
    const nbt = getCompound(b, 'nbt');
    if (nbt) {
      const inner = { ...nbt };
      delete inner.id;
      blockEntities.push({
        id: getString(nbt, 'id') ?? (palette[state] ?? AIR).replace(/\[.*$/, ''),
        pos: [x, y, z],
        data: compoundToJson(inner),
      });
    }
  }
  const { palette: pal, data } = withAirFirst(palette, raw);
  return {
    format: 'structure',
    size: [sx, sy, sz],
    palette: pal,
    data,
    blockEntities,
    dataVersion: getNumber(root, 'DataVersion') ?? null,
    worldOrigin: null,
    name,
    warnings: [],
  };
}

/** Read any schematic file VibeSchem can export: .schem, .schematic, .litematic, .nbt. */
export function readSchematic(buf: Buffer, filename = ''): ImportedVolume {
  const { root } = readNbt(buf);
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || null;
  if (getCompound(root, 'Regions') && root.MinecraftDataVersion !== undefined)
    return readLitematic(root, base);
  if (getCompound(root, 'Schematic')?.Version !== undefined || root.Palette || root.BlockData)
    return readSponge(root, base);
  if (root.Blocks?.t === 'byteArray') return readMcEdit(root, base);
  if (root.size && (root.palette || root.palettes) && root.blocks) return readStructure(root, base);
  throw new Error(
    'Unrecognised schematic: expected WorldEdit .schem, MCEdit .schematic, Litematica .litematic or a structure .nbt.',
  );
}
