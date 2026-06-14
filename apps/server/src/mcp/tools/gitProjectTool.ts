import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { messageOf } from '../../httpError';
import { errorResult, textResult, type McpDeps } from '../toolHelpers';

export function registerGitProjectTools(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'init_git_project',
    {
      title: 'Initialize git project',
      description:
        'Turn a local folder (inside the home directory) into a git-versioned schematic project. Requires git to be installed. Writes the build spec + .schem and makes the first commit.',
      inputSchema: {
        projectPath: z.string(),
        userName: z.string().optional(),
        userEmail: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return textResult(
          await deps.sessionManager.initGitProject(args.projectPath, args.userName, args.userEmail),
        );
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );

  server.registerTool(
    'save_version',
    {
      title: 'Save version',
      description:
        'Write the current build to the git project folder and commit it with the given message.',
      inputSchema: { message: z.string() },
    },
    async (args) => {
      try {
        return textResult(await deps.sessionManager.saveVersion(args.message));
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );

  server.registerTool(
    'git_branch',
    {
      title: 'Git branch',
      description: 'Switch to a branch in the git project, optionally creating it first.',
      inputSchema: { name: z.string(), create: z.boolean().optional() },
    },
    async (args) => {
      try {
        return textResult(await deps.sessionManager.branch(args.name, args.create ?? false));
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );

  server.registerTool(
    'git_push',
    {
      title: 'Git push',
      description:
        'Push the git project to a remote. Optionally set the remote URL first (https or ssh). The user must have push access configured.',
      inputSchema: { remote: z.string().optional(), remoteUrl: z.string().optional() },
    },
    async (args) => {
      try {
        return textResult(await deps.sessionManager.push(args.remote ?? 'origin', args.remoteUrl));
      } catch (error) {
        return errorResult(messageOf(error));
      }
    },
  );
}
