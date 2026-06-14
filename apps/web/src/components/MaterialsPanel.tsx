import { colorFor, friendlyBlockName } from '@minecraft-schematic-lab/shared';
import { useBuildStore } from '../state/useBuildStore';

export function MaterialsPanel() {
  const build = useBuildStore((s) => s.build);
  const instances = build?.previewData.instances ?? {};
  const rows = Object.entries(instances)
    .map(([state, positions]) => ({ state, count: positions.length }))
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <section className="panel">
      <h2 className="panel-title">Materials</h2>
      {rows.length === 0 ? (
        <p className="muted">Build something (ask Claude).</p>
      ) : (
        <>
          <ul className="materials-list">
            {rows.map((row) => (
              <li key={row.state}>
                <span className="swatch" style={{ background: colorFor(row.state) }} />
                <span className="material-name">{friendlyBlockName(row.state)}</span>
                <span className="material-count">×{row.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <p className="materials-total">Total: {total.toLocaleString()} blocks</p>
        </>
      )}
    </section>
  );
}
