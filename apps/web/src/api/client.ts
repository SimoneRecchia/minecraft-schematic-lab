import type { CurrentBuildResponse, PreviewData } from '@minecraft-schematic-lab/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // response had no JSON body
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const EXPORT_URL = '/api/session/export.schem';

export const api = {
  current: () => request<CurrentBuildResponse>('/api/session/current'),
  previewData: () => request<PreviewData>('/api/session/preview-data'),
  exportUrl: (version: 2 | 3 = 2) => (version === 3 ? `${EXPORT_URL}?version=3` : EXPORT_URL),
};
