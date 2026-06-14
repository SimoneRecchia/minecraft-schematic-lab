import { describe, expect, it } from 'vitest';
import { BlockVolume } from '@minecraft-schematic-lab/block-compiler';
import { renderIsometric } from './renderIsometric';

describe('renderIsometric', () => {
  it('renders a PNG buffer', () => {
    const volume = new BlockVolume(4, 4, 4);
    volume.forEachYZX((x, y, z) => void volume.setBlock(x, y, z, 'minecraft:stone'));
    const png = renderIsometric(volume);
    // PNG magic number: 89 50 4E 47
    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.length).toBeGreaterThan(100);
  });

  it('renders an empty volume without throwing', () => {
    const png = renderIsometric(new BlockVolume(2, 2, 2));
    expect(png.length).toBeGreaterThan(0);
  });
});
