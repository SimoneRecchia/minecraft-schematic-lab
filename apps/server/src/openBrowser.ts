import { spawn } from 'node:child_process';

let lastOpened = 0;

/**
 * Open the viewer in the default browser (best effort, never throws). Debounced so a burst of
 * tool calls opens one tab; callers only use it when no viewer tab is connected.
 */
export function openViewer(url: string): void {
  if (process.env.MSL_NO_BROWSER === '1') return;
  const now = Date.now();
  if (now - lastOpened < 20_000) return;
  lastOpened = now;
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // opening the browser is a convenience, not a requirement
  }
}
