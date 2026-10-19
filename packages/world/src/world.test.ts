import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeChunk, packIndices, stateIn, unpackIndices } from './chunk';
import { lz4BlockStreamDecode } from './lz4';
import { RegionFile } from './region';
import { listWorlds, readWorld } from './saves';
import { columnHeights, readWorldSite } from './site';
import { encodeChunk, makeWorld } from './testWorld';
import { copyWorld, writeBlocks } from './writeWorld';

const tmp = mkdtempSync(join(tmpdir(), 'vibeschem-world-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Rolling hills: stone, then dirt, then grass at 62 + a gentle slope; an oak log at (5, z, 5). */
function hills(x: number, y: number, z: number): string {
  const ground = 62 + Math.floor(x / 8);
  if (x === 5 && z === 5 && y > ground && y <= ground + 4) return 'minecraft:oak_log[axis=y]';
  if (x === 5 && z === 5 && y === ground + 5)
    return 'minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]';
  if (y > ground) return y <= 60 ? 'minecraft:water[level=0]' : 'minecraft:air';
  if (y === ground) return 'minecraft:grass_block[snowy=false]';
  if (y > ground - 3) return 'minecraft:dirt';
  return 'minecraft:stone';
}

const chunks: [number, number][] = [];
for (let cx = -2; cx <= 1; cx++) for (let cz = -2; cz <= 1; cz++) chunks.push([cx, cz]);

describe('bit packing', () => {
  it('round-trips spanning and non-spanning layouts', () => {
    for (const spanning of [true, false])
      for (const bits of [4, 5, 6, 9, 13]) {
        const values = Uint16Array.from({ length: 4096 }, (_, i) => (i * 7919) % (1 << bits));
        const words = packIndices(values, bits, spanning);
        expect(Array.from(unpackIndices(words, bits, 4096, spanning))).toEqual(Array.from(values));
      }
  });
});

describe('LZ4 (region compression 4)', () => {
  it('decodes lz4-java block streams with literals and matches', () => {
    const header = (method: number, compressed: number, original: number) => {
      const h = Buffer.alloc(21);
      h.write('LZ4Block', 0, 'latin1');
      h[8] = method;
      h.writeInt32LE(compressed, 9);
      h.writeInt32LE(original, 13);
      return h;
    };
    // "abc" + match(offset 3, length 9) + literals "XYZWV" -> "abcabcabcabcXYZWV"
    const block = Buffer.from([
      0x35, 0x61, 0x62, 0x63, 0x03, 0x00, 0x50, 0x58, 0x59, 0x5a, 0x57, 0x56,
    ]);
    const raw = Buffer.from('raw!');
    const stream = Buffer.concat([
      header(0x20, block.length, 17),
      block,
      header(0x10, raw.length, raw.length),
      raw,
      header(0x10, 0, 0),
    ]);
    expect(lz4BlockStreamDecode(stream).toString('latin1')).toBe('abcabcabcabcXYZWVraw!');
  });
});

describe('region files', () => {
  it('keeps untouched chunks byte for byte and moves huge chunks to .mcc files', () => {
    const r = new RegionFile(0, 0);
    r.write(0, 0, encodeChunk(0, 0, 3955, 3, 4, hills));
    r.write(3, 1, encodeChunk(3, 1, 3955, 3, 4, hills));
    const big = Buffer.alloc(1_200_000, 7);
    r.chunks[RegionFile.index(5, 5)] = { type: 3, payload: big, timestamp: 1 };
    const { region, external } = r.serialize();
    expect([...external.keys()]).toEqual(['c.5.5.mcc']);
    const back = RegionFile.parse(
      region,
      0,
      0,
      (cx, cz) => external.get(`c.${cx}.${cz}.mcc`) ?? null,
    );
    expect(back.read(5, 5)?.length).toBe(big.length);
    expect(Buffer.compare(back.chunks[0]!.payload, r.chunks[0]!.payload)).toBe(0);
    expect(stateIn(decodeChunk(back.read(3, 1)!), 0, 62 + 6, 0)).toBe(
      'minecraft:grass_block[snowy=false]',
    );
  });
});

describe('Java worlds', () => {
  const saves = join(tmp, 'saves');
  const w121 = makeWorld(saves, {
    name: 'Hills 1.21',
    dataVersion: 3955,
    versionName: '1.21.1',
    chunks,
    minSection: -4,
    maxSection: 19,
    fn: hills,
    player: [4, 70, -3],
  });
  const w26 = makeWorld(saves, {
    name: 'New Layout',
    dataVersion: 4786,
    versionName: '26.1',
    modern: true,
    chunks,
    minSection: -4,
    maxSection: 19,
    fn: hills,
    player: [10, 66, 10],
  });
  const w116 = makeWorld(saves, {
    name: 'Old 1.15',
    dataVersion: 2230,
    versionName: '1.15.2',
    chunks,
    minSection: 0,
    maxSection: 7,
    fn: hills,
  });

  it('lists worlds with their version and where the player stands', () => {
    process.env.MSL_SAVES = saves;
    try {
      const worlds = listWorlds('/nonexistent');
      const names = worlds.map((w) => w.name).sort();
      expect(names).toEqual(['Hills 1.21', 'New Layout', 'Old 1.15']);
    } finally {
      delete process.env.MSL_SAVES;
    }
    const a = readWorld(w121);
    expect(a).toMatchObject({
      version: '1.21.1',
      dataVersion: 3955,
      cheats: true,
      gameMode: 'creative',
    });
    expect(a?.player).toEqual({ pos: [4, 70, -3], dimension: 'minecraft:overworld' });
    expect(a?.dimensions).toEqual(['minecraft:overworld']);
    // 26.1 keeps dimensions under dimensions/ and the player under players/data.
    const b = readWorld(w26);
    expect(b?.player?.pos).toEqual([10, 66, 10]);
    expect(b?.dimensions).toEqual(['minecraft:overworld']);
  });

  for (const [label, dir, version] of [
    ['1.21', w121, '1.21.1'],
    ['26.1 layout', w26, '26.1'],
    ['1.15 (spanning)', w116, '1.15.2'],
  ] as const) {
    it(`reads a site around a point (${label})`, () => {
      const site = readWorldSite(dir, { center: [0, 0], radius: 12, below: 4, above: 20 });
      expect(site.version).toBe(version);
      expect(site.size[0]).toBe(25);
      expect(site.size[2]).toBe(25);
      // centre column x=0: ground at 62, so BuildSpec y=0 is world y 63
      expect(site.origin).toEqual([0, 63, 0]);
      const h = columnHeights(site.palette, site.data, site.size);
      const col = (x: number, z: number) =>
        x - site.worldMin[0] + site.size[0] * (z - site.worldMin[2]);
      expect((h.ground[col(0, 0)] as number) + site.worldMin[1]).toBe(62);
      expect((h.ground[col(-12, 0)] as number) + site.worldMin[1]).toBe(62 - 2);
      // the tree is not ground; its top is
      expect((h.ground[col(5, 5)] as number) + site.worldMin[1]).toBe(62);
      expect((h.top[col(5, 5)] as number) + site.worldMin[1]).toBe(62 + 5);
      expect(site.worldMin[1]).toBe(60 - 4);
      expect(site.writable).toBe(true);
    });
  }

  it('writes changes into a copy and leaves the original alone', async () => {
    const before = readFileSync(join(w121, 'region', 'r.0.0.mca'));
    const copy = await copyWorld(w121, 'Hills 1.21 - VibeSchem');
    expect(copy.folder).toBe('Hills 1.21 - VibeSchem');
    expect(readWorld(copy.path)?.name).toBe('Hills 1.21 - VibeSchem');
    const report = writeBlocks(copy.path, 'minecraft:overworld', [
      { x: 0, y: 63, z: 0, state: 'minecraft:gold_block' },
      { x: -1, y: 62, z: -1, state: 'minecraft:air' },
      {
        x: 2,
        y: 63,
        z: 2,
        state: 'minecraft:chest[facing=north,type=single,waterlogged=false]',
        nbt: { Items: [{ Slot: '0b', id: 'minecraft:apple', count: 2 }] },
      },
      { x: 3, y: 300, z: 3, state: 'minecraft:glass' },
    ]);
    expect(report).toMatchObject({ blocks: 4, regions: 2 });
    expect(Buffer.compare(readFileSync(join(w121, 'region', 'r.0.0.mca')), before)).toBe(0);
    const site = readWorldSite(copy.path, { center: [0, 0], radius: 8 });
    const at = (x: number, y: number, z: number) =>
      site.palette[
        site.data[
          x -
            site.worldMin[0] +
            site.size[0] * (z - site.worldMin[2] + site.size[2] * (y - site.worldMin[1]))
        ] as number
      ];
    expect(at(0, 63, 0)).toBe('minecraft:gold_block');
    expect(at(-1, 62, -1)).toBe('minecraft:air');
    expect(at(1, 62, 1)).toBe('minecraft:grass_block[snowy=false]');
    expect(site.blockEntities).toHaveLength(1);
    expect(site.blockEntities[0]).toMatchObject({ id: 'minecraft:chest' });
    const chunk = decodeChunk(
      RegionFile.parse(readFileSync(join(copy.path, 'region', 'r.0.0.mca')), 0, 0).read(0, 0)!,
    );
    expect(chunk.root.isLightOn).toEqual({ t: 'byte', v: 0 });
    expect(stateIn(chunk, 3, 300, 3)).toBe('minecraft:glass');
  });

  it('refuses to write into chunks that were never generated', () => {
    expect(() =>
      writeBlocks(w121, 'minecraft:overworld', [
        { x: 500, y: 64, z: 500, state: 'minecraft:stone' },
      ]),
    ).toThrow(/never generated/);
  });

  it('refuses to write worlds saved before 1.14', () => {
    const w113 = makeWorld(saves, {
      name: 'Ancient',
      dataVersion: 1631,
      versionName: '1.13.2',
      chunks: [[0, 0]],
      minSection: 0,
      maxSection: 4,
      fn: hills,
    });
    expect(() =>
      writeBlocks(w113, 'minecraft:overworld', [{ x: 1, y: 64, z: 1, state: 'minecraft:stone' }]),
    ).toThrow(/1\.14/);
  });
});
