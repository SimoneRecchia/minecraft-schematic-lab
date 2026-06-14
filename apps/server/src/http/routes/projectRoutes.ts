import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SessionManager } from '../../session/SessionManager';

export function registerProjectRoutes(app: FastifyInstance, sm: SessionManager): void {
  app.post('/api/project/init-local', async (request: FastifyRequest) => {
    const { path } = (request.body ?? {}) as { path?: string };
    return sm.initLocalProject(String(path ?? ''));
  });

  app.post('/api/project/init-git', async (request: FastifyRequest) => {
    const { path, userName, userEmail } = (request.body ?? {}) as {
      path?: string;
      userName?: string;
      userEmail?: string;
    };
    return sm.initGitProject(String(path ?? ''), userName, userEmail);
  });

  app.post('/api/project/save-version', async (request: FastifyRequest) => {
    const { message } = (request.body ?? {}) as { message?: string };
    return sm.saveVersion(String(message ?? 'Update schematic'));
  });

  app.get('/api/project/status', async () => sm.projectStatus());

  app.get('/api/project/branches', async () => sm.branches());

  app.post('/api/project/branch', async (request: FastifyRequest) => {
    const { name, create } = (request.body ?? {}) as { name?: string; create?: boolean };
    return sm.branch(String(name ?? ''), Boolean(create));
  });

  app.post('/api/project/push', async (request: FastifyRequest) => {
    const { remote, remoteUrl } = (request.body ?? {}) as { remote?: string; remoteUrl?: string };
    return sm.push(remote ?? 'origin', remoteUrl);
  });
}
