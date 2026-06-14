import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { openViewerOnce } from '../../openBrowser';
import { messageOf } from '../../httpError';
import { errorResult, textResult, type McpDeps } from '../toolHelpers';

export function registerApplyPatchTool(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'apply_patch',
    {
      title: 'Apply patch',
      description:
        'Apply an RFC 6902 JSON Patch to the current BuildSpec and rebuild. Use this for incremental changes (e.g. swap a palette block, add an operation) instead of resending the whole spec.',
      inputSchema: { patch: z.array(z.unknown()) },
    },
    async (args) => {
      try {
        const result = deps.sessionManager.applyPatch(args.patch);
        openViewerOnce(`${deps.config.baseUrl}/`);
        return textResult(result);
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
