import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { AssetStore } from './assets/AssetStore';
import { type AppConfig, loadConfig } from './config';
import { BuildService } from './core/BuildService';
import { CaptureBroker } from './core/CaptureBroker';
import { EventHub } from './core/EventHub';
import { ProjectStore } from './core/ProjectStore';
import { createHttpServer } from './http/server';
import { startMcpServer } from './mcp/server';

function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/** First free port from `start`, so several Claude Code sessions can each run their own server. */
async function findOpenPort(host: string, start: number, attempts = 20): Promise<number> {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(host, port)) return port;
  }
  return start;
}

/**
 * Listen on config.port or the next free one. Probing alone isn't enough: two servers started at
 * the same moment (two Claude Code sessions) both see the same port free, so retry when it's taken.
 */
async function listen(app: FastifyInstance, config: AppConfig): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    config.port = await findOpenPort(config.host, config.port);
    config.baseUrl = `http://${config.host}:${config.port}`;
    try {
      await app.listen({ host: config.host, port: config.port });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 20) throw error;
      config.port += 1;
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const hub = new EventHub();
  const assets = new AssetStore((s) =>
    hub.broadcast({
      type: 'assets',
      version: s.version,
      state: s.state,
      ...(s.message ? { message: s.message } : {}),
      ...(s.progress !== undefined ? { progress: s.progress } : {}),
    }),
  );
  const capture = new CaptureBroker(hub);
  const builds = new BuildService(new ProjectStore(), assets, hub, capture, config);
  await builds.init();

  const app = await createHttpServer({ builds, assets, hub, capture, config });
  await listen(app, config);

  if (config.mcpMode) {
    await startMcpServer({ builds, config });
    // stdout carries the MCP protocol — status goes to stderr only.
    const note = existsSync(config.webDist)
      ? ''
      : ' (run "pnpm build" once to enable the browser viewer)';
    process.stderr.write(
      `vibeschem: MCP ready; viewer on ${config.baseUrl}${note}\n`,
    );
  } else {
    process.stdout.write(`vibeschem listening on ${config.baseUrl}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `Fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
