import { gzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';
import type { BlockVolume, BlockEntity } from '@minecraft-schematic-lab/block-compiler';
import type { BuildSpec } from '@minecraft-schematic-lab/build-spec';
import { dataVersionFor, type SchematicVersion } from './schematicTypes';

interface NbtNode {
  type: string;
  name?: string;
  value: unknown;
}

type NbtCompoundValue = Record<string, NbtNode>;

export interface WriteOptions {
  version?: SchematicVersion;
  blockEntities?: BlockEntity[];
}

const intNode = (value: number): NbtNode => ({ type: 'int', value });
const shortNode = (value: number): NbtNode => ({ type: 'short', value });
const stringNode = (value: string): NbtNode => ({ type: 'string', value });
const byteNode = (value: number): NbtNode => ({ type: 'byte', value });
const intArrayNode = (value: number[]): NbtNode => ({ type: 'intArray', value });
const byteArrayNode = (value: number[]): NbtNode => ({ type: 'byteArray', value });
const compoundNode = (value: NbtCompoundValue): NbtNode => ({ type: 'compound', value });

/** Append an unsigned LEB128 varint, storing each byte as a signed NBT byte (>127 -> b-256). */
function pushVarint(out: number[], value: number): void {
  let v = value >>> 0;
  for (;;) {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b > 127 ? b - 256 : b);
    if (v === 0) break;
  }
}

/** Convert arbitrary JSON-ish data into an NBT node (best effort, for block-entity Data). */
function jsonToNbt(value: unknown): NbtNode {
  if (typeof value === 'string') return stringNode(value);
  if (typeof value === 'boolean') return byteNode(value ? 1 : 0);
  if (typeof value === 'number') {
    return Number.isInteger(value) ? intNode(value) : { type: 'double', value };
  }
  if (Array.isArray(value)) {
    const items = value.map(jsonToNbt);
    const elemType = items[0]?.type ?? 'string';
    return { type: 'list', value: { type: elemType, value: items.map((n) => n.value) } };
  }
  if (value && typeof value === 'object') {
    const out: NbtCompoundValue = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonToNbt(v);
    }
    return compoundNode(out);
  }
  return stringNode('');
}

function blockEntityCompound(be: BlockEntity, version: SchematicVersion): NbtNode {
  const base: NbtCompoundValue = {
    Id: stringNode(be.id),
    Pos: intArrayNode([be.pos[0], be.pos[1], be.pos[2]]),
  };
  const data = jsonToNbt(be.data);
  if (version === 3) {
    base.Data = data;
  } else if (data.type === 'compound') {
    Object.assign(base, data.value as NbtCompoundValue);
  }
  return compoundNode(base);
}

export async function writeSpongeSchematic(
  spec: BuildSpec,
  volume: BlockVolume,
  options: WriteOptions = {},
): Promise<Buffer> {
  const version: SchematicVersion = options.version ?? 2;
  const blockEntities = options.blockEntities ?? [];
  const dataVersion = dataVersionFor(spec.minecraftVersion);

  // Build the palette + block data in a single YZX pass.
  const paletteIndex = new Map<string, number>();
  const paletteValue: NbtCompoundValue = {};
  const blockData: number[] = [];
  volume.forEachYZX((_x, _y, _z, state) => {
    let id = paletteIndex.get(state);
    if (id === undefined) {
      id = paletteIndex.size;
      paletteIndex.set(state, id);
      paletteValue[state] = intNode(id);
    }
    pushVarint(blockData, id);
  });

  const offset = spec.origin ? [spec.origin.x, spec.origin.y, spec.origin.z] : [0, 0, 0];
  const metadata = compoundNode({
    Name: stringNode(spec.name),
    Author: stringNode('minecraft-schematic-lab'),
    WEOffsetX: intNode(0),
    WEOffsetY: intNode(0),
    WEOffsetZ: intNode(0),
  });

  const beList: NbtNode = {
    type: 'list',
    value: { type: 'compound', value: blockEntities.map((be) => blockEntityCompound(be, version).value) },
  };

  let root: NbtNode;
  if (version === 3) {
    const blocks: NbtCompoundValue = {
      Palette: compoundNode(paletteValue),
      Data: byteArrayNode(blockData),
    };
    if (blockEntities.length > 0) blocks.BlockEntities = beList;
    root = {
      type: 'compound',
      name: '',
      value: {
        Schematic: compoundNode({
          Version: intNode(3),
          DataVersion: intNode(dataVersion),
          Metadata: metadata,
          Width: shortNode(volume.x),
          Height: shortNode(volume.y),
          Length: shortNode(volume.z),
          Offset: intArrayNode(offset),
          Blocks: compoundNode(blocks),
        }),
      },
    };
  } else {
    const value: NbtCompoundValue = {
      Version: intNode(2),
      DataVersion: intNode(dataVersion),
      Metadata: metadata,
      Width: shortNode(volume.x),
      Height: shortNode(volume.y),
      Length: shortNode(volume.z),
      Offset: intArrayNode(offset),
      PaletteMax: intNode(paletteIndex.size),
      Palette: compoundNode(paletteValue),
      BlockData: byteArrayNode(blockData),
    };
    if (blockEntities.length > 0) value.BlockEntities = beList;
    root = { type: 'compound', name: 'Schematic', value };
  }

  const uncompressed = nbt.writeUncompressed(
    root as unknown as Parameters<typeof nbt.writeUncompressed>[0],
    'big',
  );
  return gzipSync(uncompressed);
}
