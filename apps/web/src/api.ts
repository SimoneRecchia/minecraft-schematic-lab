import type {
  AssetManifest,
  AssetStatus,
  BakedBlock,
  BuildHeader,
  ExportFormatInfo,
  ExportTarget,
  FeedbackItem,
  InspectResult,
  ProjectInfo,
  ServerEvent,
  SimInfo,
  SiteInfo,
  Vec3,
  WorldInfo,
  VersionOption,
  VersionSummary,
} from '@minecraft-schematic-lab/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors?: string[],
  ) {
    super(message);
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body
      ? { 'content-type': 'application/json', ...(init.headers ?? {}) }
      : init?.headers,
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const b = body as { error?: string; errors?: string[] } | null;
    throw new ApiError(b?.error ?? b?.errors?.join('\n') ?? res.statusText, res.status, b?.errors);
  }
  return body as T;
}

const post = <T>(url: string, body: unknown = {}) =>
  json<T>(url, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  build: () => json<{ build: BuildHeader | null }>('/api/build').then((r) => r.build),
  async volume(buildId: string): Promise<Uint16Array> {
    const res = await fetch(`/api/build/volume?buildId=${encodeURIComponent(buildId)}`);
    if (!res.ok) throw new ApiError('Could not load the build data.', res.status);
    return new Uint16Array(await res.arrayBuffer());
  },
  sim: () => json<SimInfo>('/api/build/sim'),
  inspect: (pos: Vec3) =>
    json<InspectResult>(`/api/build/inspect?x=${pos[0]}&y=${pos[1]}&z=${pos[2]}`),
  changeVersion: (version: string, apply: boolean) =>
    post<{ ok: boolean; errors?: string[] }>('/api/build/version', { version, apply }),
  versions: () => json<VersionOption[]>('/api/versions'),
  history: () => json<VersionSummary[]>('/api/history'),
  restore: (n: number) => post<{ ok: boolean }>('/api/history/restore', { n }),
  projects: () => json<{ current: string | null; projects: ProjectInfo[] }>('/api/projects'),
  openProject: (id: string) =>
    post<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}/open`),
  renameProject: (id: string, name: string) =>
    post<ProjectInfo>(`/api/projects/${encodeURIComponent(id)}/rename`, { name }),
  deleteProject: (id: string) =>
    json<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  feedback: () => json<FeedbackItem[]>('/api/feedback'),
  addFeedback: (item: Partial<FeedbackItem> & { text: string }) =>
    post<FeedbackItem>('/api/feedback', item),
  resolveFeedback: (id: string) => post<FeedbackItem[]>(`/api/feedback/${id}/resolve`),
  deleteFeedback: (id: string) =>
    json<{ ok: boolean }>(`/api/feedback/${id}`, { method: 'DELETE' }),
  exportInfo: () => json<{ formats: ExportFormatInfo[]; targets: ExportTarget[] }>('/api/export'),
  exportUrl: (format: string) => `/api/export/${format}`,
  saveExport: (format: string, target: string) =>
    post<{ path: string; warnings: string[] }>(`/api/export/${format}/save`, { target }),
  async changes(buildId: string): Promise<Uint8Array> {
    const res = await fetch(`/api/build/changes?buildId=${encodeURIComponent(buildId)}`);
    if (!res.ok) throw new ApiError('Could not load the changes.', res.status);
    return new Uint8Array(await res.arrayBuffer());
  },
  worlds: () => json<WorldInfo[]>('/api/worlds'),
  worldIconUrl: (id: string) => `/api/worlds/${encodeURIComponent(id)}/icon.png`,
  importWorld: (body: { world: string; center?: number[]; radius?: number; dimension?: string }) =>
    post<{ ok: boolean; site: SiteInfo; warnings: string[] }>('/api/sites/import', body),
  importFile: (filename: string, data: string) =>
    post<{ ok: boolean; site: SiteInfo; warnings: string[] }>('/api/sites/import-file', {
      filename,
      data,
    }),
  exportWorld: (name?: string) =>
    post<{ path: string; folder: string; name: string; chunks: number; blocks: number }>(
      '/api/export/world',
      name ? { name } : {},
    ),
  installDatapack: (world?: string) =>
    post<{ path: string; world: string; functionId: string; warnings: string[] }>(
      '/api/export/datapack/install',
      world ? { world } : {},
    ),
  assetStatus: (version: string) => json<AssetStatus>(`/api/assets/${version}/status`),
  manifest: (version: string) => json<AssetManifest>(`/api/assets/${version}/manifest`),
  atlasUrl: (version: string) => `/api/assets/${version}/atlas.png`,
  models: (version: string, states: string[]) =>
    post<Record<string, BakedBlock>>(`/api/assets/${version}/models`, { states }),
  clientState: (id: string, state: object) =>
    post(`/api/client/${id}/state`, state).catch(() => undefined),
  capture: (requestId: string, body: object) => post(`/api/capture/${requestId}`, body),
};

/** Live server events with automatic reconnection. */
export function connectEvents(
  onEvent: (e: ServerEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry = 0;
  const open = () => {
    es = new EventSource('/api/events');
    es.onopen = () => {
      retry = 0;
      onStatus(true);
    };
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data as string) as ServerEvent);
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      onStatus(false);
      // The browser reconnects by itself (every second, as the server asks, also in background
      // tabs); only a stream it gave up on needs a new one.
      if (es?.readyState !== EventSource.CLOSED || closed) return;
      setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
    };
  };
  open();
  return () => {
    closed = true;
    es?.close();
  };
}
