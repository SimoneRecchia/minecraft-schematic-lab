import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config';
import { GitProjectService } from '../git/GitProjectService';
import { SessionManager } from '../session/SessionManager';
import { buildMcpServer } from './createMcpServer';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 8765,
  baseUrl: 'http://127.0.0.1:8765',
  mcpMode: true,
  webDist: '/nonexistent-web-dist',
};

describe('buildMcpServer', () => {
  it('registers all tools without throwing', () => {
    const sessionManager = new SessionManager(config, new GitProjectService());
    expect(() => buildMcpServer({ sessionManager, config })).not.toThrow();
  });
});
