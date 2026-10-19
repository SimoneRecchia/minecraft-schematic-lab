import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSchematic, readZip } from '@minecraft-schematic-lab/formats';
import { readWorldSite } from '@minecraft-schematic-lab/world';
import { makeWorld } from '@minecraft-schematic-lab/world/testing';
import type { AssetStore } from './assets/AssetStore';
import type { AppConfig } from './config';
import { BuildService } from './core/BuildService';
import { CaptureBroker } from './core/CaptureBroker';
import { EventHub } from './core/EventHub';
import { ProjectStore } from './core/ProjectStore';
import { createHttpServer } from './http/server';

const home = mkdtempSync(join(tmpdir(), 'msl-sites-'));
process.env.MSL_HOME = join(home, 'app');
process.env.MSL_NO_BROWSER = '1';
process.env.MSL_SAVES = join(home, 'saves');
process.env.MINECRAFT_DIR = join(home, 'no-launcher');

const offlineAssets = {
  ensure: () => Promise.reject(new Error('offline')),
  peek: () => undefined,
  getStatus: (version: string) => ({ version, state: 'error' }),
  bake: () => Promise.reject(new Error('offline')),
} as unknown as AssetStore;

const config: AppConfig = {
  host: '127.0.0.1',
  port: 80,
  baseUrl: 'http://127.0.0.1:80',
  mcpMode: false,
  webDist: '/nonexistent',
  guidesDir: join(import.meta.dirname, '..', 'guides'),
};

/** Grass at y=64 sloping up eastwards, a birch at (3, 3). */
function land(x: number, y: number, z: number): string {
  const g = 64 + Math.floor(x / 6);
  if (x === 3 && z === 3 && y > g && y <= g + 4) return 'minecraft:birch_log[axis=y]';
  if (y > g) return 'minecraft:air';
  if (y === g) return 'minecraft:grass_block[snowy=false]';
  return y > g - 3 ? 'minecraft:dirt' : 'minecraft:stone';
}

const chunks: [number, number][] = [];
for (let cx = -2; cx <= 1; cx++) for (let cz = -2; cz <= 1; cz++) chunks.push([cx, cz]);
const worldDir = makeWorld(join(home, 'saves'), {
  name: 'Valle',
  dataVersion: 4189,
  versionName: '1.21.4',
  chunks,
  minSection: -4,
  maxSection: 19,
  fn: land,
  player: [2, 65, -1],
});

let app: FastifyInstance;
let builds: BuildService;

beforeAll(async () => {
  const hub = new EventHub();
  builds = new BuildService(new ProjectStore(), offlineAssets, hub, new CaptureBroker(hub), config);
  app = await createHttpServer({
    builds,
    assets: offlineAssets,
    hub,
    capture: new CaptureBroker(hub),
    config,
  });
});

afterAll(async () => {
  await app.close();
});

describe('building on a world', () => {
  it('lists the worlds and imports the area around the player', async () => {
    const worlds = (await app.inject({ url: '/api/worlds' })).json();
    expect(worlds).toHaveLength(1);
    expect(worlds[0]).toMatchObject({
      name: 'Valle',
      version: '1.21.4',
      player: { pos: [2, 65, -1] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/sites/import',
      payload: { world: worlds[0].id, radius: 12 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.site).toMatchObject({
      kind: 'world',
      world: 'Valle',
      version: '1.21.4',
      writable: true,
    });
    // centred where the player stands: their feet are BuildSpec y = 0
    expect(body.site.origin).toEqual([2, 65, -1]);
    expect(body.build.site.changes).toBe(0);
    const report = builds.terrain();
    expect(report).toContain('BuildSpec (0,0,0) = world (2, 65, -1)');
    expect(report).toMatch(/Trees: 1 \(birch_log\)/);
    expect(report).toContain('Height map');
  });

  it('builds on the terrain and exports only the changes, in place', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/edit',
      payload: {
        edits: [
          {
            op: 'add',
            operations: [
              { id: 'plot', type: 'flatten', from: [-4, 0, -4], to: [4, 0, 4], level: 0, blend: 2 },
              {
                id: 'hut',
                type: 'box',
                from: [-2, 0, -2],
                to: [2, 3, 2],
                block: 'oak_planks',
                hollow: true,
              },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const header = res.json().build;
    expect(header.site.changes).toBeGreaterThan(50);
    const mask = gunzipSync((await app.inject({ url: '/api/build/changes' })).rawPayload);
    expect(mask.length).toBe(header.size[0] * header.size[1] * header.size[2]);

    const schem = readSchematic(builds.export('schem').buffer, 'x.schem');
    expect(schem.worldOrigin).not.toBeNull();
    // the hut's corner (-2, 0, -2) is world (0, 65, -3): inside the exported box
    const [ox, oy, oz] = schem.worldOrigin as [number, number, number];
    const at = (x: number, y: number, z: number) =>
      schem.palette[
        schem.data[x - ox + schem.size[0] * (z - oz + schem.size[2] * (y - oy))] as number
      ];
    expect(at(0, 65, -3)).toBe('minecraft:oak_planks');

    const pack = readZip(builds.export('datapack').buffer);
    const fn = [...pack.keys()].find((k) => k.endsWith('/build_1.mcfunction')) as string;
    expect(pack.get(fn)?.toString()).toContain('minecraft:oak_planks');
    expect(pack.get(fn)?.toString()).toMatch(
      /fill 0 65 -3 4 65 1 minecraft:oak_planks|minecraft:oak_planks/,
    );
  });

  it('installs the data pack into the world and writes a copy of the world', async () => {
    const inst = (
      await app.inject({ method: 'POST', url: '/api/export/datapack/install', payload: {} })
    ).json();
    expect(inst.functionId).toMatch(/^vibeschem:/);
    expect(existsSync(join(inst.path, 'pack.mcmeta'))).toBe(true);
    expect(readdirSync(join(worldDir, 'datapacks'))).toHaveLength(1);

    const copy = (
      await app.inject({ method: 'POST', url: '/api/export/world', payload: {} })
    ).json();
    expect(copy.name).toBe('Valle (VibeSchem v2)');
    const site = readWorldSite(copy.path, { center: [2, -1], radius: 6 });
    const idx = (x: number, y: number, z: number) =>
      x -
      site.worldMin[0] +
      site.size[0] * (z - site.worldMin[2] + site.size[2] * (y - site.worldMin[1]));
    expect(site.palette[site.data[idx(0, 65, -3)] as number]).toBe('minecraft:oak_planks');
    // the original world is unchanged
    const original = readWorldSite(worldDir, { center: [2, -1], radius: 6 });
    expect(original.palette[original.data[idx(0, 65, -3)] as number]).toBe('minecraft:air');
  });

  it('imports a schematic as the site', async () => {
    const schem = builds.export('schem').buffer;
    const res = await app.inject({
      method: 'POST',
      url: '/api/sites/import-file',
      payload: { filename: 'hut.schem', data: schem.toString('base64') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().site).toMatchObject({
      kind: 'schematic',
      file: 'hut.schem',
      writable: false,
    });
    await expect(builds.exportWorldCopy()).rejects.toThrow(/imported from a world/);
  });
});
