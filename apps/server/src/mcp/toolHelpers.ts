import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AppConfig } from '../config';
import type { SessionManager } from '../session/SessionManager';

export interface McpDeps {
  sessionManager: SessionManager;
  config: AppConfig;
}

export function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function imageResult(png: Buffer, caption?: string): CallToolResult {
  const content: CallToolResult['content'] = [];
  if (caption) content.push({ type: 'text', text: caption });
  content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
  return { content };
}
