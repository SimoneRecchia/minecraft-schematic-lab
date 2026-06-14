import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config';
import { messageOf, statusCodeOf } from '../httpError';
import type { SessionManager } from '../session/SessionManager';
import { registerExportRoutes } from './routes/exportRoutes';
import { registerHealthRoutes } from './routes/healthRoutes';
import { registerProjectRoutes } from './routes/projectRoutes';
import { registerSessionRoutes } from './routes/sessionRoutes';

const BODY_LIMIT = 8 * 1024 * 1024;

export async function createHttpServer(
  sm: SessionManager,
  config: AppConfig,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.mcpMode ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: BODY_LIMIT,
  });

  app.setErrorHandler((error, _request, reply) => {
    const status = statusCodeOf(error);
    reply.status(status).send({ error: messageOf(error) });
  });

  registerHealthRoutes(app);
  registerSessionRoutes(app, sm);
  registerExportRoutes(app, sm);
  registerProjectRoutes(app, sm);

  // Serve the built web viewer on the same port (SPA fallback for client-side routes).
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: `Not found: ${request.method} ${request.url}` });
    });
  }

  return app;
}
