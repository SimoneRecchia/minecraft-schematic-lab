import type { ServerResponse } from 'node:http';
import type { CameraState, ServerEvent } from '@minecraft-schematic-lab/shared';

export interface ViewerClient {
  id: string;
  res: ServerResponse;
  connectedAt: number;
  lastActive: number;
  visible: boolean;
  camera: CameraState | null;
}

/** Server-sent events to every open viewer tab, and what each tab reports back. */
export class EventHub {
  private readonly clients = new Map<string, ViewerClient>();
  private seq = 0;
  private readonly waiters: (() => void)[] = [];

  add(res: ServerResponse): ViewerClient {
    const id = `v${++this.seq}`;
    const client: ViewerClient = {
      id,
      res,
      connectedAt: Date.now(),
      lastActive: Date.now(),
      visible: true,
      camera: null,
    };
    this.clients.set(id, client);
    res.on('close', () => this.clients.delete(id));
    for (const w of this.waiters.splice(0)) w();
    return client;
  }

  send(client: ViewerClient, event: ServerEvent): void {
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  broadcast(event: ServerEvent): void {
    for (const c of this.clients.values()) this.send(c, event);
  }

  update(id: string, patch: Partial<Pick<ViewerClient, 'visible' | 'camera'>>): void {
    const c = this.clients.get(id);
    if (!c) return;
    Object.assign(c, patch);
    c.lastActive = Date.now();
  }

  get count(): number {
    return this.clients.size;
  }

  /** The tab the user is most likely looking at. */
  best(): ViewerClient | null {
    let best: ViewerClient | null = null;
    for (const c of this.clients.values()) {
      if (!best) best = c;
      else if (c.visible !== best.visible) best = c.visible ? c : best;
      else if (c.lastActive > best.lastActive) best = c;
    }
    return best;
  }

  /** Resolve when a viewer connects (or after timeoutMs). */
  waitForClient(timeoutMs: number): Promise<boolean> {
    if (this.clients.size > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.clients.size > 0), timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  heartbeat(): void {
    for (const c of this.clients.values()) c.res.write(': ping\n\n');
  }
}
