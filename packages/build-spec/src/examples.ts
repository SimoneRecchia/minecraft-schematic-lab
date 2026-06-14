import type { BuildSpec } from './types';

/**
 * A cozy fantasy cottage. The walls' south face sits at z=15 while the gable roof overhangs to
 * z=17, so the south window must attach to the wall plane (z=15), not the roof eave.
 */
export const fantasyHouseDemo: BuildSpec = {
  id: 'fantasy-house',
  name: 'Fantasy Cottage',
  minecraftVersion: '1.21',
  size: { x: 21, y: 16, z: 19 },
  palette: {
    foundation: 'minecraft:cobblestone',
    wall: 'minecraft:spruce_planks',
    roof: 'minecraft:dark_oak_stairs',
    glass: 'minecraft:glass_pane',
    frame: 'minecraft:stripped_spruce_log',
  },
  operations: [
    { type: 'box', from: [1, 0, 0], to: [19, 1, 15], block: 'foundation' },
    { type: 'hollow_box', from: [1, 2, 0], to: [19, 9, 15], block: 'wall' },
    { type: 'gable_roof', from: [1, 9, 0], to: [19, 15, 17], axis: 'x', block: 'roof', overhang: 1 },
    {
      type: 'window_pattern',
      side: 'south',
      y: 4,
      positions: [4, 9, 14],
      width: 3,
      height: 4,
      glassBlock: 'glass',
      frameBlock: 'frame',
    },
  ],
  metadata: { style: 'fantasy', prompt: 'a cozy spruce cottage with a dark oak gable roof' },
};

/** A round stone watchtower with a stepped conical cap. */
export const stoneWatchtower: BuildSpec = {
  id: 'stone-watchtower',
  name: 'Stone Watchtower',
  minecraftVersion: '1.21',
  size: { x: 15, y: 26, z: 15 },
  palette: {
    base: 'minecraft:cobblestone',
    wall: 'minecraft:stone_bricks',
    cap: 'minecraft:mossy_stone_bricks',
  },
  operations: [
    { type: 'cylinder', center: [7, 0, 7], radius: 6, height: 1, block: 'base' },
    { type: 'cylinder', center: [7, 1, 7], radius: 6, height: 17, block: 'wall', hollow: true },
    { type: 'cylinder', center: [7, 18, 7], radius: 6, height: 1, block: 'cap' },
    { type: 'cylinder', center: [7, 19, 7], radius: 5, height: 1, block: 'cap' },
    { type: 'cylinder', center: [7, 20, 7], radius: 4, height: 1, block: 'cap' },
    { type: 'cylinder', center: [7, 21, 7], radius: 3, height: 1, block: 'cap' },
    { type: 'cylinder', center: [7, 22, 7], radius: 2, height: 1, block: 'cap' },
    { type: 'cylinder', center: [7, 23, 7], radius: 1, height: 2, block: 'cap' },
  ],
  metadata: { style: 'medieval' },
};

/** A small log cabin with a roof along the Z axis, a fenced porch rail and east-facing windows. */
export const logCabin: BuildSpec = {
  id: 'log-cabin',
  name: 'Log Cabin',
  minecraftVersion: '1.21',
  size: { x: 17, y: 13, z: 15 },
  palette: {
    floor: 'minecraft:spruce_planks',
    wall: 'minecraft:spruce_log',
    roof: 'minecraft:dark_oak_planks',
    rail: 'minecraft:spruce_fence',
    glass: 'minecraft:glass_pane',
  },
  operations: [
    { type: 'box', from: [0, 0, 1], to: [12, 0, 13], block: 'floor' },
    { type: 'hollow_box', from: [0, 1, 1], to: [12, 7, 13], block: 'wall' },
    { type: 'gable_roof', from: [0, 7, 1], to: [12, 12, 13], axis: 'z', block: 'roof', overhang: 1 },
    { type: 'wall_rect', from: [13, 1, 1], to: [16, 1, 13], block: 'rail', hollow: false },
    {
      type: 'window_pattern',
      side: 'east',
      y: 3,
      positions: [4, 9],
      width: 2,
      height: 3,
      glassBlock: 'glass',
    },
  ],
  metadata: { style: 'rustic' },
};

/** Exercises the geometric operations: pyramid, replace, hollow sphere, a glowing core and a ramp. */
export const featureShowcase: BuildSpec = {
  id: 'feature-showcase',
  name: 'Feature Showcase',
  minecraftVersion: '1.21',
  size: { x: 25, y: 25, z: 25 },
  palette: {
    stone: 'minecraft:stone',
    gold: 'minecraft:gold_block',
    dome: 'minecraft:glass',
    core: 'minecraft:glowstone',
    path: 'minecraft:smooth_stone',
  },
  operations: [
    { type: 'pyramid', from: [0, 0, 0], to: [16, 8, 16], block: 'stone' },
    { type: 'replace', from: [0, 0, 0], to: [16, 0, 16], target: 'stone', block: 'gold' },
    { type: 'sphere', center: [8, 15, 8], radius: 5, block: 'dome', hollow: true },
    { type: 'box', from: [7, 14, 7], to: [9, 16, 9], block: 'core' },
    { type: 'ramp', from: [17, 0, 4], to: [24, 8, 12], axis: 'x', block: 'path' },
  ],
  metadata: { style: 'showcase' },
};

export const exampleSpecs: Record<string, BuildSpec> = {
  [fantasyHouseDemo.id]: fantasyHouseDemo,
  [stoneWatchtower.id]: stoneWatchtower,
  [logCabin.id]: logCabin,
  [featureShowcase.id]: featureShowcase,
};
