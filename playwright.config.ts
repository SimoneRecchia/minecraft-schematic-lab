import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 8899;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'on-first-retry',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    // The real server with the built viewer, isolated data dir, no browser tabs, no downloads.
    command: 'pnpm --dir apps/server start',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      MSL_HOME: mkdtempSync(join(tmpdir(), 'msl-e2e-')),
      MSL_NO_BROWSER: '1',
      MSL_OFFLINE: '1',
      MINECRAFT_DIR: join(tmpdir(), 'msl-e2e-no-launcher'),
    },
  },
});
