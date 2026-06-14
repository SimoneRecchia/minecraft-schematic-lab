import { describe, expect, it } from 'vitest';
import { exampleSpecs, fantasyHouseDemo } from '@minecraft-schematic-lab/build-spec';
import type { BuildSpec } from '@minecraft-schematic-lab/build-spec';
import { compileBuildSpec } from './compileBuildSpec';

function specWith(operations: BuildSpec['operations'], size = { x: 5, y: 5, z: 5 }): BuildSpec {
  return {
    id: 't',
    name: 'Test',
    minecraftVersion: '1.21',
    size,
    palette: {},
    operations,
  };
}

describe('compileBuildSpec', () => {
  it('compiles the fantasy house demo', () => {
    const result = compileBuildSpec(fantasyHouseDemo);
    expect(result.blockCount).toBeGreaterThan(0);
    expect(result.palette.length).toBeGreaterThan(0);
  });

  it('fills a solid box with no warnings', () => {
    const result = compileBuildSpec(
      specWith(
        [{ type: 'box', from: [0, 0, 0], to: [2, 2, 2], block: 'minecraft:stone' }],
        { x: 3, y: 3, z: 3 },
      ),
    );
    expect(result.blockCount).toBe(27);
    expect(result.warnings).toEqual([]);
  });

  it('hollows a box leaving the interior empty', () => {
    const result = compileBuildSpec(
      specWith([{ type: 'hollow_box', from: [0, 0, 0], to: [4, 4, 4], block: 'minecraft:stone' }]),
    );
    expect(result.blockCount).toBe(125 - 27);
    expect(result.volume.getBlock(2, 2, 2)).toBe('minecraft:air');
  });

  it('warns for an unknown palette key that is not a valid block id', () => {
    const result = compileBuildSpec(
      specWith([{ type: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'wall' }]),
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('does not warn for a direct valid block id with an empty palette', () => {
    const result = compileBuildSpec(
      specWith([{ type: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'minecraft:dirt' }]),
    );
    expect(result.warnings).toEqual([]);
    expect(result.blockCount).toBe(8);
  });

  it('throws on an invalid spec', () => {
    expect(() => compileBuildSpec({ nope: true })).toThrow();
  });

  it('attaches demo windows to the wall plane z=15, not the roof eave z=17', () => {
    const result = compileBuildSpec(fantasyHouseDemo);
    const glass = result.volume.toInstanceGroups()['minecraft:glass_pane'] ?? [];
    expect(glass.length).toBeGreaterThan(0);
    expect(glass.every(([, , z]) => z === 15)).toBe(true);
  });

  it('compiles every example spec without throwing', () => {
    for (const spec of Object.values(exampleSpecs)) {
      expect(() => compileBuildSpec(spec)).not.toThrow();
    }
  });
});
