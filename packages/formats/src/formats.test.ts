import { gunzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';
import { describe, expect, it } from 'vitest';
import {
  compileBuildSpec,
  nodeScriptRunner,
  type CompileResult,
} from '@minecraft-schematic-lab/block-compiler';
import { medievalCottage, type BuildSpec } from '@minecraft-schematic-lab/build-spec';
import { exportBuild, formatsFor, materialList, type ExportFormat } from './index';

function build(spec: BuildSpec): CompileResult {
  return compileBuildSpec(spec, { scriptRunner: nodeScriptRunner });
}

function inputOf(r: CompileResult) {
  return { name: r.spec.name, volume: r.volume, version: r.version, anchor: r.anchor };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(format: ExportFormat, r: CompileResult): { name: string; value: any } {
  const out = exportBuild(format, inputOf(r));
  const root = nbt.parseUncompressed(gunzipSync(out.buffer), 'big');
  return { name: root.name, value: nbt.simplify(root) };
}

function decodeVarints(bytes: number[]): number[] {
  const out: number[] = [];
  let v = 0;
  let shift = 0;
  for (const raw of bytes) {
    const b = raw & 0xff;
    v |= (b & 0x7f) << shift;
    if (b & 0x80) shift += 7;
    else {
      out.push(v);
      v = 0;
      shift = 0;
    }
  }
  return out;
}

const cottage = build(medievalCottage);

describe('Sponge v2', () => {
  it('writes a WorldEdit-readable root named Schematic with consistent palette and data', () => {
    const { name, value } = parse('schem', cottage);
    expect(name).toBe('Schematic');
    expect(value.Version).toBe(2);
    expect(value.DataVersion).toBe(4189);
    expect([value.Width, value.Height, value.Length]).toEqual([
      cottage.volume.sizeX,
      cottage.volume.sizeY,
      cottage.volume.sizeZ,
    ]);
    expect(value.PaletteMax).toBe(Object.keys(value.Palette).length);
    expect(value.Palette['minecraft:air']).toBe(0);
    const ids = decodeVarints(value.BlockData);
    expect(ids.length).toBe(cottage.volume.volume);
    const inverse = Object.fromEntries(
      Object.entries(value.Palette).map(([k, v]) => [v as number, k]),
    );
    // spot-check every cell maps back to the same state
    for (let i = 0; i < ids.length; i += 97) {
      expect(inverse[ids[i] as number]).toBe(
        cottage.volume.palette[cottage.volume.data[i] as number],
      );
    }
    expect(value.Metadata.WEOffsetX).toBe(-cottage.anchor[0]);
  });
});

describe('Sponge v3', () => {
  it('wraps Schematic in an unnamed root and always writes BlockEntities', () => {
    const { name, value } = parse('schem3', cottage);
    expect(name).toBe('');
    const s = value.Schematic;
    expect(s.Version).toBe(3);
    expect(s.Blocks.BlockEntities).toEqual([]);
    expect(decodeVarints(s.Blocks.Data).length).toBe(cottage.volume.volume);
    expect(s.Offset).toEqual(cottage.anchor.map((v) => 0 - v || 0));
    expect(cottage.anchor[1]).toBe(3); // ground level (spec y=0) sits 3 above the terrain bottom
  });
});

describe('Litematica', () => {
  it('packs palette indices across long boundaries with air first', () => {
    const out = exportBuild('litematic', inputOf(cottage));
    const root = nbt.parseUncompressed(gunzipSync(out.buffer), 'big');
    const value = nbt.simplify(root);
    expect(value.Version).toBe(7);
    expect(value.MinecraftDataVersion).toBe(4189);
    const region = Object.values(value.Regions)[0] as {
      BlockStatePalette: { Name: string }[];
      Size: { x: number; y: number; z: number };
    };
    expect(region.BlockStatePalette[0]?.Name).toBe('minecraft:air');
    // Raw long array (as [hi, lo] pairs) -> unpack and compare with the volume.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawRegion = (root.value.Regions as any).value[medievalCottage.name].value;
    const longs: [number, number][] = rawRegion.BlockStates.value;
    const n = region.BlockStatePalette.length;
    const bits = Math.max(2, Math.ceil(Math.log2(n)));
    const big = longs.map(
      ([hi, lo]) => (BigInt.asUintN(32, BigInt(hi)) << 32n) | BigInt.asUintN(32, BigInt(lo)),
    );
    const mask = (1n << BigInt(bits)) - 1n;
    for (let i = 0; i < cottage.volume.volume; i += 53) {
      const bit = BigInt(i * bits);
      const w = Number(bit >> 6n);
      const off = bit & 63n;
      let v = (big[w] as bigint) >> off;
      if (off + BigInt(bits) > 64n) v |= (big[w + 1] as bigint) << (64n - off);
      v &= mask;
      const state = region.BlockStatePalette[Number(v)]?.Name;
      expect(state).toBe(
        cottage.volume.palette[cottage.volume.data[i] as number]?.replace(/\[.*$/, ''),
      );
    }
    expect(value.Metadata.TotalVolume).toBe(cottage.volume.volume);
  });
});

describe('structure .nbt', () => {
  it('lists every cell with its palette state', () => {
    const { value } = parse('nbt', cottage);
    expect(value.size).toEqual([cottage.volume.sizeX, cottage.volume.sizeY, cottage.volume.sizeZ]);
    expect(value.blocks.length).toBe(cottage.volume.volume);
    expect(value.palette[0].Name).toBe('minecraft:air');
  });
});

describe('legacy .schematic', () => {
  const legacy = build({
    name: 'Legacy',
    minecraftVersion: '1.8.9',
    operations: [
      { type: 'box', from: [0, 0, 0], to: [2, 0, 2], block: 'granite' },
      { type: 'blocks', block: 'oak_stairs[facing=west,half=top]', at: [[1, 1, 1]] },
      { type: 'blocks', block: 'red_wool', at: [[0, 1, 0]] },
    ],
  });

  it('maps flattened blocks to numeric id:meta', () => {
    const { name, value } = parse('schematic', legacy);
    expect(name).toBe('Schematic');
    expect(value.Materials).toBe('Alpha');
    const i = (x: number, y: number, z: number) => y * 9 + z * 3 + x;
    expect(value.Blocks[i(0, 0, 0)]).toBe(1);
    expect(value.Data[i(0, 0, 0)]).toBe(1);
    expect(value.Blocks[i(1, 1, 1)]).toBe(53);
    expect(value.Data[i(1, 1, 1)]).toBe(5);
    expect(value.Blocks[i(0, 1, 0)]).toBe(35);
    expect(value.Data[i(0, 1, 0)]).toBe(14);
    expect(value.TileEntities).toEqual([]);
  });

  it('offers only the legacy formats for 1.8', () => {
    const avail = formatsFor(legacy.version)
      .filter((f) => f.available)
      .map((f) => f.id);
    expect(avail).toEqual(['schematic', 'materials']);
  });
});

describe('material list', () => {
  it('counts doors once and stacks by 64', () => {
    const r = build({
      name: 'M',
      minecraftVersion: '1.21.4',
      operations: [
        { type: 'box', from: [0, 0, 0], to: [9, 9, 0], block: 'stone' },
        { type: 'blocks', block: 'oak_door', at: [[0, 0, 2]] },
        { type: 'blocks', block: 'oak_slab[type=double]', at: [[3, 0, 2]] },
      ],
    });
    const list = materialList(r.volume);
    expect(list.find((m) => m.item === 'stone')).toMatchObject({
      count: 100,
      stacks: 1,
      remainder: 36,
    });
    expect(list.find((m) => m.item === 'oak_door')?.count).toBe(1);
    expect(list.find((m) => m.item === 'oak_slab')?.count).toBe(2);
  });
});
