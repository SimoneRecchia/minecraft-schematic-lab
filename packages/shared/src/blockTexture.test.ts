import { describe, expect, it } from 'vitest';
import { textureNameFor } from './blockTexture';

describe('textureNameFor', () => {
  it('resolves direct block textures', () => {
    expect(textureNameFor('minecraft:stone')).toBe('stone');
    expect(textureNameFor('red_concrete')).toBe('red_concrete');
    expect(textureNameFor('minecraft:oak_planks')).toBe('oak_planks');
    expect(textureNameFor('minecraft:glass')).toBe('glass');
  });

  it('maps partial blocks to their base material texture', () => {
    expect(textureNameFor('minecraft:oak_stairs')).toBe('oak_planks');
    expect(textureNameFor('minecraft:oak_slab')).toBe('oak_planks');
    expect(textureNameFor('minecraft:stone_brick_stairs')).toBe('stone_bricks');
    expect(textureNameFor('minecraft:cobblestone_wall')).toBe('cobblestone');
    expect(textureNameFor('minecraft:brick_stairs')).toBe('bricks');
  });

  it('returns null for blocks with no bundled texture', () => {
    expect(textureNameFor('minecraft:air')).toBeNull();
    expect(textureNameFor('minecraft:totally_made_up_block')).toBeNull();
  });
});
