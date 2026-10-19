import { describe, expect, it } from 'vitest';
import { resolveVersion, type VersionInfo } from '@minecraft-schematic-lab/catalog';
import {
  datapackChangesFromVolume,
  packFormatFor,
  writeDatapack,
  type WorldChange,
} from './datapack';
import { jsonToSnbt } from './snbt';
import { readZip } from './zip';

const v = (id: string) => resolveVersion(id) as VersionInfo;

function floor(
  y: number,
  state: string,
  before = 'minecraft:grass_block[snowy=false]',
): WorldChange[] {
  const out: WorldChange[] = [];
  for (let x = 100; x < 110; x++)
    for (let z = -5; z < 5; z++) out.push({ pos: [x, y, z], state, before });
  return out;
}

function text(files: Map<string, Buffer>, path: string): string {
  return files.get(path)?.toString('utf8') ?? '';
}

describe('vanilla data pack', () => {
  const changes: WorldChange[] = [
    ...floor(64, 'minecraft:stone_bricks'),
    { pos: [101, 65, 0], state: 'minecraft:torch', before: 'minecraft:air' },
    {
      pos: [102, 65, 0],
      state: 'minecraft:chest[facing=north,type=single,waterlogged=false]',
      nbt: { Items: [{ Slot: '0b', id: 'minecraft:apple', count: 2 }] },
      before: 'minecraft:air',
    },
    { pos: [103, 65, 0], state: 'minecraft:water[level=0]', before: 'minecraft:air' },
    {
      pos: [104, 70, 1],
      state: 'minecraft:air',
      before: 'minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]',
    },
  ];
  const out = writeDatapack({
    name: 'Torre di guardia',
    version: v('1.21.4'),
    place: { kind: 'world', dimension: 'minecraft:overworld', center: [104, 65, 0] },
    changes,
  });
  const dir = 'data/vibeschem/function/torre_di_guardia';

  it('lays out a 1.21 pack with build, undo and tp functions', () => {
    expect(out.functionId).toBe('vibeschem:torre_di_guardia');
    expect(out.folder).toBe('vibeschem_torre_di_guardia');
    expect(JSON.parse(text(out.files, 'pack.mcmeta'))).toMatchObject({ pack: { pack_format: 61 } });
    for (const f of ['build', 'build_1', 'undo', 'undo_1', 'tp'])
      expect(out.files.has(`${dir}/${f}.mcfunction`)).toBe(true);
    expect(text(out.files, `${dir}/tp.mcfunction`).trim()).toBe('tp @s 104 65 0');
    const zipped = readZip(out.zip);
    expect([...zipped.keys()].sort()).toEqual([...out.files.keys()].sort());
    expect(zipped.get('pack.mcmeta')?.equals(out.files.get('pack.mcmeta') as Buffer)).toBe(true);
  });

  it('merges equal blocks into fills and orders the passes', () => {
    const build = text(out.files, `${dir}/build.mcfunction`);
    expect(build).toContain('forceload add 96 -16 111 15');
    expect(build).toContain('schedule function vibeschem:torre_di_guardia/build_1 5t');
    const lines = text(out.files, `${dir}/build_1.mcfunction`).trim().split('\n');
    const idx = (re: RegExp) => lines.findIndex((l) => re.test(l));
    expect(lines[idx(/stone_bricks/)]).toBe('fill 100 64 -5 109 64 4 minecraft:stone_bricks');
    // leaves removed first, solid floor, then the torch, then water last
    expect(idx(/104 70 1 minecraft:air/)).toBeLessThan(idx(/stone_bricks/));
    expect(idx(/stone_bricks/)).toBeLessThan(idx(/torch/));
    expect(idx(/torch/)).toBeLessThan(idx(/water/));
    expect(lines).toContain(
      'setblock 102 65 0 minecraft:chest[facing=north,type=single,waterlogged=false]{Items:[{Slot:0b,id:"minecraft:apple",count:2}]}',
    );
    expect(lines.at(-1)).toMatch(/^tellraw @a .*Done/);
    expect(lines).toContain('forceload remove 96 -16 111 15');
  });

  it('undoes to what was there before', () => {
    const undo = text(out.files, `${dir}/undo_1.mcfunction`);
    expect(undo).toContain('fill 100 64 -5 109 64 4 minecraft:grass_block[snowy=false]');
    expect(undo).toContain(
      'setblock 104 70 1 minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]',
    );
    expect(undo).toContain('fill 101 65 0 103 65 0 minecraft:air');
  });

  it('spreads big builds over ticks', () => {
    const big: WorldChange[] = [];
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 64; x++)
        for (let z = 0; z < 64; z++)
          big.push({
            pos: [x, y, z],
            state: (x + y + z) % 2 ? 'minecraft:stone' : 'minecraft:dirt',
            before: 'minecraft:air',
          });
    const p = writeDatapack({
      name: 'Big',
      version: v('1.20.1'),
      place: { kind: 'world', dimension: 'minecraft:the_nether', center: [0, 0, 0] },
      changes: big,
    });
    expect(p.ticks).toBeGreaterThan(2);
    expect(p.files.has('data/vibeschem/functions/big/build_2.mcfunction')).toBe(true);
    const part = text(p.files, 'data/vibeschem/functions/big/build_1.mcfunction').split('\n');
    expect(part.length).toBeLessThanOrEqual(2002);
    expect(part[0]).toMatch(/^execute in minecraft:the_nether run setblock /);
    expect(JSON.parse(text(p.files, 'pack.mcmeta')).pack.pack_format).toBe(15);
  });

  it('uses min_format/max_format from 1.21.9 and plain function calls in 1.13', () => {
    const p = writeDatapack({
      name: 'X',
      version: v('26.1'),
      place: { kind: 'world', dimension: 'minecraft:overworld', center: [0, 0, 0] },
      changes,
    });
    expect(JSON.parse(text(p.files, 'pack.mcmeta')).pack).toMatchObject({
      min_format: [101, 1],
      max_format: [101, 1],
    });
    const old = writeDatapack({
      name: 'X',
      version: v('1.13.2'),
      place: { kind: 'world', dimension: 'minecraft:overworld', center: [0, 0, 0] },
      changes,
    });
    const build = text(old.files, 'data/vibeschem/functions/x/build.mcfunction');
    expect(build).toContain('function vibeschem:x/build_1');
    expect(build).not.toContain('forceload');
    expect(build).not.toContain('schedule');
    expect(packFormatFor(1631).major).toBe(4);
  });

  it('refuses pre-1.13 versions', () => {
    expect(() =>
      writeDatapack({
        name: 'X',
        version: v('1.12.2'),
        place: { kind: 'world', dimension: 'minecraft:overworld', center: [0, 0, 0] },
        changes,
      }),
    ).toThrow(/1\.13/);
  });
});

describe('data pack placed where the player stands', () => {
  it('uses ~ coordinates from a marker entity and removes the build on undo', () => {
    const volume = {
      sizeX: 3,
      sizeY: 2,
      sizeZ: 1,
      palette: ['minecraft:air', 'minecraft:oak_planks'],
      data: Uint16Array.from([1, 1, 1, 0, 1, 0]),
      blockEntities: [],
    };
    const changes = datapackChangesFromVolume(volume, [1, 0, 0]);
    expect(changes.map((c) => c.pos)).toEqual([
      [-1, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const p = writeDatapack({
      name: 'Hut',
      version: v('1.20.1'),
      place: { kind: 'here' },
      changes,
    });
    const dir = 'data/vibeschem/functions/hut';
    const build = text(p.files, `${dir}/build.mcfunction`);
    expect(build).toContain('kill @e[type=minecraft:marker,tag=vibeschem_hut]');
    expect(build).toContain(
      'execute align xyz positioned ~0.5 ~ ~0.5 run summon minecraft:marker ~ ~ ~ {Tags:["vibeschem_hut"]}',
    );
    expect(build).toContain(
      'execute at @e[type=minecraft:marker,tag=vibeschem_hut,limit=1] run forceload add ~-1 ~ ~1 ~',
    );
    const part = text(p.files, `${dir}/build_1.mcfunction`);
    expect(part).toContain(
      'execute at @e[type=minecraft:marker,tag=vibeschem_hut,limit=1] run fill ~-1 ~ ~ ~1 ~ ~ minecraft:oak_planks',
    );
    expect(part).toContain('run setblock ~ ~1 ~ minecraft:oak_planks');
    const undo = text(p.files, `${dir}/undo_1.mcfunction`);
    expect(undo).toContain('minecraft:air');
    expect(undo.trim().split('\n').at(-1)).toBe('kill @e[type=minecraft:marker,tag=vibeschem_hut]');
    expect(p.files.has(`${dir}/tp.mcfunction`)).toBe(false);
    // armor stands before 1.17
    const old = writeDatapack({
      name: 'Hut',
      version: v('1.16.5'),
      place: { kind: 'here' },
      changes,
    });
    expect(text(old.files, `${dir}/build.mcfunction`)).toContain('summon minecraft:armor_stand');
  });
});

describe('SNBT', () => {
  it('writes typed numbers, arrays and quoted strings', () => {
    expect(
      jsonToSnbt({
        a: 1,
        b: 0.5,
        c: '3b',
        d: 'he said "hi"',
        'odd key': true,
        arr: ['I;', 1, 2],
        bytes: ['B;', 1],
        list: [{ id: 'x' }],
      }),
    ).toBe(
      '{a:1,b:0.5d,c:3b,d:"he said \\"hi\\"","odd key":1b,arr:[I;1,2],bytes:[B;1b],list:[{id:"x"}]}',
    );
  });
});
