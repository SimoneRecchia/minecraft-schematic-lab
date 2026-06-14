import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SchematicVersion } from '../../schematic/schematicTypes';
import type { SessionManager } from '../../session/SessionManager';

export function registerExportRoutes(app: FastifyInstance, sm: SessionManager): void {
  app.get('/api/session/export.schem', async (request: FastifyRequest, reply: FastifyReply) => {
    const { version } = request.query as { version?: string };
    const schematicVersion: SchematicVersion = version === '3' ? 3 : 2;
    const { buffer, filename } = await sm.exportSchematic(schematicVersion);
    return reply
      .type('application/octet-stream')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });
}
