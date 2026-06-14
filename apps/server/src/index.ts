import { existsSync } from 'node:fs';
import { loadConfig } from './config';
import { GitProjectService } from './git/GitProjectService';
import { createHttpServer } from './http/createHttpServer';
import { startMcpServer } from './mcp/createMcpServer';
import { SessionManager } from './session/SessionManager';

async function main(): Promise<void> {
  const config = loadConfig();
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
