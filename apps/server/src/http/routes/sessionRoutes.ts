import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionManager } from '../../session/SessionManager';

export function registerSessionRoutes(app: FastifyInstance, sm: SessionManager): void {
  app.post('/api/session/create', async () => {
    const session = sm.createSession();
    return { sessionId: session.id };
  });

  app.get('/api/session/current', async () => sm.current());

  app.post('/api/session/build', async (request: FastifyRequest) => sm.build(request.body));

  app.post('/api/session/validate', async (request: FastifyRequest) => sm.validate(request.body));

  app.post('/api/session/apply-patch', async (request: FastifyRequest) => {
    const body = request.body as { patch?: unknown } | unknown[];
    const patch = Array.isArray(body) ? body : body?.patch;
    return sm.applyPatch(patch);
  });

  app.get('/api/session/preview-data', async () => sm.getPreviewData());

  app.get('/api/session/preview.png', async (_request: FastifyRequest, reply: FastifyReply) => {
    const png = await sm.renderImage();
    return reply.type('image/png').send(png);
  });

  app.get('/api/session/list', async () => sm.list());

  app.post('/api/session/select', async (request: FastifyRequest) => {
    const { sessionId } = (request.body ?? {}) as { sessionId?: string };
    sm.select(String(sessionId ?? ''));
    return { ok: true };
  });

  app.post('/api/session/delete', async (request: FastifyRequest) => {
    const { sessionId } = (request.body ?? {}) as { sessionId?: string };
    sm.deleteSession(String(sessionId ?? ''));
    return { ok: true };
  });
}
