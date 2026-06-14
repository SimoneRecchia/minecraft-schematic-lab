import { spawn } from 'node:child_process';

let opened = false;

/**
 * Open the given URL in the user's default browser, at most once per process. Best-effort: any
 * failure is swallowed so it never breaks the MCP/HTTP flow.
 */
export function openViewerOnce(url: string): void {
  if (opened) return;
  opened = true;
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // ignore — opening the browser is a convenience, not a requirement
  }
}
