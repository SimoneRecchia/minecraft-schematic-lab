import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { messageOf } from '../../httpError';
import { errorResult, imageResult, type McpDeps } from '../toolHelpers';

export function registerRenderImageTool(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'render_image',
    {
      title: 'Render image',
      description:
        'Render the current build as an isometric PNG and return it as an image, so you can actually see the result and judge what to improve.',
    },
    async () => {
      try {
        const png = await deps.sessionManager.renderImage();
        const { stats } = deps.sessionManager.current();
        return imageResult(
          png,
          `Isometric preview — ${stats.blockCount} blocks, ${stats.size.x}x${stats.size.y}x${stats.size.z}.`,
        );
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
