import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { medievalCottage } from '@minecraft-schematic-lab/build-spec';
import type { AssetStore } from './assets/AssetStore';
import type { AppConfig } from './config';
import { BuildService } from './core/BuildService';
import { CaptureBroker } from './core/CaptureBroker';
import { EventHub } from './core/EventHub';
import { ProjectStore } from './core/ProjectStore';
import { createHttpServer } from './http/server';

process.env.MSL_HOME = mkdtempSync(join(tmpdir(), 'msl-test-'));
process.env.MSL_NO_BROWSER = '1';

/** No game assets in tests: textures fail fast, the compiler doesn't need them. */
const offlineAssets = {
  ensure: () => Promise.reject(new Error('offline')),
  peek: () => undefined,
  getStatus: (version: string) => ({ version, state: 'error' }),
  bake: () => Promise.reject(new Error('offline')),
} as unknown as AssetStore;

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  baseUrl: 'http://127.0.0.1:0',
  mcpMode: false,
  webDist: '/nonexistent',
  guidesDir: join(import.meta.dirname, '..', 'guides'),
};

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

describe('build API', () => {
  it('creates a build and serves its header and voxel data', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/build',
      payload: { spec: medievalCottage },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatch(/Medieval Cottage/);
    const header = (await app.inject({ url: '/api/build' })).json().build;
    expect(header.n).toBe(1);
    const vol = await app.inject({
      url: `/api/build/volume?buildId=${encodeURIComponent(header.buildId)}`,
    });
    const data = new Uint16Array(new Uint8Array(gunzipSync(vol.rawPayload)).buffer);
    expect(data.length).toBe(header.size[0] * header.size[1] * header.size[2]);
  });

  it('rejects invalid specs with precise errors and keeps the previous build', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/build',
      payload: { spec: { ...medievalCottage, minecraftVersion: '1.12.2' }, newProject: false },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors.join(' ')).toMatch(/calcite does not exist in 1\.12\.2/);
    expect((await app.inject({ url: '/api/build' })).json().build.minecraftVersion).toBe('1.21.4');
  });

  it('edits by operation id and records versions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/edit',
      payload: {
        edits: [{ op: 'update', id: 'roof', set: { block: 'spruce_stairs' } }],
        label: 'spruce roof',
      },
    });
    expect(res.statusCode).toBe(200);
    const history = (await app.inject({ url: '/api/history' })).json();
    expect(history.map((v: { label: string }) => v.label)).toEqual([
      'Initial build',
      'spruce roof',
    ]);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/build/edit',
      payload: { edits: [{ op: 'remove', ids: ['nope'] }] },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0]).toMatch(/Known ids: .*roof/);
  });

  it('inspects blocks with their source operation', async () => {
    const hit = (await app.inject({ url: '/api/build/inspect?x=0&y=0&z=0' })).json();
    expect(hit.state).toMatch(/cobblestone|andesite/);
    expect(hit.source).toMatch(/plinth/);
    expect(builds.inspectRegion([0, 0, 0], [10, 2, 0], 'z')).toMatch(/Placed by:/);
  });

  it('stores feedback with the block and operation under it', async () => {
    const note = (
      await app.inject({
        method: 'POST',
        url: '/api/feedback',
        payload: { text: 'Taller roof', pos: [5, 8, 3] },
      })
    ).json();
    expect(note.source).toMatch(/roof/);
    expect(builds.resolveFeedback([note.id], 'Done')[0]?.status).toBe('resolved');
  });

  it('checks a version change and applies it only when every block exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/version',
      payload: { version: '1.16.5', apply: false },
    });
    expect(res.statusCode).toBe(422);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/build/version',
      payload: { version: '1.21.1', apply: true },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('exports every available format', async () => {
    const { formats } = (await app.inject({ url: '/api/export' })).json();
    for (const f of formats.filter((x: { available: boolean }) => x.available)) {
      const res = await app.inject({ url: `/api/export/${f.id}` });
      expect(res.statusCode, f.id).toBe(200);
      expect(res.rawPayload.length, f.id).toBeGreaterThan(50);
    }
  });

  it('lists and reopens projects', async () => {
    const list = (await app.inject({ url: '/api/projects' })).json();
    expect(list.projects.length).toBeGreaterThan(0);
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${list.projects[0].id}/open`,
    });
    expect(res.statusCode).toBe(200);
  });
});
