import { describe, expect, it } from 'vitest';
import nbt from 'prismarine-nbt';
import { BlockVolume } from '@minecraft-schematic-lab/block-compiler';
import type { BuildSpec } from '@minecraft-schematic-lab/build-spec';
import { writeSpongeSchematic } from './writeSpongeSchematic';

function specOf(size: { x: number; y: number; z: number }): BuildSpec {
  return { id: 't', name: 'Test Build', minecraftVersion: '1.21', size, palette: {}, operations: [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parse(buffer: Buffer): Promise<any> {
  const { parsed } = await nbt.parse(buffer);
  return nbt.simplify(parsed);
}

describe('writeSpongeSchematic', () => {
  it('writes a valid Sponge v2 schematic', async () => {
    const volume = new BlockVolume(3, 3, 3);
    volume.forEachYZX((x, y, z) => void volume.setBlock(x, y, z, 'minecraft:stone'));
    const buffer = await writeSpongeSchematic(specOf({ x: 3, y: 3, z: 3 }), volume);
    expect(buffer.length).toBeGreaterThan(0);

    const data = await parse(buffer);
    expect(data.Version).toBe(2);
    expect(data.Width).toBe(3);
    expect(data.Height).toBe(3);
    expect(data.Length).toBe(3);
    expect(Object.keys(data.Palette)).toContain('minecraft:stone');
    expect(data.BlockData.length).toBe(27);
  });

  it('keeps air in the palette for a partial volume', async () => {
    const volume = new BlockVolume(3, 3, 3);
    volume.setBlock(1, 1, 1, 'minecraft:stone');
    const buffer = await writeSpongeSchematic(specOf({ x: 3, y: 3, z: 3 }), volume);
    const data = await parse(buffer);
    expect(Object.keys(data.Palette)).toContain('minecraft:air');
    expect(Object.keys(data.Palette)).toContain('minecraft:stone');
  });

  it('emits the nested Schematic.Blocks structure for v3', async () => {
    const volume = new BlockVolume(2, 2, 2);
    volume.setBlock(0, 0, 0, 'minecraft:stone');
    const buffer = await writeSpongeSchematic(specOf({ x: 2, y: 2, z: 2 }), volume, { version: 3 });
    const data = await parse(buffer);
    expect(data.Schematic.Version).toBe(3);
    expect(Object.keys(data.Schematic.Blocks.Palette)).toContain('minecraft:stone');
    expect(data.Schematic.Blocks.Data.length).toBe(8);
  });

  it('embeds block entities with merged data in v2', async () => {
    const volume = new BlockVolume(2, 2, 2);
    volume.setBlock(0, 0, 0, 'minecraft:chest');
    const buffer = await writeSpongeSchematic(specOf({ x: 2, y: 2, z: 2 }), volume, {
      blockEntities: [{ pos: [0, 0, 0], id: 'minecraft:chest', data: { CustomName: 'Loot' } }],
    });
    const data = await parse(buffer);
    expect(data.BlockEntities).toHaveLength(1);
    expect(data.BlockEntities[0].Id).toBe('minecraft:chest');
    expect(data.BlockEntities[0].CustomName).toBe('Loot');
  });
});
