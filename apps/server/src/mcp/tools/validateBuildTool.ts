import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildSpecSchema } from '@minecraft-schematic-lab/build-spec';
import { messageOf } from '../../httpError';
import { errorResult, textResult, type McpDeps } from '../toolHelpers';

export function registerValidateBuildTool(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'validate_build',
    {
      title: 'Validate build',
      description:
        'Validate a BuildSpec without changing the current build. Returns validity, errors and warnings (e.g. unknown block ids or out-of-bounds operations).',
      inputSchema: { spec: buildSpecSchema },
    },
    async (args) => {
      try {
        return textResult(deps.sessionManager.validate(args.spec));
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
