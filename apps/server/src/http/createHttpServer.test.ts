import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { fantasyHouseDemo } from '@minecraft-schematic-lab/build-spec';
import type { AppConfig } from '../config';
import { GitProjectService } from '../git/GitProjectService';
import { SessionManager } from '../session/SessionManager';
import { createHttpServer } from './createHttpServer';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 8765,
  baseUrl: 'http://127.0.0.1:8765',
  mcpMode: true,
  webDist: '/nonexistent-web-dist',
};

let app: FastifyInstance;

beforeAll(async () => {
  const sm = new SessionManager(config, new GitProjectService());
  app = await createHttpServer(sm, config);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('HTTP server', () => {
  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, name: 'minecraft-schematic-lab' });
  });

  it('builds the demo spec', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/session/build', payload: fantasyHouseDemo });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.blockCount).toBeGreaterThan(0);
  });

  it('returns preview data sized to the demo', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session/preview-data' });
    expect(res.statusCode).toBe(200);
    expect(res.json().size).toEqual({ x: 21, y: 16, z: 19 });
  });

  it('renders a preview PNG', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session/preview.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('exports a .schem download', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session/export.schem' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('.schem');
  });

  it('reports invalid specs without throwing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/session/build', payload: { nope: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
  });

  it('applies a JSON patch round-trip', async () => {
    await app.inject({ method: 'POST', url: '/api/session/build', payload: fantasyHouseDemo });
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/apply-patch',
      payload: { patch: [{ op: 'replace', path: '/palette/wall', value: 'minecraft:oak_planks' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().spec.palette.wall).toBe('minecraft:oak_planks');
    expect(res.json().stats.palette).toContain('minecraft:oak_planks');
  });

  it('rejects a non-array patch with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/apply-patch',
      payload: { patch: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a patch that makes the spec invalid with 422', async () => {
    await app.inject({ method: 'POST', url: '/api/session/build', payload: fantasyHouseDemo });
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/apply-patch',
      payload: { patch: [{ op: 'replace', path: '/size/x', value: 0 }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('lists, rejects unknown select, and deletes sessions', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/session/list' });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);

    const badSelect = await app.inject({
      method: 'POST',
      url: '/api/session/select',
      payload: { sessionId: 'does-not-exist' },
    });
    expect(badSelect.statusCode).toBe(404);

    const created = await app.inject({ method: 'POST', url: '/api/session/create' });
    const newId = created.json().sessionId as string;
    const del = await app.inject({
      method: 'POST',
      url: '/api/session/delete',
      payload: { sessionId: newId },
    });
    expect(del.statusCode).toBe(200);
  });
});
