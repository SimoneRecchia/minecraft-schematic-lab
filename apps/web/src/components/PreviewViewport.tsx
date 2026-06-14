import { CAMERA_PRESETS } from '../renderer/cameraPresets';
import { VoxelScene } from '../renderer/VoxelScene';
import { useBuildStore } from '../state/useBuildStore';

export function PreviewViewport() {
  const build = useBuildStore((s) => s.build);
  const preset = useBuildStore((s) => s.cameraPreset);
  const setPreset = useBuildStore((s) => s.setCameraPreset);
  const hasBlocks = Boolean(build && Object.keys(build.previewData.instances).length > 0);

  const screenshot = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('.preview-viewport canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'schematic-preview.png';
    link.click();
  };

  return (
    <div className="preview-viewport">
      <div className="preview-toolbar">
        {CAMERA_PRESETS.map((p) => (
          <button
            key={p.name}
            className={p.name === preset ? 'chip active' : 'chip'}
            onClick={() => setPreset(p.name)}
          >
            {p.label}
          </button>
        ))}
        <button className="chip" onClick={screenshot} disabled={!hasBlocks}>
          📷 Screenshot
        </button>
      </div>
      {hasBlocks && build ? (
        <VoxelScene data={build.previewData} preset={preset} />
      ) : (
        <div className="preview-empty">Ask Claude to build something — it&apos;ll appear here.</div>
      )}
    </div>
  );
}
