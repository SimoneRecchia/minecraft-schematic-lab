import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { loadConfig } from './config';
import { GitProjectService } from './git/GitProjectService';
import { createHttpServer } from './http/createHttpServer';
import { startMcpServer } from './mcp/createMcpServer';
import { SessionManager } from './session/SessionManager';

/** Resolve whether a TCP port is free on the given host. */
function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/**
 * Find the first open port at/after `start`. Lets several Claude Code chats each run
 * their own server: if 8765 is already taken, this session moves to 8766, 8767, … instead
 * of crashing on EADDRINUSE.
 */
async function findOpenPort(host: string, start: number, attempts = 20): Promise<number> {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(host, port)) return port;
  }
  return start;
}

async function main(): Promise<void> {
  const config = loadConfig();

  const port = await findOpenPort(config.host, config.port);
  config.port = port;
  config.baseUrl = `http://${config.host}:${port}`;

  const git = new GitProjectService();
  const sessionManager = new SessionManager(config, git);

  const app = await createHttpServer(sessionManager, config);
  await app.listen({ host: config.host, port: config.port });

  if (config.mcpMode) {
    await startMcpServer({ sessionManager, config });
    // In MCP mode stdout carries the protocol — status goes to stderr only.
    const note = existsSync(config.webDist)
      ? ''
      : ' (run "pnpm build" once to enable the browser viewer)';
    process.stderr.write(
      `minecraft-schematic-lab: MCP stdio ready; viewer + API on ${config.baseUrl}${note}\n`,
    );
  } else {
    app.log.info(`minecraft-schematic-lab listening on ${config.baseUrl}`);
  }
}

main().catch((error) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Fatal: ${detail}\n`);
  process.exit(1);
});
