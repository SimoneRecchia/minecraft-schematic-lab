import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { messageOf } from '../../httpError';
import { errorResult, textResult, type McpDeps } from '../toolHelpers';

export function registerGetCurrentBuildTool(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'get_current_build',
    {
      title: 'Get current build',
      description:
        'Return the current BuildSpec, stats (block count, palette, size), warnings, the preview URL and the project status.',
    },
    async () => {
      try {
        return textResult(deps.sessionManager.current());
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
