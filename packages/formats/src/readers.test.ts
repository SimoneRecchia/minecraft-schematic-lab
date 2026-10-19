import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  compileBuildSpec,
  nodeScriptRunner,
  type CompileResult,
} from '@minecraft-schematic-lab/block-compiler';
import { medievalCottage, type BuildSpec } from '@minecraft-schematic-lab/build-spec';
import { compound, int, intArray, jsonToTag, list, long, str, writeNbt } from './nbt';
import { compoundToJson, readNbt } from './nbtRead';
import { encodeModifiedUtf8 } from './nbt';
import { canonicalFromString, readSchematic, type ImportedVolume } from './readers';
import { exportBuild, type ExportFormat } from './index';

function build(spec: BuildSpec): CompileResult {
  return compileBuildSpec(spec, { scriptRunner: nodeScriptRunner });
}

function roundTrip(format: ExportFormat, r: CompileResult): ImportedVolume {
  const out = exportBuild(format, {
    name: r.spec.name,
    volume: r.volume,
    version: r.version,
    anchor: r.anchor,
  });
  return readSchematic(out.buffer, `x/${r.spec.name}.ext`);
}

/** Every cell reads back as the state the compiler wrote (properties in any order). */
function expectSameBlocks(v: ImportedVolume, r: CompileResult, compareProps = true): void {
  const vol = r.volume;
  expect(v.size).toEqual([vol.sizeX, vol.sizeY, vol.sizeZ]);
  expect(v.palette[0]).toBe('minecraft:air');
  for (let i = 0; i < vol.volume; i++) {
    const want = canonicalFromString(vol.palette[vol.data[i] as number] as string);
    const got = v.palette[v.data[i] as number] as string;
    if (compareProps) expect(got).toBe(want);
    else expect(got.replace(/\[.*$/, '')).toBe(want.replace(/\[.*$/, ''));
  }
}

const cottage = build(medievalCottage);
const withChest = build({
  name: 'Chest test',
  minecraftVersion: '1.21.4',
  operations: [
    { id: 'floor', type: 'box', from: [0, 0, 0], to: [4, 0, 4], block: 'spruce_planks' },
    {
      id: 'chest',
      type: 'blocks',
      block: 'chest[facing=south]',
      at: [[2, 1, 2]],
      nbt: { Items: [{ Slot: '0b', id: 'minecraft:diamond', count: 3 }] },
    },
  ],
} as BuildSpec);

describe('readSchematic', () => {
  for (const format of ['schem', 'schem3', 'litematic', 'nbt'] as const) {
    it(`reads back a ${format} export cell by cell`, () => {
      const v = roundTrip(format, cottage);
      expectSameBlocks(v, cottage);
      expect(v.dataVersion).toBe(4189);
    });

    it(`keeps block entities in ${format}`, () => {
      const v = roundTrip(format, withChest);
      const chest = v.blockEntities.find((b) => b.id === 'minecraft:chest');
      expect(chest?.pos).toEqual(withChest.volume.blockEntities[0]?.pos);
      expect(JSON.stringify(chest?.data)).toContain('minecraft:diamond');
    });
  }

  it('names the format it found', () => {
    expect(roundTrip('schem', cottage).format).toBe('sponge');
    expect(roundTrip('litematic', cottage).format).toBe('litematica');
    expect(roundTrip('nbt', cottage).format).toBe('structure');
    expect(roundTrip('schem', cottage).name).toBe(medievalCottage.name);
  });

  it('reads legacy .schematic numeric ids back into flattened states', () => {
    const legacy = build({
      name: 'Legacy',
      minecraftVersion: '1.8.9',
      operations: [
        { type: 'box', from: [0, 0, 0], to: [2, 0, 2], block: 'granite' },
        { type: 'blocks', block: 'red_wool', at: [[0, 1, 0]] },
        { type: 'blocks', block: 'oak_stairs[facing=west,half=top]', at: [[1, 1, 1]] },
      ],
    });
    const v = roundTrip('schematic', legacy);
    expect(v.format).toBe('mcedit');
    expectSameBlocks(v, legacy, false);
    const at = (x: number, y: number, z: number) =>
      v.palette[v.data[x + v.size[0] * (z + v.size[2] * y)] as number];
    expect(at(0, 0, 0)).toBe('minecraft:granite');
    expect(at(0, 1, 0)).toBe('minecraft:red_wool');
    expect(at(1, 1, 1)).toMatch(/^minecraft:oak_stairs\[.*facing=west.*half=top/);
  });

  it('places WorldEdit v2 and v3 copies at their world position', () => {
    const v2 = readSchematic(
      gzipSync(
        writeNbt('Schematic', {
          Version: int(2),
          DataVersion: int(3953),
          Width: { t: 'short', v: 1 },
          Height: { t: 'short', v: 1 },
          Length: { t: 'short', v: 1 },
          Offset: intArray([100, 64, -20]),
          Palette: compound({ 'minecraft:stone': int(0) }),
          BlockData: { t: 'byteArray', v: new Int8Array([0]) },
        }),
      ),
    );
    expect(v2.worldOrigin).toEqual([100, 64, -20]);
    expect(v2.palette).toEqual(['minecraft:air', 'minecraft:stone']);
    expect(v2.data[0]).toBe(1);

    const v3 = readSchematic(
      gzipSync(
        writeNbt('', {
          Schematic: compound({
            Version: int(3),
            DataVersion: int(3953),
            Width: { t: 'short', v: 1 },
            Height: { t: 'short', v: 1 },
            Length: { t: 'short', v: 1 },
            Offset: intArray([-2, 0, -3]),
            Metadata: compound({ WorldEdit: compound({ Origin: intArray([10, 70, 10]) }) }),
            Blocks: compound({
              Palette: compound({ 'minecraft:oak_log[axis=y]': int(0) }),
              Data: { t: 'byteArray', v: new Int8Array([0]) },
            }),
          }),
        }),
      ),
    );
    expect(v3.worldOrigin).toEqual([8, 70, 7]);
    expect(v3.palette[1]).toBe('minecraft:oak_log[axis=y]');
  });

  it('merges several Litematica regions, including negative sizes', () => {
    const region = (pos: [number, number, number], size: [number, number, number], block: string) =>
      compound({
        Position: compound({ x: int(pos[0]), y: int(pos[1]), z: int(pos[2]) }),
        Size: compound({ x: int(size[0]), y: int(size[1]), z: int(size[2]) }),
        BlockStatePalette: list('compound', [
          compound({ Name: str('minecraft:air') }),
          compound({ Name: str(block) }),
        ]),
        // 2 bits per cell, every cell = index 1 (0b01 repeated)
        BlockStates: { t: 'longArray', words: new Uint32Array([0x55555555, 0x55555555]) },
        TileEntities: list('compound', []),
      });
    const v = readSchematic(
      gzipSync(
        writeNbt('', {
          MinecraftDataVersion: int(3953),
          Version: int(6),
          Metadata: compound({ Name: str('Two'), TimeCreated: long(0) }),
          Regions: compound({
            a: region([0, 0, 0], [2, 1, 1], 'minecraft:stone'),
            b: region([4, 0, 0], [-2, 1, 1], 'minecraft:dirt'),
          }),
        }),
      ),
    );
    expect(v.size).toEqual([5, 1, 1]);
    expect(Array.from(v.data, (i) => v.palette[i])).toEqual([
      'minecraft:stone',
      'minecraft:stone',
      'minecraft:air',
      'minecraft:dirt',
      'minecraft:dirt',
    ]);
    expect(v.warnings[0]).toMatch(/2 regions/);
  });

  it('rejects files that are not schematics', () => {
    expect(() => readSchematic(gzipSync(writeNbt('', { foo: int(1) })))).toThrow(/Unrecognised/);
    expect(() => readSchematic(Buffer.from('hello'))).toThrow();
  });
});

describe('NBT JSON round trip', () => {
  it('turns tags into JSON that jsonToTag turns back into the same tags', () => {
    const tag = compound({
      b: { t: 'byte', v: 1 },
      s: { t: 'short', v: -5 },
      i: int(7),
      l: long(123456789012),
      f: { t: 'float', v: 0.5 },
      d: { t: 'double', v: 2 },
      str: str('x'),
      ba: { t: 'byteArray', v: new Int8Array([1, -2]) },
      ia: intArray([3, -4]),
      la: {
        t: 'longArray',
        words: new Uint32Array([0xffffffff, 0xffffffff, 5, 0]),
      },
      list: list('compound', [compound({ id: str('minecraft:stone') })]),
    });
    const bytes = writeNbt('', tag.t === 'compound' ? tag.v : {});
    const json = compoundToJson(readNbt(bytes).root);
    expect(json.la).toEqual(['L;', '-1', '5']);
    const back = jsonToTag(json);
    const again = writeNbt('', back.t === 'compound' ? back.v : {});
    expect(Buffer.compare(again, bytes)).toBe(0);
  });
});

describe('modified UTF-8', () => {
  it('writes NUL and emoji the way Java does and reads them back', () => {
    const text = 'Ciao è\u0000😀';
    const bytes = encodeModifiedUtf8(text);
    expect(bytes.subarray(-6).toString('hex')).toBe('eda0bdedb880');
    expect(bytes.includes(0)).toBe(false);
    const nbt = writeNbt('', { s: str(text) });
    expect(readNbt(nbt).root.s).toEqual({ t: 'string', v: text });
  });
});
