import type { BuildSpec } from './types';

/**
 * A timber-framed cottage on a small meadow: stone plinth, framed walls, shuttered windows, a
 * mixed dark-oak gable roof with eaves trim, a chimney, a path, trees and flowers.
 */
export const medievalCottage: BuildSpec = {
  name: 'Medieval Cottage',
  minecraftVersion: '1.21.4',
  palette: {
    plinth: { mix: { cobblestone: 6, mossy_cobblestone: 2, andesite: 1 }, scale: 2 },
    infill: { mix: { white_terracotta: 5, calcite: 2 }, scale: 2 },
    post: 'stripped_spruce_log',
    roof: { mix: { dark_oak_stairs: 4, spruce_stairs: 1 }, scale: 3 },
    flowers: {
      mix: { short_grass: 8, poppy: 1, dandelion: 1, oxeye_daisy: 1, cornflower: 1, fern: 2 },
    },
  },
  operations: [
    {
      id: 'ground',
      type: 'terrain',
      from: [-8, -3, -8],
      to: [18, -3, 15],
      shape: 'flat',
      height: 2,
      edgeFalloff: false,
    },
    { id: 'path', type: 'box', from: [4, -1, 7], to: [6, -1, 15], block: 'dirt_path' },
    { id: 'plinth', type: 'box', from: [0, 0, 0], to: [10, 0, 6], block: 'plinth' },
    { id: 'walls', type: 'box', from: [0, 1, 0], to: [10, 4, 6], block: 'infill', walls: true },
    {
      id: 'frame',
      type: 'group',
      operations: [
        {
          type: 'blocks',
          block: 'post',
          at: [
            [0, 1, 0],
            [0, 2, 0],
            [0, 3, 0],
            [10, 1, 0],
            [10, 2, 0],
            [10, 3, 0],
            [0, 1, 6],
            [0, 2, 6],
            [0, 3, 6],
            [10, 1, 6],
            [10, 2, 6],
            [10, 3, 6],
            [5, 1, 0],
            [5, 2, 0],
            [5, 3, 0],
          ],
        },
        { type: 'line', from: [0, 4, 0], to: [10, 4, 0], block: 'post[axis=x]' },
        { type: 'line', from: [0, 4, 6], to: [10, 4, 6], block: 'post[axis=x]' },
        { type: 'line', from: [0, 4, 0], to: [0, 4, 6], block: 'post[axis=z]' },
        { type: 'line', from: [10, 4, 0], to: [10, 4, 6], block: 'post[axis=z]' },
      ],
    },
    {
      id: 'windows',
      type: 'group',
      symmetry: { z: 3 },
      operations: [
        { type: 'box', from: [2, 2, 6], to: [3, 3, 6], block: 'glass_pane' },
        { type: 'box', from: [7, 2, 6], to: [8, 3, 6], block: 'glass_pane' },
        {
          type: 'blocks',
          block: 'spruce_trapdoor[open=true,facing=south,half=top]',
          at: [
            [1, 2, 7],
            [1, 3, 7],
            [4, 2, 7],
            [4, 3, 7],
            [6, 2, 7],
            [6, 3, 7],
            [9, 2, 7],
            [9, 3, 7],
          ],
        },
        {
          type: 'blocks',
          block: 'spruce_trapdoor[facing=north,half=top]',
          at: [
            [2, 1, 7],
            [3, 1, 7],
            [7, 1, 7],
            [8, 1, 7],
          ],
        },
      ],
    },
    { id: 'door', type: 'blocks', block: 'spruce_door[facing=north]', at: [[5, 1, 6]] },
    {
      id: 'roof',
      type: 'roof',
      shape: 'gable',
      from: [0, 5, 0],
      to: [10, 5, 6],
      block: 'roof',
      overhang: 1,
      gable: 'spruce_planks',
      eaves: 'spruce_stairs',
    },
    { id: 'chimney', type: 'box', from: [11, 0, 2], to: [12, 10, 3], block: 'bricks' },
    {
      id: 'chimney_cap',
      type: 'blocks',
      block: 'campfire[lit=true,signal_fire=false]',
      at: [[11, 11, 2]],
    },
    { id: 'tree_west', type: 'tree', kind: 'oak', at: [-5, 0, 10], seed: 4 },
    { id: 'tree_east', type: 'tree', kind: 'big_oak', at: [15, 0, -4], seed: 9 },
    {
      id: 'flowers',
      type: 'scatter',
      from: [-8, -1, -8],
      to: [18, 0, 15],
      on: ['grass_block'],
      block: 'flowers',
      density: 0.18,
    },
  ],
  metadata: { style: 'medieval', prompt: 'a cozy timber-framed cottage with a dark oak roof' },
};

/** A round stone watchtower: battered plinth, arrow slits, machicolations, crenellated parapet, steep cone roof. */
export const stoneWatchtower: BuildSpec = {
  name: 'Stone Watchtower',
  minecraftVersion: '1.21.4',
  palette: {
    masonry: {
      mix: { stone_bricks: 6, cracked_stone_bricks: 2, mossy_stone_bricks: 1, andesite: 1 },
      scale: 2,
    },
    base: { mix: { cobblestone: 3, mossy_cobblestone: 2, cobbled_deepslate: 1 }, scale: 2 },
  },
  operations: [
    { id: 'plinth', type: 'cylinder', center: [0, 0, 0], radius: 5, height: 2, block: 'base' },
    {
      id: 'shaft',
      type: 'cylinder',
      center: [0, 2, 0],
      radius: 4,
      height: 14,
      block: 'masonry',
      hollow: true,
    },
    {
      id: 'slits',
      type: 'group',
      repeat: { count: 1, offset: [0, 0, 0] },
      symmetry: { x: 0, z: 0 },
      operations: [
        { type: 'box', from: [0, 6, -4], to: [0, 8, -4], block: 'air' },
        { type: 'box', from: [-4, 11, 0], to: [-4, 13, 0], block: 'air' },
      ],
    },
    {
      id: 'machicolations',
      type: 'script',
      code: [
        'const r = 5;',
        'for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {',
        '  const d = Math.hypot(x, z);',
        '  if (d >= r + 0.5 || d < r - 0.5) continue;',
        '  const facing = Math.abs(x) >= Math.abs(z) ? (x > 0 ? "west" : "east") : (z > 0 ? "north" : "south");',
        '  set(x, 15, z, `stone_brick_stairs[half=top,facing=${facing}]`);',
        '  set(x, 16, z, "masonry");',
        '  if ((x + z) % 2 === 0) set(x, 17, z, "masonry");',
        '}',
      ].join('\n'),
    },
    {
      id: 'floor',
      type: 'cylinder',
      center: [0, 16, 0],
      radius: 4,
      height: 1,
      block: 'spruce_planks',
    },
    {
      id: 'roof',
      type: 'roof',
      shape: 'cone',
      center: [0, 18, 0],
      radius: 3,
      block: 'deepslate_tile_stairs',
      pitch: 2,
      overhang: 1,
      ridge: 'lightning_rod',
    },
  ],
  metadata: { style: 'medieval' },
};

export const exampleSpecs: Record<string, BuildSpec> = {
  [medievalCottage.name]: medievalCottage,
  [stoneWatchtower.name]: stoneWatchtower,
};
