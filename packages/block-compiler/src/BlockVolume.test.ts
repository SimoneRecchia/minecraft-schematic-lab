import { describe, expect, it } from 'vitest';
import { AIR, BlockVolume, sortPair } from './BlockVolume';

describe('BlockVolume', () => {
  it('defaults all cells to air', () => {
    const v = new BlockVolume(3, 3, 3);
    expect(v.getBlock(1, 1, 1)).toBe(AIR);
    expect(v.countBlocks()).toBe(0);
    expect(v.getNonAirBounds()).toBeNull();
  });

  it('sets and gets blocks', () => {
    const v = new BlockVolume(3, 3, 3);
    expect(v.setBlock(1, 2, 0, 'minecraft:stone')).toBe(true);
    expect(v.getBlock(1, 2, 0)).toBe('minecraft:stone');
    expect(v.countBlocks()).toBe(1);
    expect(v.getPalette()).toEqual(['minecraft:stone']);
  });

  it('ignores and counts out-of-bounds writes', () => {
    const v = new BlockVolume(2, 2, 2);
    expect(v.setBlock(5, 0, 0, 'minecraft:stone')).toBe(false);
    expect(v.setBlock(-1, 0, 0, 'minecraft:stone')).toBe(false);
    expect(v.outOfBoundsWrites).toBe(2);
    expect(v.countBlocks()).toBe(0);
  });

  it('produces instance groups by state', () => {
    const v = new BlockVolume(2, 1, 1);
    v.setBlock(0, 0, 0, 'minecraft:stone');
    v.setBlock(1, 0, 0, 'minecraft:dirt');
    const groups = v.toInstanceGroups();
    expect(groups['minecraft:stone']).toEqual([[0, 0, 0]]);
    expect(groups['minecraft:dirt']).toEqual([[1, 0, 0]]);
  });

  it('computes non-air bounds', () => {
    const v = new BlockVolume(5, 5, 5);
    v.setBlock(1, 1, 1, 'minecraft:stone');
    v.setBlock(3, 4, 2, 'minecraft:stone');
    expect(v.getNonAirBounds()).toEqual({ min: [1, 1, 1], max: [3, 4, 2] });
  });

  it('sortPair orders ascending', () => {
    expect(sortPair(5, 2)).toEqual([2, 5]);
    expect(sortPair(1, 4)).toEqual([1, 4]);
  });
});
