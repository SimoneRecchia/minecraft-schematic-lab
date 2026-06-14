import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { APP_VERSION } from '@minecraft-schematic-lab/shared';
import type { McpDeps } from './toolHelpers';
import { registerCreateBuildTool } from './tools/createBuildTool';
import { registerGetCurrentBuildTool } from './tools/getCurrentBuildTool';
import { registerValidateBuildTool } from './tools/validateBuildTool';
import { registerApplyPatchTool } from './tools/applyPatchTool';
import { registerRenderPreviewTool } from './tools/renderPreviewTool';
import { registerRenderImageTool } from './tools/renderImageTool';
import { registerExportSchematicTool } from './tools/exportSchematicTool';
import { registerGitProjectTools } from './tools/gitProjectTool';
import { registerSessionTools } from './tools/sessionTools';

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'minecraft-schematic-lab', version: APP_VERSION });
  registerCreateBuildTool(server, deps);
  registerGetCurrentBuildTool(server, deps);
  registerValidateBuildTool(server, deps);
  registerApplyPatchTool(server, deps);
  registerRenderPreviewTool(server, deps);
  registerRenderImageTool(server, deps);
  registerExportSchematicTool(server, deps);
  registerGitProjectTools(server, deps);
  registerSessionTools(server, deps);
  return server;
}

export async function startMcpServer(deps: McpDeps): Promise<McpServer> {
  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());
  return server;
}
