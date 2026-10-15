import type { CaptureRequest } from '@minecraft-schematic-lab/shared';
import type { EventHub } from './EventHub';

export interface CapturedImage {
  view: string;
  png: Buffer;
}

interface Pending {
  resolve: (images: CapturedImage[]) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Asks the open viewer to render views with the real textures (WebGL) and send them back, so
 * Claude sees exactly what the user sees.
 */
export class CaptureBroker {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private readonly hub: EventHub) {}

  async request(
    req: Omit<CaptureRequest, 'requestId'>,
    timeoutMs = 25_000,
  ): Promise<CapturedImage[]> {
    const client = this.hub.best();
    if (!client) throw new Error('No viewer is open.');
    const requestId = `cap${++this.seq}`;
    return new Promise<CapturedImage[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('The viewer did not answer in time.'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.hub.send(client, { type: 'capture', request: { ...req, requestId } });
    });
  }

  fulfill(requestId: string, images: CapturedImage[] | null, error?: string): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    if (images) p.resolve(images);
    else p.reject(new Error(error ?? 'Capture failed.'));
    return true;
  }
}
