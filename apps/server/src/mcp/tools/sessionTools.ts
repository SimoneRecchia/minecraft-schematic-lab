import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { messageOf } from '../../httpError';
import { errorResult, textResult, type McpDeps } from '../toolHelpers';

export function registerSessionTools(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'list_sessions',
    {
      title: 'List sessions',
      description:
        'List the in-memory build sessions (each is an independent schematic) and which one is current.',
    },
    async () => {
      try {
        return textResult(deps.sessionManager.list());
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );

  server.registerTool(
    'select_session',
    {
      title: 'Select session',
      description: 'Make the given session the current one (subsequent tools act on it).',
      inputSchema: { sessionId: z.string() },
    },
    async (args) => {
      try {
        deps.sessionManager.select(args.sessionId);
        return textResult(deps.sessionManager.current());
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
