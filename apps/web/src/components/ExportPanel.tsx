import { useState } from 'react';
import { api } from '../api/client';
import { useBuildStore } from '../state/useBuildStore';

export function ExportPanel() {
  const build = useBuildStore((s) => s.build);
  const [version, setVersion] = useState<2 | 3>(2);
  const ready = Boolean(build?.buildId && build.valid);

  return (
    <section className="panel">
      <h2 className="panel-title">Export</h2>
      <label className="field">
        <span>Format</span>
        <select value={version} onChange={(e) => setVersion(Number(e.target.value) as 2 | 3)}>
          <option value={2}>Sponge v2 (most compatible)</option>
          <option value={3}>Sponge v3</option>
        </select>
      </label>
      <a
        className={ready ? 'btn export-btn' : 'btn export-btn disabled'}
        href={ready ? api.exportUrl(version) : undefined}
        aria-disabled={!ready}
        download
      >
        Export .schem
      </a>
      <details className="help">
        <summary>How to use the .schem in Minecraft</summary>
        <ol>
          <li>
            Put the file in your world&apos;s <code>schematics</code> folder (WorldEdit / FAWE).
          </li>
          <li>
            In-game run <code>//schem load &lt;name&gt;</code>.
          </li>
          <li>
            Stand where you want it and run <code>//paste</code>.
          </li>
        </ol>
      </details>
    </section>
  );
}
