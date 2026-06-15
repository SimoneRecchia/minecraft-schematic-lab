import { describe, expect, it } from 'vitest';
import { colorFor, isTransparent } from './blockColor';

describe('colorFor', () => {
  it('gives colored variants distinct colors by dye prefix', () => {
    expect(colorFor('minecraft:red_concrete')).not.toBe(colorFor('minecraft:green_concrete'));
    expect(colorFor('minecraft:blue_wool')).not.toBe(colorFor('minecraft:yellow_wool'));
    expect(colorFor('minecraft:red_concrete')).toBe(colorFor('minecraft:red_wool')); // same dye → same color
    expect(colorFor('minecraft:red_concrete')).toBe(colorFor('red_concrete')); // namespace optional
  });

  it('distinguishes two-word dye colors from their single-word siblings', () => {
    expect(colorFor('minecraft:light_blue_concrete')).not.toBe(colorFor('minecraft:blue_concrete'));
    expect(colorFor('minecraft:light_gray_terracotta')).not.toBe(
      colorFor('minecraft:gray_terracotta'),
    );
  });

  it('still resolves plain (non-dyed) blocks', () => {
    expect(colorFor('minecraft:stone')).toMatch(/^(#|hsl)/);
    expect(colorFor('minecraft:spruce_planks')).toMatch(/^(#|hsl)/);
  });

  it('flags transparent blocks', () => {
    expect(isTransparent('minecraft:glass')).toBe(true);
    expect(isTransparent('minecraft:stone')).toBe(false);
  });
});
