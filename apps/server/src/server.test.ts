import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import Ajv2020 from 'ajv/dist/2020.js';
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
import { buildMcpServer } from './mcp/server';

process.env.MSL_HOME = mkdtempSync(join(tmpdir(), 'msl-test-'));
process.env.MSL_NO_BROWSER = '1';

/** No game assets in tests: textures fail fast, the compiler doesn't need them. */
const offlineAssets = {
  ensure: () => Promise.reject(new Error('offline')),
  peek: () => undefined,
  getStatus: (version: string) => ({ version, state: 'error' }),
  bake: () => Promise.reject(new Error('offline')),
} as unknown as AssetStore;

// Port 80 matches the Host header app.inject sends by default (localhost:80).
const config: AppConfig = {
  host: '127.0.0.1',
  port: 80,
  baseUrl: 'http://127.0.0.1:80',
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

describe('who may call the server', () => {
  const post = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/build', headers, payload: { spec: medievalCottage } });

  it('answers this computer: the viewer, curl and Claude', async () => {
    expect(
      (await app.inject({ url: '/api/health', headers: { host: '127.0.0.1:80' } })).statusCode,
    ).toBe(200);
    expect(
      (await post({ origin: 'http://localhost:80', 'sec-fetch-site': 'same-origin' })).statusCode,
    ).toBe(200);
  });

  it('refuses other websites, also through DNS rebinding', async () => {
    expect(
      (await app.inject({ url: '/api/health', headers: { host: 'evil.example:80' } })).statusCode,
    ).toBe(403);
    expect((await post({ origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
  });
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

describe('MCP tools', () => {
  it('give every tool a valid schema, a title and the annotations the directory asks for', async () => {
    const server = buildMcpServer({ builds, config });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const { tools } = await client.listTools();
    expect(tools.length).toBe(14);
    // The Claude API checks each schema as JSON Schema 2020-12 and drops a tool whose schema fails
    // (e.g. a draft-07 tuple, `items: [...]`), whatever `$schema` the SDK writes.
    const ajv = new Ajv2020({ strict: false });
    for (const tool of tools) {
      const { $schema: _draft, ...schema } = tool.inputSchema as Record<string, unknown>;
      expect(ajv.validateSchema(schema), `${tool.name}: ${ajv.errorsText()}`).toBe(true);
      expect(tool.title, tool.name).toBeTruthy();
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean');
      if (!tool.annotations?.readOnlyHint) {
        expect(typeof tool.annotations?.destructiveHint, tool.name).toBe('boolean');
      }
    }
    await client.close();
  });
});

describe('redstone', () => {
  const spec = {
    name: 'switch',
    minecraftVersion: '1.21.4',
    operations: [
      { type: 'blocks', id: 'lever', block: 'lever[face=floor,facing=east]', at: [[0, 0, 0]] },
      { type: 'line', id: 'dust', from: [1, 0, 0], to: [3, 0, 0], block: 'redstone_wire' },
      { type: 'blocks', id: 'lamp', block: 'redstone_lamp', at: [[4, 0, 0]] },
    ],
    circuit: {
      inputs: { S: { at: [0, 0, 0] } },
      outputs: { L: { at: [4, 0, 0] } },
      tests: [{ name: 'lights', steps: [{ set: { S: 1 } }, { expect: { L: 1 } }] }],
    },
  };

  it('reports the tests in the build summary and runs ad-hoc ones', async () => {
    const out = await builds.create(spec);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(builds.summary(out.build)).toContain('Tests: 1/1 passed');
    const r = builds.simulate({
      tests: [
        {
          name: 'delay',
          steps: [
            { set: { S: 1 } },
            { wait: 1 },
            { set: { S: 0 } },
            { expect: { L: 0 }, within: 8 },
          ],
        },
      ],
      locations: 4,
    });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain('L=0 after 4 ticks');
    expect(r.text).toContain('Same results at 4 world positions.');
    expect(r.text).toContain('At rest: S=0, L=0');
  });

  it('explains malformed tests instead of running them', () => {
    const r = builds.simulate({ tests: [{ name: 'x', steps: [{ fly: 1 }] }] });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Unknown step/);
  });

  it('serves what the viewer needs to run the same simulation', async () => {
    const sim = (await app.inject({ url: '/api/build/sim' })).json();
    expect(sim.version).toBe('1.21.4');
    expect(sim.fullCubes).toContain('stone');
    expect(sim.circuit.outputs.L.at).toEqual([4, 0, 0]);
  });
});

describe('saving an export into a Minecraft folder', () => {
  it('never overwrites a file that is already there', () => {
    process.env.MINECRAFT_DIR = mkdtempSync(join(tmpdir(), 'msl-minecraft-'));
    const first = builds.saveExport('schem', 'worldedit').path;
    const second = builds.saveExport('schem', 'worldedit').path;
    expect(second).not.toBe(first);
    expect(second.endsWith(' (2).schem')).toBe(true);
  });
});
