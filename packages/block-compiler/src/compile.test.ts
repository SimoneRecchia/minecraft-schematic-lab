import { describe, expect, it } from 'vitest';
import {
  medievalCottage,
  stoneWatchtower,
  type BuildSpec,
} from '@minecraft-schematic-lab/build-spec';
import { BuildSpecError, compileBuildSpec, type CompileResult } from './compileBuildSpec';
import { nodeScriptRunner } from './nodeScriptRunner';

function spec(operations: BuildSpec['operations'], extra: Partial<BuildSpec> = {}): BuildSpec {
  return { name: 'Test', minecraftVersion: '1.21.4', operations, ...extra };
}

function compile(s: BuildSpec): CompileResult {
  return compileBuildSpec(s, { scriptRunner: nodeScriptRunner });
}

/** State at spec coordinates. */
function at(r: CompileResult, x: number, y: number, z: number): string {
  const v = r.volume;
  return v.getState(x - v.origin[0], y - v.origin[1], z - v.origin[2]);
}

function errorsOf(s: BuildSpec): string[] {
  try {
    compile(s);
  } catch (e) {
    if (e instanceof BuildSpecError) return e.errors;
    throw e;
  }
  return [];
}

describe('compileBuildSpec', () => {
  it('compiles the examples without warnings', () => {
    for (const s of [medievalCottage, stoneWatchtower]) {
      const r = compile(s);
      expect(r.blockCount).toBeGreaterThan(500);
      expect(r.warnings).toEqual([]);
    }
  });

  it('sizes the volume to the content, including negative coordinates', () => {
    const r = compile(spec([{ type: 'box', from: [-3, 2, -1], to: [4, 5, 6], block: 'stone' }]));
    expect([r.volume.sizeX, r.volume.sizeY, r.volume.sizeZ]).toEqual([8, 4, 8]);
    expect(r.volume.origin).toEqual([-3, 2, -1]);
    expect(at(r, -3, 2, -1)).toBe('minecraft:stone');
  });

  it('rejects blocks that do not exist in the target version, all at once', () => {
    const errors = errorsOf(
      spec(
        [
          { type: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'deepslate_bricks' },
          { type: 'box', from: [0, 2, 0], to: [1, 2, 1], block: 'stone_brik' },
        ],
        { minecraftVersion: '1.16.5' },
      ),
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/operations\[0\].*added in 1\.17/);
    expect(errors[1]).toMatch(/Did you mean: stone_bricks/);
  });

  it('reports unknown fields and versions clearly', () => {
    expect(
      errorsOf(
        spec([
          { type: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'stone', hollw: true } as never,
        ]),
      )[0],
    ).toMatch(/unknown field.*hollw/);
    expect(errorsOf(spec([], { minecraftVersion: '1.99' }))[0]).toMatch(/not a known Minecraft/);
  });

  it('connects fences, panes and walls like the game does', () => {
    const r = compile(
      spec([
        { type: 'line', from: [0, 0, 0], to: [3, 0, 0], block: 'oak_fence' },
        { type: 'line', from: [0, 0, 2], to: [2, 0, 2], block: 'cobblestone_wall' },
        { type: 'blocks', block: 'glass_pane', at: [[0, 0, 4]] },
        { type: 'blocks', block: 'stone', at: [[1, 0, 4]] },
      ]),
    );
    expect(at(r, 1, 0, 0)).toContain('east=true');
    expect(at(r, 1, 0, 0)).toContain('west=true');
    expect(at(r, 1, 0, 2)).toMatch(/east=low.*up=false.*west=low/);
    expect(at(r, 0, 0, 2)).toContain('up=true');
    expect(at(r, 0, 0, 4)).toContain('east=true');
  });

  it('keeps explicitly written connections', () => {
    const r = compile(
      spec([{ type: 'line', from: [0, 0, 0], to: [2, 0, 0], block: 'oak_fence[north=true]' }]),
    );
    expect(at(r, 1, 0, 0)).toContain('east=false');
  });

  it('computes stair corner shapes', () => {
    const r = compile(
      spec([
        {
          type: 'roof',
          shape: 'hip',
          from: [0, 0, 0],
          to: [6, 0, 6],
          block: 'oak_stairs',
          overhang: 0,
        },
      ]),
    );
    expect(at(r, 0, 0, 0)).toMatch(/shape=outer_/);
    expect(at(r, 3, 0, 0)).toMatch(/facing=south.*shape=straight/);
  });

  it('builds a classic 45° gable with overhang, eaves and a capped ridge', () => {
    const r = compile(
      spec([
        { type: 'box', from: [0, 0, 0], to: [8, 3, 6], block: 'stone_bricks', walls: true },
        {
          type: 'roof',
          shape: 'gable',
          axis: 'x',
          from: [0, 4, 0],
          to: [8, 4, 6],
          block: 'spruce_stairs',
          gable: 'spruce_planks',
          eaves: 'spruce_stairs',
        },
      ]),
    );
    expect(at(r, 4, 3, -1)).toMatch(/spruce_stairs\[facing=south,half=bottom/); // overhang row
    expect(at(r, 4, 2, -1)).toMatch(/spruce_stairs\[facing=south,half=top/); // eaves trim
    expect(at(r, 4, 4, 0)).toMatch(/facing=south,half=bottom/); // above the wall
    expect(at(r, 4, 7, 3)).toMatch(/spruce_slab\[type=bottom/); // ridge cap (odd width)
    expect(at(r, 0, 5, 3)).toBe('minecraft:spruce_planks'); // gable end wall
  });

  it('leaves no half-block gaps between rows of mixed-pitch roofs', () => {
    const r = compile(
      spec([
        {
          type: 'roof',
          shape: 'gable',
          axis: 'x',
          from: [0, 0, 0],
          to: [10, 0, 6],
          block: 'oak_stairs',
          pitch: 1.5,
          overhang: 0,
        },
      ]),
    );
    expect(at(r, 5, 0, 0)).toMatch(/oak_slab\[type=bottom/); // row 0 ends in a half step
    expect(at(r, 5, 0, 1)).toBe('minecraft:oak_planks'); // row 1 covers that cell's upper half
    expect(at(r, 5, 1, 1)).toMatch(/oak_stairs\[facing=south/);
  });

  it('derives slabs per member of a mixed roof palette', () => {
    const r = compile(
      spec(
        [
          {
            type: 'roof',
            shape: 'gable',
            from: [0, 0, 0],
            to: [20, 0, 4],
            block: 'roof',
            pitch: 0.5,
            overhang: 0,
          },
        ],
        { palette: { roof: { mix: { oak_stairs: 1, spruce_stairs: 1 } } } },
      ),
    );
    const slabs = r.palette.filter((p) => p.includes('_slab'));
    expect(slabs.some((p) => p.includes('oak_slab'))).toBe(true);
    expect(slabs.some((p) => p.includes('spruce_slab'))).toBe(true);
  });

  it('rotates components and their block states', () => {
    const r = compile(
      spec(
        [
          { type: 'place', component: 'seat', at: [0, 0, 0] },
          { type: 'place', component: 'seat', at: [10, 0, 0], rotate: 90 },
        ],
        {
          components: {
            seat: {
              operations: [{ type: 'blocks', block: 'oak_stairs[facing=north]', at: [[1, 0, 0]] }],
            },
          },
        },
      ),
    );
    expect(at(r, 1, 0, 0)).toContain('facing=north');
    // rotate 90 (clockwise from above): local +x -> +z, north -> east
    expect(at(r, 10, 0, 1)).toContain('facing=east');
  });

  it('mirrors with symmetry and repeats with offsets', () => {
    const r = compile(
      spec([
        {
          type: 'group',
          repeat: { count: 3, offset: [4, 0, 0] },
          symmetry: { z: 5 },
          operations: [{ type: 'blocks', block: 'oak_stairs[facing=south]', at: [[0, 0, 0]] }],
        },
      ]),
    );
    expect(at(r, 8, 0, 0)).toContain('facing=south');
    expect(at(r, 8, 0, 10)).toContain('facing=north');
  });

  it('mixes are deterministic and keep their ratios', () => {
    const s = spec([{ type: 'box', from: [0, 0, 0], to: [39, 0, 39], block: 'w' }], {
      palette: { w: { mix: { stone_bricks: 3, mossy_stone_bricks: 1 }, scale: 3 } },
    });
    const a = compile(s);
    const b = compile(s);
    expect([...a.volume.data]).toEqual([...b.volume.data]);
    const counts = a.volume.counts();
    const mossy = counts.get('minecraft:mossy_stone_bricks') ?? 0;
    expect(mossy / 1600).toBeGreaterThan(0.15);
    expect(mossy / 1600).toBeLessThan(0.35);
  });

  it('draws layers (floor plans and elevations)', () => {
    const r = compile(
      spec([
        {
          type: 'layers',
          origin: [0, 0, 0],
          legend: { '#': 'stone', o: 'oak_planks' },
          layers: [['#o#', '. .']],
        },
        {
          type: 'layers',
          origin: [0, 5, 0],
          plane: 'xy',
          legend: { x: 'gold_block' },
          layers: [['x..', '..x']],
        },
      ]),
    );
    expect(at(r, 1, 0, 0)).toBe('minecraft:oak_planks');
    expect(at(r, 0, 6, 0)).toBe('minecraft:gold_block'); // top row of the elevation
    expect(at(r, 2, 5, 0)).toBe('minecraft:gold_block');
  });

  it('completes doors and beds', () => {
    const r = compile(
      spec([
        { type: 'blocks', block: 'oak_door[facing=east]', at: [[0, 0, 0]] },
        { type: 'blocks', block: 'red_bed[facing=south]', at: [[3, 0, 0]] },
      ]),
    );
    expect(at(r, 0, 1, 0)).toContain('half=upper');
    expect(at(r, 3, 0, 1)).toContain('part=head');
  });

  it('runs scripts with the full API inside group transforms', () => {
    const r = compile(
      spec([
        {
          type: 'group',
          offset: [100, 0, 0],
          operations: [
            {
              type: 'script',
              code: 'for (let i = 0; i < 5; i++) set(i, i, 0, "stone"); box([0,10,0],[1,10,1],"oak_planks"); tree({ at: [10, 0, 10], kind: "bush" });',
            },
          ],
        },
      ]),
    );
    expect(at(r, 104, 4, 0)).toBe('minecraft:stone');
    expect(at(r, 101, 10, 1)).toBe('minecraft:oak_planks');
  });

  it('reports script errors without crashing', () => {
    const errors = errorsOf(
      spec([{ type: 'script', code: 'set(0,0,0,"nope_block"); undefinedThing();' }]),
    );
    expect(errors.join(' ')).toMatch(/nope_block|undefinedThing/);
  });

  it('gives scripts args, get, pick and a catchable error for a bad operation', () => {
    const r = compile(
      spec([
        {
          type: 'script',
          args: { block: 'stone' },
          code: `set(0, 0, 0, args.block);
            if (get(0, 0, 0) === 'minecraft:stone') set(1, 0, 0, pick(['oak_planks']));
            try { op({ type: 'nope' }); } catch (e) { if (e instanceof Error) set(2, 0, 0, 'dirt'); }`,
        },
      ]),
    );
    expect(at(r, 1, 0, 0)).toBe('minecraft:oak_planks');
    expect(at(r, 2, 0, 0)).toBe('minecraft:dirt');
  });

  it('keeps scripts away from Node', () => {
    // Every way back to the host's Function would give the script `process` and `require`.
    const escapes = [
      "set.constructor('return typeof process')()",
      "args.constructor.constructor('return typeof process')()",
      "Object.constructor('return typeof process')()",
      "(() => { try { op({ type: 'nope' }); } catch (e) { return e.constructor.constructor('return typeof process')(); } })()",
      "(() => { try { set({ valueOf() { throw new Error('x'); } }, 0, 0, 'stone'); } catch (e) { return e.constructor.constructor('return typeof process')(); } })()",
      'typeof globalThis.process + typeof require + typeof Atomics + typeof WebAssembly',
    ];
    for (const expression of escapes) {
      const r = compile(
        spec([
          { type: 'blocks', block: 'stone', at: [[9, 9, 9]] },
          {
            type: 'script',
            code: `if (!/^(undefined)+$/.test(${expression})) set(0, 0, 0, 'gold_block');`,
          },
        ]),
      );
      expect(at(r, 0, 0, 0), expression).toBe('minecraft:air');
    }
  });

  it('reports a syntax error, even one that tries to close the wrapper', () => {
    for (const code of ['set(0, 0, 0, "stone"', '})(); set(0, 0, 0, "stone"); (function () {']) {
      expect(errorsOf(spec([{ type: 'script', code }])).join(' '), code).toMatch(/script failed/);
    }
  });

  it('stops scripts that never end, also through promises', () => {
    for (const code of ['while (true) {}', 'const f = () => Promise.resolve().then(f); f();']) {
      let message = '';
      try {
        compileBuildSpec(spec([{ type: 'script', code }]), {
          scriptRunner: nodeScriptRunner,
          scriptTimeoutMs: 200,
        });
      } catch (e) {
        message = e instanceof BuildSpecError ? e.errors.join(' ') : String(e);
      }
      expect(message, code).toMatch(/timed out/);
    }
  });

  it('weathers blocks with replace while keeping their orientation', () => {
    const r = compile(
      spec([
        { type: 'line', from: [0, 0, 0], to: [30, 0, 0], block: 'stone_brick_stairs[facing=west]' },
        {
          type: 'replace',
          target: 'stone_brick_stairs',
          block: 'mossy_stone_brick_stairs',
          chance: 0.5,
          seed: 1,
        },
      ]),
    );
    const mossy = r.palette.find((p) => p.includes('mossy_stone_brick_stairs'));
    expect(mossy).toContain('facing=west');
  });

  it('keeps leaves persistent so they do not decay after pasting', () => {
    const r = compile(spec([{ type: 'tree', kind: 'oak', at: [0, 0, 0], seed: 1 }]));
    const leaves = r.palette.filter((p) => p.includes('leaves'));
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((p) => p.includes('persistent=true'))).toBe(true);
  });

  it('maps renamed blocks for older versions with a note', () => {
    const r = compile(
      spec([{ type: 'blocks', block: 'dirt_path', at: [[0, 0, 0]] }], {
        minecraftVersion: '1.16.5',
      }),
    );
    expect(at(r, 0, 0, 0)).toBe('minecraft:grass_path');
    expect(r.warnings.join(' ')).toMatch(/grass_path/);
  });

  it('respects masks', () => {
    const r = compile(
      spec([
        { type: 'box', from: [0, 0, 0], to: [4, 0, 0], block: 'stone' },
        { type: 'box', from: [0, 0, 0], to: [6, 0, 0], block: 'dirt', mask: 'air' },
      ]),
    );
    expect(at(r, 2, 0, 0)).toBe('minecraft:stone');
    expect(at(r, 6, 0, 0)).toBe('minecraft:dirt');
  });

  it('tracks which operation placed each block', () => {
    const r = compile(
      spec([{ id: 'base', type: 'box', from: [0, 0, 0], to: [1, 0, 1], block: 'stone' }]),
    );
    const p = r.volume.prov[0] as number;
    expect(r.provTable[p]).toContain('base');
  });

  it('compiles a large build quickly', () => {
    const r = compile(
      spec(
        [
          {
            type: 'terrain',
            from: [-100, 0, -100],
            to: [100, 0, 100],
            shape: 'hills',
            height: 6,
            amplitude: 6,
          },
          { type: 'cylinder', center: [0, 6, 0], radius: 20, height: 60, block: 'w', hollow: true },
          {
            type: 'roof',
            shape: 'cone',
            center: [0, 66, 0],
            radius: 20,
            block: 'deepslate_tile_stairs',
            pitch: 1.5,
          },
        ],
        { palette: { w: { mix: { stone_bricks: 4, andesite: 1, tuff: 1 }, scale: 3 } } },
      ),
    );
    expect(r.blockCount).toBeGreaterThan(200_000);
    expect(r.compileMs).toBeLessThan(5000);
  });
});
