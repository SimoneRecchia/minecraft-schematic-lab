import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { messageOf } from '../../httpError';
import { errorResult, textResult, type McpDeps } from '../toolHelpers';

export function registerRenderPreviewTool(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'render_preview',
    {
      title: 'Render preview (data)',
      description:
        'Return a compact summary of the current build: size and a per-block-state count, plus the viewer URL and the image preview URL.',
    },
    async () => {
      try {
        const preview = deps.sessionManager.getPreviewData();
        const counts: Record<string, number> = {};
        for (const [state, positions] of Object.entries(preview.instances)) {
          counts[state] = positions.length;
        }
        return textResult({
          size: preview.size,
          blocks: counts,
          previewUrl: `${deps.config.baseUrl}/`,
          previewImageUrl: `${deps.config.baseUrl}/api/session/preview.png`,
        });
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
