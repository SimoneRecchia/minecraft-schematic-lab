import type { FastifyInstance } from 'fastify';
import { APP_VERSION } from '@minecraft-schematic-lab/shared';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    ok: true,
    name: 'minecraft-schematic-lab',
    version: APP_VERSION,
  }));
}
