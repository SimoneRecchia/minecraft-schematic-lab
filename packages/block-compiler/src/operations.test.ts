import { describe, expect, it } from 'vitest';
import type { BuildSpec } from '@minecraft-schematic-lab/build-spec';
import { compileBuildSpec } from './compileBuildSpec';

function spec(operations: BuildSpec['operations'], size: BuildSpec['size']): BuildSpec {
  return { id: 't', name: 'T', minecraftVersion: '1.21', size, palette: {}, operations };
}

describe('operations', () => {
  it('wall_rect places a perimeter when hollow and a full slab when solid', () => {
    const perimeter = compileBuildSpec(
      spec(
        [{ type: 'wall_rect', from: [0, 0, 0], to: [4, 0, 4], block: 'minecraft:stone' }],
        { x: 5, y: 1, z: 5 },
      ),
    );
    expect(perimeter.blockCount).toBe(16); // 25 - inner 9

    const filled = compileBuildSpec(
      spec(
        [
          {
            type: 'wall_rect',
            from: [0, 0, 0],
            to: [4, 0, 4],
            block: 'minecraft:stone',
            hollow: false,
          },
        ],
        { x: 5, y: 1, z: 5 },
      ),
    );
    expect(filled.blockCount).toBe(25);
  });

  it('cylinder hollow places fewer blocks than solid', () => {
    const size = { x: 9, y: 1, z: 9 };
    const solid = compileBuildSpec(
      spec(
        [{ type: 'cylinder', center: [4, 0, 4], radius: 4, height: 1, block: 'minecraft:stone' }],
        size,
      ),
    );
    const hollow = compileBuildSpec(
      spec(
        [
          {
            type: 'cylinder',
            center: [4, 0, 4],
            radius: 4,
            height: 1,
            block: 'minecraft:stone',
            hollow: true,
          },
        ],
        size,
      ),
    );
    expect(solid.blockCount).toBeGreaterThan(0);
    expect(hollow.blockCount).toBeLessThan(solid.blockCount);
  });

  it('gable_roof along z slopes from the eaves to the ridge', () => {
    const result = compileBuildSpec(
      spec(
        [{ type: 'gable_roof', from: [0, 0, 0], to: [4, 2, 6], axis: 'z', block: 'minecraft:stone' }],
        { x: 5, y: 3, z: 7 },
      ),
    );
    // Eaves on the bottom layer at the X edges, ridge at the top in the middle.
    expect(result.volume.getBlock(0, 0, 3)).toBe('minecraft:stone');
    expect(result.volume.getBlock(4, 0, 3)).toBe('minecraft:stone');
    expect(result.volume.getBlock(2, 2, 3)).toBe('minecraft:stone');
  });

  it('window_pattern carves glass into the wall plane', () => {
    const result = compileBuildSpec(
      spec(
        [
          { type: 'hollow_box', from: [0, 0, 0], to: [6, 5, 4], block: 'minecraft:stone' },
          {
            type: 'window_pattern',
            side: 'south',
            y: 2,
            positions: [3],
            width: 1,
            height: 2,
            glassBlock: 'minecraft:glass',
          },
        ],
        { x: 7, y: 6, z: 5 },
      ),
    );
    expect(result.volume.getBlock(3, 2, 4)).toBe('minecraft:glass');
  });

  it('window_pattern warns when there is no wall', () => {
    const result = compileBuildSpec(
      spec(
        [
          {
            type: 'window_pattern',
            side: 'south',
            y: 2,
            positions: [2],
            width: 1,
            height: 1,
            glassBlock: 'minecraft:glass',
          },
        ],
        { x: 5, y: 5, z: 5 },
      ),
    );
    expect(result.warnings.some((w) => w.includes('no wall'))).toBe(true);
  });

  it('sphere hollow places fewer blocks than solid', () => {
    const size = { x: 11, y: 11, z: 11 };
    const solid = compileBuildSpec(
      spec([{ type: 'sphere', center: [5, 5, 5], radius: 4, block: 'minecraft:stone' }], size),
    );
    const hollow = compileBuildSpec(
      spec(
        [{ type: 'sphere', center: [5, 5, 5], radius: 4, block: 'minecraft:stone', hollow: true }],
        size,
      ),
    );
    expect(hollow.blockCount).toBeLessThan(solid.blockCount);
    expect(hollow.volume.getBlock(5, 5, 5)).toBe('minecraft:air');
  });

  it('pyramid narrows to an apex', () => {
    const result = compileBuildSpec(
      spec([{ type: 'pyramid', from: [0, 0, 0], to: [4, 2, 4], block: 'minecraft:stone' }], {
        x: 5,
        y: 3,
        z: 5,
      }),
    );
    expect(result.volume.getBlock(2, 2, 2)).toBe('minecraft:stone'); // apex
    expect(result.volume.getBlock(0, 2, 0)).toBe('minecraft:air'); // corner above base
  });

  it('ramp rises along its axis', () => {
    const result = compileBuildSpec(
      spec([{ type: 'ramp', from: [0, 0, 0], to: [4, 4, 0], axis: 'x', block: 'minecraft:stone' }], {
        x: 5,
        y: 5,
        z: 1,
      }),
    );
    expect(result.volume.getBlock(0, 0, 0)).toBe('minecraft:stone');
    expect(result.volume.getBlock(4, 4, 0)).toBe('minecraft:stone');
    expect(result.volume.getBlock(0, 4, 0)).toBe('minecraft:air');
  });

  it('replace only swaps the targeted block', () => {
    const result = compileBuildSpec(
      spec(
        [
          { type: 'box', from: [0, 0, 0], to: [2, 0, 2], block: 'minecraft:stone' },
          {
            type: 'replace',
            from: [0, 0, 0],
            to: [0, 0, 2],
            target: 'minecraft:stone',
            block: 'minecraft:gold_block',
          },
        ],
        { x: 3, y: 1, z: 3 },
      ),
    );
    expect(result.volume.getBlock(0, 0, 0)).toBe('minecraft:gold_block');
    expect(result.volume.getBlock(2, 0, 0)).toBe('minecraft:stone');
  });

  it('block_entity registers a tile entity', () => {
    const result = compileBuildSpec(
      spec(
        [
          {
            type: 'block_entity',
            pos: [1, 1, 1],
            block: 'minecraft:chest',
            data: { CustomName: 'Loot' },
          },
        ],
        { x: 3, y: 3, z: 3 },
      ),
    );
    expect(result.blockEntities).toHaveLength(1);
    expect(result.blockEntities[0]?.id).toBe('minecraft:chest');
    expect(result.volume.getBlock(1, 1, 1)).toBe('minecraft:chest');
  });
});
