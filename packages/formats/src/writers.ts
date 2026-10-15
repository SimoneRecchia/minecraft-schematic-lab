import { gzipSync } from 'node:zlib';
import type { BlockVolume } from '@minecraft-schematic-lab/block-compiler';
import {
  blockNameOf,
  propsOf,
  toLegacyIdMeta,
  type VersionInfo,
} from '@minecraft-schematic-lab/catalog';
import {
  byteArray,
  compound,
  int,
  intArray,
  jsonToTag,
  list,
  long,
  short,
  str,
  writeNbt,
  type Tag,
} from './nbt';

export interface ExportInput {
  name: string;
  volume: BlockVolume;
  version: VersionInfo;
  /** Local position that lands at the player's feet on paste. */
  anchor: [number, number, number];
  author?: string;
  description?: string;
}

export interface ExportOutput {
  buffer: Buffer;
  warnings: string[];
}

const AUTHOR = 'minecraft-schematic-lab';

function dataVersionOf(v: VersionInfo): number {
  return v.dataVersion ?? 1343;
}

/** Unsigned LEB128 varints of the palette indices, as the Sponge formats store them. */
function varintBlockData(data: Uint16Array): Uint8Array {
  let size = 0;
  for (let i = 0; i < data.length; i++)
    size += (data[i] as number) < 128 ? 1 : (data[i] as number) < 16384 ? 2 : 3;
  const out = new Uint8Array(size);
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    let v = data[i] as number;
    while (v >= 0x80) {
      out[p++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    out[p++] = v;
  }
  return out;
}

function spongePalette(volume: BlockVolume): Record<string, Tag> {
  const out: Record<string, Tag> = {};
  volume.palette.forEach((state, i) => {
    out[state] = int(i);
  });
  return out;
}

function checkSize(volume: BlockVolume): void {
  if (volume.sizeX > 65535 || volume.sizeY > 65535 || volume.sizeZ > 65535) {
    throw new Error('Schematic dimensions must be at most 65535 per axis.');
  }
}

/** Sponge Schematic v2 (.schem): WorldEdit 7+, FAWE, Litematica import. Root named "Schematic". */
export function writeSpongeV2(input: ExportInput): ExportOutput {
  const { volume, anchor } = input;
  checkSize(volume);
  const blockEntities = volume.blockEntities.map((be) => {
    const data = jsonToTag(be.data);
    return compound({
      Id: str(be.id),
      Pos: intArray(be.pos),
      ...(data.t === 'compound' ? data.v : {}),
    });
  });
  const root: Record<string, Tag> = {
    Version: int(2),
    DataVersion: int(dataVersionOf(input.version)),
    Metadata: compound({
      Name: str(input.name),
      Author: str(input.author ?? AUTHOR),
      Date: long(Date.now()),
      WEOffsetX: int(-anchor[0]),
      WEOffsetY: int(-anchor[1]),
      WEOffsetZ: int(-anchor[2]),
    }),
    Width: short((volume.sizeX << 16) >> 16),
    Height: short((volume.sizeY << 16) >> 16),
    Length: short((volume.sizeZ << 16) >> 16),
    Offset: intArray([0, 0, 0]),
    PaletteMax: int(volume.palette.length),
    Palette: compound(spongePalette(volume)),
    BlockData: byteArray(varintBlockData(volume.data)),
    BlockEntities: list('compound', blockEntities),
  };
  return { buffer: gzipSync(writeNbt('Schematic', root)), warnings: [] };
}

/** Sponge Schematic v3 (.schem): WorldEdit 7.3+ / FAWE 2.11+. Unnamed root wrapping "Schematic". */
export function writeSpongeV3(input: ExportInput): ExportOutput {
  const { volume, anchor } = input;
  checkSize(volume);
  const blockEntities = volume.blockEntities.map((be) =>
    compound({ Id: str(be.id), Pos: intArray(be.pos), Data: jsonToTag(be.data) }),
  );
  const schematic: Record<string, Tag> = {
    Version: int(3),
    DataVersion: int(dataVersionOf(input.version)),
    Metadata: compound({
      Name: str(input.name),
      Author: str(input.author ?? AUTHOR),
      Date: long(Date.now()),
      WorldEdit: compound({ Origin: intArray([0, 0, 0]) }),
    }),
    Width: short((volume.sizeX << 16) >> 16),
    Height: short((volume.sizeY << 16) >> 16),
    Length: short((volume.sizeZ << 16) >> 16),
    Offset: intArray([-anchor[0], -anchor[1], -anchor[2]]),
    Blocks: compound({
      Palette: compound(spongePalette(volume)),
      Data: byteArray(varintBlockData(volume.data)),
      BlockEntities: list('compound', blockEntities),
    }),
  };
  return { buffer: gzipSync(writeNbt('', { Schematic: compound(schematic) })), warnings: [] };
}

/** Legacy block-entity ids (≤1.10 used CamelCase names). */
function legacyTileId(name: string, version: VersionInfo): string {
  if (version.dataVersion !== null && version.dataVersion >= 819) return `minecraft:${name}`;
  const map: Record<string, string> = {
    chest: 'Chest',
    trapped_chest: 'Chest',
    furnace: 'Furnace',
    sign: 'Sign',
    wall_sign: 'Sign',
    hopper: 'Hopper',
    dispenser: 'Trap',
    dropper: 'Dropper',
    beacon: 'Beacon',
    skull: 'Skull',
    flower_pot: 'FlowerPot',
    banner: 'Banner',
  };
  return map[name] ?? name;
}

/** MCEdit/Alpha .schematic for WorldEdit 6 (Minecraft 1.8–1.12): numeric ids + metadata. */
export function writeMcEdit(input: ExportInput): ExportOutput {
  const { volume, anchor } = input;
  if (volume.sizeX > 32767 || volume.sizeY > 32767 || volume.sizeZ > 32767) {
    throw new Error('Legacy .schematic dimensions must be at most 32767 per axis.');
  }
  const ids = new Int32Array(volume.palette.length);
  const metas = new Int32Array(volume.palette.length);
  const unmapped = new Set<string>();
  volume.palette.forEach((state, i) => {
    if (i === 0) return;
    const legacy = toLegacyIdMeta(state);
    if (!legacy) {
      unmapped.add(blockNameOf(state));
      return;
    }
    ids[i] = legacy.id;
    metas[i] = legacy.meta;
  });
  const n = volume.data.length;
  const blocks = new Uint8Array(n);
  const data = new Uint8Array(n);
  let add: Uint8Array | null = null;
  for (let i = 0; i < n; i++) {
    const p = volume.data[i] as number;
    const id = ids[p] as number;
    blocks[i] = id & 0xff;
    data[i] = (metas[p] as number) & 0x0f;
    if (id > 255) {
      add ??= new Uint8Array((n >> 1) + 1);
      const hi = (id >> 8) & 0x0f;
      const j = i >> 1;
      add[j] =
        (i & 1) === 0 ? ((add[j] as number) & 0xf0) | hi : ((add[j] as number) & 0x0f) | (hi << 4);
    }
  }
  const tiles = volume.blockEntities.map((be) => {
    const d = jsonToTag(be.data);
    return compound({
      ...(d.t === 'compound' ? d.v : {}),
      id: str(legacyTileId(blockNameOf(be.id), input.version)),
      x: int(be.pos[0]),
      y: int(be.pos[1]),
      z: int(be.pos[2]),
    });
  });
  const root: Record<string, Tag> = {
    Width: short(volume.sizeX),
    Height: short(volume.sizeY),
    Length: short(volume.sizeZ),
    Materials: str('Alpha'),
    Blocks: byteArray(blocks),
    Data: byteArray(data),
    ...(add ? { AddBlocks: byteArray(add) } : {}),
    TileEntities: list('compound', tiles),
    Entities: list('compound', []),
    WEOriginX: int(0),
    WEOriginY: int(0),
    WEOriginZ: int(0),
    WEOffsetX: int(-anchor[0]),
    WEOffsetY: int(-anchor[1]),
    WEOffsetZ: int(-anchor[2]),
  };
  const warnings = unmapped.size
    ? [`No pre-1.13 equivalent for: ${[...unmapped].join(', ')} (left as air).`]
    : [];
  return { buffer: gzipSync(writeNbt('Schematic', root)), warnings };
}

function stateCompound(state: string): Tag {
  const props = propsOf(state);
  const name = state.includes('[') ? state.slice(0, state.indexOf('[')) : state;
  const p: Record<string, Tag> = {};
  for (const [k, v] of Object.entries(props)) p[k] = str(v);
  return compound(
    Object.keys(p).length ? { Name: str(name), Properties: compound(p) } : { Name: str(name) },
  );
}

function litematicVersion(dataVersion: number): number {
  if (dataVersion >= 3837) return 7; // 1.20.5+
  if (dataVersion >= 2860) return 6; // 1.18+
  return 5; // 1.13–1.17
}

/**
 * Litematica .litematic (one region). Palette entry 0 is air; indices are bit-packed LSB-first
 * into longs and may span long boundaries.
 */
export function writeLitematic(input: ExportInput): ExportOutput {
  const { volume } = input;
  const dv = dataVersionOf(input.version);
  const paletteSize = volume.palette.length;
  const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, paletteSize))));
  const total = volume.data.length;
  const longs = Math.ceil((total * bits) / 64);
  const words = new Uint32Array(longs * 2);
  for (let i = 0; i < total; i++) {
    const v = volume.data[i] as number;
    const bit = i * bits;
    const w = bit >>> 5;
    const off = bit & 31;
    words[w] = ((words[w] as number) | (v << off)) >>> 0;
    if (off + bits > 32) words[w + 1] = ((words[w + 1] as number) | (v >>> (32 - off))) >>> 0;
  }
  let nonAir = 0;
  for (let i = 0; i < total; i++) if (volume.data[i] !== 0) nonAir++;
  const xyz = (x: number, y: number, z: number): Tag =>
    compound({ x: int(x), y: int(y), z: int(z) });
  const now = Date.now();
  const tiles = volume.blockEntities.map((be) => {
    const d = jsonToTag(be.data);
    return compound({
      ...(d.t === 'compound' ? d.v : {}),
      id: str(be.id),
      x: int(be.pos[0]),
      y: int(be.pos[1]),
      z: int(be.pos[2]),
    });
  });
  const region = compound({
    Position: xyz(0, 0, 0),
    Size: xyz(volume.sizeX, volume.sizeY, volume.sizeZ),
    BlockStatePalette: list('compound', volume.palette.map(stateCompound)),
    BlockStates: { t: 'longArray', words },
    TileEntities: list('compound', tiles),
    Entities: list('compound', []),
    PendingBlockTicks: list('compound', []),
    PendingFluidTicks: list('compound', []),
  });
  const root: Record<string, Tag> = {
    MinecraftDataVersion: int(dv),
    Version: int(litematicVersion(dv)),
    SubVersion: int(1),
    Metadata: compound({
      Name: str(input.name),
      Author: str(input.author ?? AUTHOR),
      Description: str(input.description ?? ''),
      RegionCount: int(1),
      TotalVolume: int(total),
      TotalBlocks: int(nonAir),
      TimeCreated: long(now),
      TimeModified: long(now),
      EnclosingSize: xyz(volume.sizeX, volume.sizeY, volume.sizeZ),
    }),
    Regions: compound({ [input.name || 'Build']: region }),
  };
  return { buffer: gzipSync(writeNbt('', root)), warnings: [] };
}

export const STRUCTURE_BLOCK_LIMIT = 48;

/** Vanilla structure file (.nbt): structure blocks (≤48³) or /place template (1.19+). */
export function writeStructure(input: ExportInput): ExportOutput {
  const { volume } = input;
  const blocks: Tag[] = [];
  const beByIndex = new Map(volume.blockEntities.map((be) => [volume.index(...be.pos), be]));
  let i = 0;
  for (let y = 0; y < volume.sizeY; y++) {
    for (let z = 0; z < volume.sizeZ; z++) {
      for (let x = 0; x < volume.sizeX; x++, i++) {
        const be = beByIndex.get(i);
        const entry: Record<string, Tag> = {
          state: int(volume.data[i] as number),
          pos: list('int', [int(x), int(y), int(z)]),
        };
        if (be) {
          const d = jsonToTag(be.data);
          entry.nbt = compound({ ...(d.t === 'compound' ? d.v : {}), id: str(be.id) });
        }
        blocks.push(compound(entry));
      }
    }
  }
  const root: Record<string, Tag> = {
    DataVersion: int(dataVersionOf(input.version)),
    size: list('int', [int(volume.sizeX), int(volume.sizeY), int(volume.sizeZ)]),
    palette: list('compound', volume.palette.map(stateCompound)),
    blocks: list('compound', blocks),
    entities: list('compound', []),
  };
  const warnings: string[] = [];
  if (Math.max(volume.sizeX, volume.sizeY, volume.sizeZ) > STRUCTURE_BLOCK_LIMIT) {
    warnings.push(
      `Larger than ${STRUCTURE_BLOCK_LIMIT} blocks on a side: a structure block can't load it; use /place template (1.19+).`,
    );
  }
  return { buffer: gzipSync(writeNbt('', root)), warnings };
}
