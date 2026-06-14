import { colorFor, friendlyBlockName } from '@minecraft-schematic-lab/shared';
import { useBuildStore } from '../state/useBuildStore';

export function BuildInfoPanel() {
  const build = useBuildStore((s) => s.build);

  if (!build || !build.buildId) {
    return (
      <section className="panel">
        <h2 className="panel-title">Build</h2>
        <p className="muted">Nothing yet — ask Claude to build something.</p>
      </section>
    );
  }

  const { x, y, z } = build.previewData.size;
  return (
    <section className="panel">
      <h2 className="panel-title">Build</h2>
      <dl className="info-grid">
        <dt>Blocks</dt>
        <dd>{build.blockCount.toLocaleString()}</dd>
        <dt>Size</dt>
        <dd>
          {x} × {y} × {z}
        </dd>
      </dl>
      <div className="palette-list">
        {build.palette.map((state) => (
          <span className="palette-chip" key={state}>
            <span className="swatch" style={{ background: colorFor(state) }} />
            {friendlyBlockName(state)}
          </span>
        ))}
      </div>
      {build.warnings.length > 0 ? (
        <ul className="warnings">
          {build.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
