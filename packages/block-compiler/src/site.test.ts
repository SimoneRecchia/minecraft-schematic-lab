import { describe, expect, it } from 'vitest';
import type { BuildSpec } from '@minecraft-schematic-lab/build-spec';
import {
  BuildSpecError,
  compileBuildSpec,
  type CompileResult,
  type CompileSite,
} from './compileBuildSpec';
import { nodeScriptRunner } from './nodeScriptRunner';

const AIR = 'minecraft:air';

/**
 * A 41×24×41 site sloping up to the east: ground top at spec y = -1 at x = 0, one block higher
 * every 4 blocks east. An oak at (6, z=6), tall grass at z = -10, a chest at (-12, 0, -12).
 */
function slope(): CompileSite {
  const size: [number, number, number] = [41, 24, 41];
  const min: [number, number, number] = [-20, -12, -20];
  const palette = [
    AIR,
    'minecraft:stone',
    'minecraft:dirt',
    'minecraft:grass_block[snowy=false]',
    'minecraft:oak_log[axis=y]',
    'minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]',
    'minecraft:short_grass',
    'minecraft:chest[facing=north,type=single,waterlogged=false]',
  ];
  const data = new Uint16Array(size[0] * size[1] * size[2]);
  for (let y = 0; y < size[1]; y++)
    for (let z = 0; z < size[2]; z++)
      for (let x = 0; x < size[0]; x++) {
        const sx = x + min[0];
        const sy = y + min[1];
        const sz = z + min[2];
        const g = groundOf(sx);
        let id = 0;
        if (sy < g - 2) id = 1;
        else if (sy < g) id = 2;
        else if (sy === g) id = 3;
        else if (sx === 6 && sz === 6 && sy <= g + 4) id = 4;
        else if (Math.abs(sx - 6) <= 1 && Math.abs(sz - 6) <= 1 && sy === g + 5) id = 5;
        else if (sz === -10 && sy === g + 1) id = 6;
        else if (sx === -12 && sz === -12 && sy === g + 1) id = 7;
        data[x + size[0] * (z + size[2] * y)] = id;
      }
  return {
    version: '1.21.4',
    min,
    size,
    palette,
    data,
    blockEntities: [
      {
        id: 'minecraft:chest',
        pos: [-12 - min[0], groundOf(-12) + 1 - min[1], -12 - min[2]],
        data: { Items: [{ Slot: '0b', id: 'minecraft:apple', count: 1 }] },
      },
    ],
  };
}

function groundOf(x: number): number {
  return -1 + Math.floor(x / 4);
}

const site = slope();

function build(operations: BuildSpec['operations'], extra: Partial<BuildSpec> = {}): CompileResult {
  return compileBuildSpec(
    { name: 'On site', minecraftVersion: '1.21.4', site: { id: 's1' }, operations, ...extra },
    { scriptRunner: nodeScriptRunner, site },
  );
}

function at(r: CompileResult, x: number, y: number, z: number): string {
  const v = r.volume;
  return v.getState(x - v.origin[0], y - v.origin[1], z - v.origin[2]).replace(/^minecraft:/, '');
}

function topGround(r: CompileResult, x: number, z: number): number {
  for (let y = 11; y >= -12; y--) {
    const s = at(r, x, y, z);
    if (/^(grass_block|dirt|stone)/.test(s)) return y;
  }
  return -99;
}

describe('building on a site', () => {
  it('keeps the site as the volume and counts only what changed', () => {
    const r = build([{ type: 'box', from: [0, 0, 0], to: [2, 2, 2], block: 'stone' }]);
    expect([r.volume.sizeX, r.volume.sizeY, r.volume.sizeZ]).toEqual(site.size);
    expect(r.volume.origin).toEqual(site.min);
    // 27 blocks of stone, minus nothing (the box sits on the ground at y=0..2 above x 0..2)
    expect(r.site?.changes).toBe(27);
    expect(at(r, 10, groundOf(10), 0)).toBe('grass_block[snowy=false]');
    // The chest keeps its items.
    expect(r.volume.blockEntities).toHaveLength(1);
    expect(r.volume.blockEntities[0]?.id).toBe('minecraft:chest');
  });

  it("drops a site chest's items when the chest is replaced", () => {
    const r = build([{ type: 'blocks', block: 'stone', at: [[-12, groundOf(-12) + 1, -12]] }]);
    expect(r.volume.blockEntities).toHaveLength(0);
    expect(r.site?.changes).toBe(1);
  });

  it('flattens a plot to a level, blends the edge and clears the tree', () => {
    const r = build([
      { id: 'plot', type: 'flatten', from: [0, 0, 0], to: [10, 0, 10], level: 0, blend: 4 },
    ]);
    for (const [x, z] of [
      [0, 0],
      [10, 10],
      [6, 6],
      [5, 9],
    ] as const)
      expect(topGround(r, x, z)).toBe(-1);
    // trunk and leaves above the plot are gone; grass on top
    expect(at(r, 6, 0, 6)).toBe('air');
    expect(at(r, 6, -1, 6)).toBe('grass_block[snowy=false]');
    // natural ground (x=14 → 2) eases down towards the plot (x=10 → -1)
    const edge = topGround(r, 12, 5);
    expect(edge).toBeGreaterThanOrEqual(-1);
    expect(edge).toBeLessThanOrEqual(groundOf(12));
    expect(topGround(r, 16, 5)).toBe(groundOf(16));
  });

  it('defaults the level to the median ground of the plot', () => {
    const r = build([{ type: 'flatten', from: [-4, 0, -4], to: [4, 0, 4], blend: 0 }]);
    const levels = new Set<number>();
    for (let x = -4; x <= 4; x++) levels.add(topGround(r, x, 0));
    expect(levels.size).toBe(1);
  });

  it('fills foundations down into the ground under a platform', () => {
    const r = build([
      { type: 'box', from: [-8, 4, -2], to: [8, 4, 2], block: 'oak_planks' },
      {
        type: 'foundation',
        from: [-8, 3, -2],
        to: [8, 3, 2],
        block: 'cobblestone',
        style: 'pillars',
        spacing: 4,
      },
    ]);
    // corner pillar at x=-8: ground -3, depth 1 → cobblestone from -3 to 3
    for (let y = groundOf(-8); y <= 3; y++) expect(at(r, -8, y, -2)).toBe('cobblestone');
    expect(at(r, -8, groundOf(-8) - 1, -2)).toBe('dirt');
    // between pillars nothing is filled
    expect(at(r, -6, 2, -2)).toBe('air');
    expect(at(r, -4, 2, 2)).toBe('cobblestone');
  });

  it('stands trees, blocks and components on the ground', () => {
    const r = build(
      [
        { type: 'tree', kind: 'oak', at: [16, 0, -6], ground: true, height: 5 },
        {
          type: 'blocks',
          block: 'lantern',
          at: [
            [-16, 0, 0],
            [12, 1, 0],
          ],
          ground: true,
        },
        {
          type: 'place',
          component: 'post',
          at: [-8, 0, 8],
          ground: true,
          repeat: { count: 4, offset: [6, 0, 0] },
        },
      ],
      {
        components: {
          post: {
            operations: [{ type: 'line', from: [0, 0, 0], to: [0, 2, 0], block: 'oak_fence' }],
          },
        },
      },
    );
    expect(at(r, 16, groundOf(16) + 1, -6)).toMatch(/^oak_log/);
    expect(at(r, -16, groundOf(-16) + 1, 0)).toMatch(/^lantern/);
    expect(at(r, 12, groundOf(12) + 2, 0)).toMatch(/^lantern/);
    for (const x of [-8, -2, 4, 10]) {
      expect(at(r, x, groundOf(x) + 1, 8)).toMatch(/^oak_fence/);
      expect(at(r, x, groundOf(x) + 3, 8)).toMatch(/^oak_fence/);
      expect(at(r, x, groundOf(x) + 4, 8)).toBe('air');
    }
  });

  it('gives scripts ground(), surface() and the site bounds', () => {
    const r = build([
      {
        type: 'script',
        code: `
          if (SITE.min[1] !== -12) throw new Error('bad site ' + JSON.stringify(SITE));
          if (ground(0, 0) !== -1) throw new Error('ground ' + ground(0, 0));
          if (surface(6, 6) !== ground(6, 6) + 5) throw new Error('surface');
          for (let x = -18; x <= 18; x += 6) set(x, ground(x, 15) + 1, 15, 'red_wool');
        `,
      },
    ]);
    for (let x = -18; x <= 18; x += 6) expect(at(r, x, groundOf(x) + 1, 15)).toBe('red_wool');
  });

  it('lays a path that follows the ground and clears the grass on it', () => {
    const r = build([
      {
        type: 'path',
        points: [
          [-16, -10],
          [16, -10],
        ],
        width: 3,
      },
    ]);
    for (const x of [-16, -3, 0, 9, 16]) {
      expect(at(r, x, groundOf(x), -10)).toBe('dirt_path');
      expect(at(r, x, groundOf(x) + 1, -10)).toBe('air');
    }
    expect(at(r, 0, groundOf(0), -12)).toBe('grass_block[snowy=false]');
  });

  it('warns about blocks outside the site', () => {
    const r = build([{ type: 'box', from: [18, 0, 0], to: [25, 0, 0], block: 'stone' }]);
    expect(r.warnings.join(' ')).toMatch(/outside the site/);
  });

  it("asks for the site's Minecraft version", () => {
    expect(() =>
      compileBuildSpec(
        { name: 'x', minecraftVersion: '1.20.1', site: { id: 's1' }, operations: [] },
        { site },
      ),
    ).toThrow(/1\.21\.4/);
  });

  it('fails clearly when the site is missing', () => {
    expect(() =>
      compileBuildSpec({
        name: 'x',
        minecraftVersion: '1.21.4',
        site: { id: 'gone' },
        operations: [],
      }),
    ).toThrow(BuildSpecError);
  });

  it('reads terrain-op ground without a site', () => {
    const r = compileBuildSpec(
      {
        name: 'No site',
        minecraftVersion: '1.21.4',
        operations: [
          { type: 'terrain', from: [-10, -4, -10], to: [10, -4, 10], shape: 'hills', amplitude: 3 },
          { type: 'tree', kind: 'birch', at: [3, 0, 3], ground: true },
        ],
      },
      { scriptRunner: nodeScriptRunner },
    );
    const v = r.volume;
    let g = -99;
    for (let y = v.sizeY - 1; y >= 0; y--)
      if (/grass_block|dirt|stone/.test(v.getState(3 - v.origin[0], y, 3 - v.origin[2]))) {
        g = y + v.origin[1];
        break;
      }
    expect(v.getState(3 - v.origin[0], g + 1 - v.origin[1], 3 - v.origin[2])).toMatch(/birch_log/);
  });
});
