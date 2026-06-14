import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildSpecSchema } from '@minecraft-schematic-lab/build-spec';
import { openViewerOnce } from '../../openBrowser';
import { messageOf } from '../../httpError';
import { errorResult, textResult, type McpDeps } from '../toolHelpers';

export function registerCreateBuildTool(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'create_build',
    {
      title: 'Create build',
      description:
        'Compile a BuildSpec into a schematic and show it in the live browser preview (which opens automatically). Use this to build something from scratch or replace the current build.',
      inputSchema: { spec: buildSpecSchema },
    },
    async (args) => {
      try {
        const result = deps.sessionManager.build(args.spec);
        if (result.valid) {
          openViewerOnce(`${deps.config.baseUrl}/`);
        }
        return textResult({
          buildId: result.buildId,
          valid: result.valid,
          errors: result.errors,
          warnings: result.warnings,
          blockCount: result.blockCount,
          palette: result.palette,
          previewUrl: `${deps.config.baseUrl}/`,
          message: result.valid
            ? 'Build created. The browser preview should open automatically (and updates on its own).'
            : 'The spec has validation errors; fix them and try again.',
        });
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
