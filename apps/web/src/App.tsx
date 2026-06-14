import { useQuery } from '@tanstack/react-query';
import type { BuildResult, CurrentBuildResponse, PreviewData } from '@minecraft-schematic-lab/shared';
import { api } from './api/client';
import { BuildInfoPanel } from './components/BuildInfoPanel';
import { ClaudeHintPanel } from './components/ClaudeHintPanel';
import { ExportPanel } from './components/ExportPanel';
import { Layout } from './components/Layout';
import { MaterialsPanel } from './components/MaterialsPanel';
import { PreviewViewport } from './components/PreviewViewport';
import { useBuildStore } from './state/useBuildStore';

function toBuildResult(cur: CurrentBuildResponse, preview: PreviewData): BuildResult {
  return {
    sessionId: cur.sessionId,
    buildId: cur.buildId,
    valid: true,
    errors: [],
    warnings: cur.warnings,
    blockCount: cur.stats.blockCount,
    palette: cur.stats.palette,
    previewData: preview,
  };
}

export function App() {
  const setBuild = useBuildStore((s) => s.setBuild);

  // Poll the server: when a new build appears, pull the preview data and update the store.
  useQuery({
    queryKey: ['live-build'],
    refetchInterval: 1500,
    queryFn: async () => {
      const cur = await api.current();
      const currentId = useBuildStore.getState().build?.buildId ?? null;
      if (cur.buildId && cur.buildId !== currentId) {
        const preview = await api.previewData();
        setBuild(toBuildResult(cur, preview));
      }
      return cur.buildId ?? '';
    },
  });

  return (
    <Layout
      left={
        <>
          <ClaudeHintPanel />
          <BuildInfoPanel />
          <MaterialsPanel />
          <ExportPanel />
        </>
      }
      center={<PreviewViewport />}
    />
  );
}
