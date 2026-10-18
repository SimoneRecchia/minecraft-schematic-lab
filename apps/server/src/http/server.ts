import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { listVersions } from '@minecraft-schematic-lab/catalog';
import type { ExportFormat } from '@minecraft-schematic-lab/formats';
import {
  APP_VERSION,
  type CameraState,
  type FeedbackItem,
  type Vec3,
} from '@minecraft-schematic-lab/shared';
import type { AssetStore } from '../assets/AssetStore';
import type { AppConfig } from '../config';
import { UserError, type BuildService } from '../core/BuildService';
import type { CaptureBroker } from '../core/CaptureBroker';
import type { EventHub } from '../core/EventHub';

export interface HttpDeps {
  builds: BuildService;
  assets: AssetStore;
  hub: EventHub;
  capture: CaptureBroker;
  config: AppConfig;
}

const FORMATS = new Set(['schem', 'schem3', 'schematic', 'litematic', 'nbt', 'materials']);

function vec(q: Record<string, string | undefined>, ...keys: [string, string, string]): Vec3 {
  const v = keys.map((k) => Number.parseInt(q[k] ?? '', 10));
  if (v.some((n) => Number.isNaN(n))) throw new UserError(`Query needs ${keys.join(', ')}.`);
  return v as Vec3;
}

export async function createHttpServer({
  builds,
  assets,
  hub,
  capture,
  config,
}: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });

  app.setErrorHandler((error, _req, reply) => {
    const status =
      error instanceof UserError
        ? error.status
        : ((error as { statusCode?: number }).statusCode ?? 500);
    reply.status(status).send({ error: error instanceof Error ? error.message : String(error) });
  });

  app.get('/api/health', async () => ({
    ok: true,
    name: 'vibeschem',
    version: APP_VERSION,
  }));

  // ------------------------------------------------------------------ live events
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const client = hub.add(res);
    hub.send(client, {
      type: 'hello',
      clientId: client.id,
      buildId: builds.current?.buildId ?? null,
    });
    req.raw.on('close', () => res.end());
  });

  app.post('/api/client/:id/state', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { visible?: boolean; camera?: CameraState };
    hub.update(id, {
      ...(body.visible !== undefined ? { visible: body.visible } : {}),
      ...(body.camera ? { camera: body.camera } : {}),
    });
    return { ok: true };
  });

  // ------------------------------------------------------------------ build
  app.get('/api/build', async () => ({ build: builds.header() }));

  // Same as the MCP create_build / edit_build tools, for scripts and the first-run HTTP path.
  app.post('/api/build', async (req, reply) => {
    const { spec, newProject, label } = (req.body ?? {}) as {
      spec?: unknown;
      newProject?: boolean;
      label?: string;
    };
    const out = await builds.create(spec ?? req.body, {
      newProject: newProject ?? true,
      ...(label ? { label } : {}),
    });
    if (!out.ok) return reply.status(422).send({ ok: false, errors: out.errors });
    return { ok: true, summary: builds.summary(out.build), build: builds.header() };
  });

  app.post('/api/build/edit', async (req, reply) => {
    const { edits, patch, label } = (req.body ?? {}) as {
      edits?: never[];
      patch?: never[];
      label?: string;
    };
    const out = await builds.edit({
      ...(edits ? { edits } : {}),
      ...(patch ? { patch } : {}),
      ...(label ? { label } : {}),
    });
    if (!out.ok) return reply.status(422).send({ ok: false, errors: out.errors });
    return { ok: true, summary: builds.summary(out.build), build: builds.header() };
  });

  app.get('/api/render.png', async (req, reply) => {
    const q = req.query as {
      views?: string;
      size?: string;
      cutY?: string;
      from?: string;
      to?: string;
    };
    const parse = (v: string) => v.split(',').map(Number) as Vec3;
    const r = await builds.render({
      views: (q.views?.split(',') ?? ['iso']) as never[],
      size: Number(q.size ?? 640),
      ...(q.cutY ? { cutY: Number(q.cutY) } : {}),
      ...(q.from && q.to ? { focus: { from: parse(q.from), to: parse(q.to) } } : {}),
    });
    return reply.header('content-type', 'image/png').send(r.images[0]?.png);
  });

  app.get('/api/build/volume', async (req, reply) => {
    const { buildId } = req.query as { buildId?: string };
    const cur = builds.requireCurrent();
    if (buildId && buildId !== cur.buildId)
      throw new UserError('That build is no longer current.', 409);
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-encoding', 'gzip')
      .header('cache-control', 'no-store')
      .send(builds.volumeGz());
  });

  app.get('/api/build/inspect', async (req) =>
    builds.inspectAt(vec(req.query as Record<string, string>, 'x', 'y', 'z')),
  );

  app.get('/api/build/spec', async () => builds.requireCurrent().record.spec);

  app.post('/api/build/version', async (req, reply) => {
    const { version, apply } = (req.body ?? {}) as { version?: string; apply?: boolean };
    if (!version) throw new UserError('Missing "version".');
    const out = await builds.changeVersion(version, Boolean(apply));
    if (!out.ok) return reply.status(422).send({ ok: false, errors: out.errors });
    return { ok: true, build: builds.header() };
  });

  app.get('/api/versions', async () =>
    listVersions().map((v) => ({
      id: v.id,
      major: v.major,
      legacy: v.legacy,
      dataVersion: v.dataVersion,
    })),
  );

  // ------------------------------------------------------------------ history & projects
  app.get('/api/history', async () => (builds.current ? builds.history() : []));

  app.post('/api/history/restore', async (req, reply) => {
    const { n } = (req.body ?? {}) as { n?: number };
    const out = await builds.restore(Number(n));
    if (!out.ok) return reply.status(422).send({ ok: false, errors: out.errors });
    return { ok: true };
  });

  app.get('/api/projects', async () => ({
    current: builds.current?.project.id ?? null,
    projects: builds.projects(),
  }));

  app.post('/api/projects/:id/open', async (req) => {
    const { id } = req.params as { id: string };
    await builds.open(id);
    return { ok: true };
  });

  app.post('/api/projects/:id/rename', async (req) => {
    const { id } = req.params as { id: string };
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name?.trim()) throw new UserError('Missing "name".');
    return builds.rename(id, name.trim());
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    builds.remove(id);
    return { ok: true };
  });

  // ------------------------------------------------------------------ feedback
  app.get('/api/feedback', async () => builds.feedback());

  app.post('/api/feedback', async (req) => {
    const body = (req.body ?? {}) as Partial<FeedbackItem> & { text?: string };
    if (!body.text?.trim()) throw new UserError('Write what you would like to change.');
    return builds.addFeedback({ ...body, text: body.text.trim() });
  });

  app.post('/api/feedback/:id/resolve', async (req) => {
    const { id } = req.params as { id: string };
    return builds.resolveFeedback([id]);
  });

  app.delete('/api/feedback/:id', async (req) => {
    const { id } = req.params as { id: string };
    builds.deleteFeedback(id);
    return { ok: true };
  });

  // ------------------------------------------------------------------ export
  app.get('/api/export', async () => ({
    formats: builds.formats(),
    targets: builds.exportTargets(),
  }));

  app.get('/api/export/:format', async (req, reply) => {
    const { format } = req.params as { format: string };
    if (!FORMATS.has(format)) throw new UserError(`Unknown format "${format}".`);
    const out = builds.export(format as ExportFormat);
    return reply
      .header('content-type', out.mime)
      .header('content-disposition', `attachment; filename="${out.filename}"`)
      .header('x-export-warnings', encodeURIComponent(out.warnings.join(' | ')))
      .send(out.buffer);
  });

  app.post('/api/export/:format/save', async (req) => {
    const { format } = req.params as { format: string };
    const { target } = (req.body ?? {}) as { target?: 'worldedit' | 'litematica' | 'downloads' };
    if (!FORMATS.has(format)) throw new UserError(`Unknown format "${format}".`);
    return builds.saveExport(format as ExportFormat, target ?? 'downloads');
  });

  // ------------------------------------------------------------------ game assets
  app.get('/api/assets/:version/status', async (req) => {
    const { version } = req.params as { version: string };
    return assets.getStatus(version);
  });

  app.get('/api/assets/:version/manifest', async (req) => {
    const { version } = req.params as { version: string };
    const pack = await assets.ensure(version);
    return pack.data.manifest;
  });

  app.get('/api/assets/:version/atlas.png', async (req, reply) => {
    const { version } = req.params as { version: string };
    const pack = await assets.ensure(version);
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=86400')
      .send(pack.atlas);
  });

  app.post('/api/assets/:version/models', async (req) => {
    const { version } = req.params as { version: string };
    const { states } = (req.body ?? {}) as { states?: string[] };
    if (!Array.isArray(states)) throw new UserError('Missing "states".');
    return assets.bake(version, states.slice(0, 20_000));
  });

  // ------------------------------------------------------------------ captures from the viewer
  app.post('/api/capture/:requestId', async (req) => {
    const { requestId } = req.params as { requestId: string };
    const body = (req.body ?? {}) as { images?: { view: string; png: string }[]; error?: string };
    const images = body.images?.map((i) => ({
      view: i.view,
      png: Buffer.from(i.png.replace(/^data:image\/png;base64,/, ''), 'base64'),
    }));
    return { ok: capture.fulfill(requestId, images ?? null, body.error) };
  });

  // ------------------------------------------------------------------ viewer
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: `Not found: ${req.method} ${req.url}` });
    });
  }

  setInterval(() => hub.heartbeat(), 20_000).unref();
  return app;
}
