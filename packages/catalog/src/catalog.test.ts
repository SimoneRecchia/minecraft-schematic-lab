import { describe, expect, it } from 'vitest';
import {
  assetVersionFor,
  blockAddedIn,
  getCatalog,
  LATEST_VERSION,
  listVersions,
  parseBlockState,
  resolveVersion,
  toLegacyIdMeta,
} from './index';

describe('versions', () => {
  it('lists releases newest first, from 1.8 up', () => {
    const versions = listVersions();
    expect(versions[0]).toBe(LATEST_VERSION);
    expect(versions.some((v) => v.id === '1.8.9')).toBe(true);
    expect(versions.some((v) => v.id === '1.21.4')).toBe(true);
  });

  it('resolves exact ids, families and latest', () => {
    expect(resolveVersion('1.20.1')?.dataVersion).toBe(3465);
    expect(resolveVersion('1.12.x')?.id).toBe('1.12.2');
    expect(resolveVersion('latest')).toBe(LATEST_VERSION);
    expect(resolveVersion('1.99')).toBeUndefined();
  });

  it('marks pre-flattening versions as legacy and previews them with 1.13.2 assets', () => {
    const v = resolveVersion('1.8.9');
    expect(v?.legacy).toBe(true);
    expect(assetVersionFor(v!)).toBe('1.13.2');
    expect(resolveVersion('1.13.2')?.legacy).toBe(false);
  });
});

describe('BlockCatalog', () => {
  it('completes a partial state with defaults, sorted', () => {
    const r = getCatalog('1.21.4').normalize('oak_stairs[facing=east]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state).toBe(
        'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]',
      );
      expect(r.explicit).toEqual(['facing']);
    }
  });

  it('rejects blocks from a newer version with the version it was added in', () => {
    const r = getCatalog('1.8.9').normalize('minecraft:purpur_block');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/added in 1\.9/);
    expect(getCatalog('1.12.2').normalize('white_concrete').ok).toBe(true);
    expect(getCatalog('1.11.2').normalize('white_concrete').ok).toBe(false);
    expect(getCatalog('1.16.5').normalize('deepslate_bricks').ok).toBe(false);
    expect(getCatalog('1.17.1').normalize('deepslate_bricks').ok).toBe(true);
  });

  it('rejects invalid properties and values with the allowed ones', () => {
    const cat = getCatalog('1.20.1');
    const bad = cat.normalize('oak_stairs[facing=up]');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/allowed: north, south, west, east/);
    const missing = cat.normalize('stone[axis=y]');
    expect(missing.ok).toBe(false);
  });

  it('maps renamed blocks across versions', () => {
    const old = getCatalog('1.16.5').normalize('dirt_path');
    expect(old.ok && old.name).toBe('grass_path');
    const modern = getCatalog('1.21.4').normalize('grass');
    expect(modern.ok && modern.name).toBe('short_grass');
  });

  it('suggests close names for typos', () => {
    const r = getCatalog('1.21.4').normalize('stone_brick');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/stone_bricks/);
  });

  it('knows when a block was added', () => {
    expect(blockAddedIn('cherry_planks')).toBe('1.20');
    expect(blockAddedIn('stone')).toBe('1.8');
  });

  it('knows full cubes for connection logic', () => {
    const cat = getCatalog('1.21.4');
    expect(cat.isFullCube('stone_bricks')).toBe(true);
    expect(cat.isFullCube('oak_fence')).toBe(false);
  });
});

describe('legacy mapping', () => {
  it('maps flattened states to numeric id:meta', () => {
    expect(toLegacyIdMeta('minecraft:granite')).toEqual({ id: 1, meta: 1 });
    expect(toLegacyIdMeta('minecraft:red_wool')).toEqual({ id: 35, meta: 14 });
    const stairs = toLegacyIdMeta(
      'minecraft:oak_stairs[facing=west,half=top,shape=outer_left,waterlogged=false]',
    );
    expect(stairs?.id).toBe(53);
    expect(stairs?.meta).toBe(5);
  });

  it('parses block states', () => {
    expect(parseBlockState('Minecraft:Oak_Log[axis=x]')).toEqual({
      namespace: 'minecraft',
      name: 'oak_log',
      props: { axis: 'x' },
    });
  });
});
