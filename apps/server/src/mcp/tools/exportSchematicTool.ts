import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { messageOf } from '../../httpError';
import { errorResult, textResult, type McpDeps } from '../toolHelpers';

export function registerExportSchematicTool(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'export_schematic',
    {
      title: 'Export schematic',
      description:
        'Export the current build to a WorldEdit Sponge .schem file. Returns the filename, size and a download URL the user can click in the browser. Defaults to Sponge v2 (most compatible); pass version 3 for the newer format.',
      inputSchema: { version: z.union([z.literal(2), z.literal(3)]).optional() },
    },
    async (args) => {
      try {
        const version = args.version ?? 2;
        const { buffer, filename } = await deps.sessionManager.exportSchematic(version);
        return textResult({
          filename,
          version,
          size: buffer.length,
          downloadUrl: `${deps.config.baseUrl}/api/session/export.schem?version=${version}`,
        });
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
