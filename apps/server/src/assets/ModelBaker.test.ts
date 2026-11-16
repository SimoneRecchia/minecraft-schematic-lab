import { describe, expect, it } from 'vitest';
import { ModelBaker, textureName } from './ModelBaker';
import type { PackData } from './buildPack';

const pane = (texture: unknown): PackData => ({
  manifest: { version: 'test', textures: ['missing', 'white_stained_glass'], alpha: [0, 2], avg: [0, 0xffffff], columns: 64 },
  blockstates: { white_stained_glass_pane: { variants: { '': { model: 'block/white_stained_glass_pane_post' } } } },
  models: {
    'block/white_stained_glass_pane_post': {
      textures: { pane: texture },
      elements: [{ from: [7, 0, 7], to: [9, 16, 9], faces: { north: { texture: '#pane' } } }],
    },
  },
});

describe('ModelBaker texture values', () => {
  it('reads a texture written as a plain sprite name', () => {
    expect(textureName('minecraft:block/white_stained_glass')).toBe('minecraft:block/white_stained_glass');
  });

  it('reads a texture written as { sprite, force_translucent } (newer client jars)', () => {
    expect(textureName({ sprite: 'minecraft:block/white_stained_glass', force_translucent: true })).toBe(
      'minecraft:block/white_stained_glass',
    );
    expect(textureName({ force_translucent: true })).toBeUndefined();
  });

  it('bakes a model whose texture is an object, using its sprite', () => {
    const object = new ModelBaker(pane({ sprite: 'minecraft:block/white_stained_glass', force_translucent: true }));
    const string = new ModelBaker(pane('minecraft:block/white_stained_glass'));
    const baked = object.bake('minecraft:white_stained_glass_pane');
    expect(baked).toEqual(string.bake('minecraft:white_stained_glass_pane'));
    expect(baked.v.length).toBeGreaterThan(0);
  });
});
