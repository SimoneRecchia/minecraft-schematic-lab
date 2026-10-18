import { controller } from '../controller';
import { t } from '../i18n';
import { useSim } from '../sim/simStore';
import { useApp } from '../store';
import {
  IconCamera,
  IconHand,
  IconCube,
  IconCursor,
  IconExport,
  IconFrame,
  IconGrid,
  IconLayers,
  IconOrtho,
  IconPin,
  IconSidebar,
} from './Icons';

type Preset = 'iso' | 'front' | 'right' | 'top';

export function Toolbar() {
  const s = useApp();
  const redstone = useSim((x) => x.available);
  const has = Boolean(s.header);
  const view = (v: Preset) => controller.viewer?.frameView(v, null);
  return (
    <div className={`toolbar glass ${s.sidebarOpen ? '' : 'wide'}`}>
      <button
        className={`icon-btn ${s.sidebarOpen ? 'on' : ''}`}
        title="Sidebar (S)"
        onClick={() => s.set({ sidebarOpen: !s.sidebarOpen })}
      >
        <IconSidebar />
      </button>
      <div className="divider" />
      <div className="seg" role="group" aria-label="Tool">
        <button
          className={s.tool === 'navigate' ? 'on' : ''}
          title={t.tools.navigate}
          onClick={() => s.set({ tool: 'navigate', noteDraft: null })}
        >
          <IconCursor width={15} height={15} />
        </button>
        {redstone && (
          <button
            className={s.tool === 'use' ? 'on' : ''}
            title={t.tools.use}
            onClick={() => s.set({ tool: 'use', noteDraft: null })}
          >
            <IconHand width={15} height={15} />
          </button>
        )}
        <button
          className={s.tool === 'note' ? 'on' : ''}
          title={t.tools.note}
          onClick={() => s.set({ tool: 'note' })}
        >
          <IconPin width={15} height={15} />
        </button>
      </div>
      <div className="divider" />
      <div className="seg" role="group" aria-label="View">
        {(['iso', 'front', 'right', 'top'] as Preset[]).map((v) => (
          <button
            key={v}
            disabled={!has}
            onClick={() => view(v)}
            title={v === 'iso' ? '0' : v === 'front' ? '1' : v === 'right' ? '3' : '7'}
          >
            {t.views[v]}
          </button>
        ))}
      </div>
      <button
        className="icon-btn"
        title={t.tools.frame}
        disabled={!has}
        onClick={() => controller.viewer?.frameRegion(null)}
      >
        <IconFrame />
      </button>
      <div className="divider" />
      <button
        className={`icon-btn ${s.slice ? 'on' : ''}`}
        title={t.tools.slice}
        disabled={!has}
        onClick={() => controller.setSlice(!s.slice)}
      >
        <IconLayers />
      </button>
      <button
        className={`icon-btn ${s.grid ? 'on' : ''}`}
        title={t.tools.grid}
        onClick={() => {
          controller.viewer?.setGridVisible(!s.grid);
          s.set({ grid: !s.grid });
        }}
      >
        <IconGrid />
      </button>
      <button
        className={`icon-btn ${s.ortho ? 'on' : ''}`}
        title={t.tools.ortho}
        onClick={() => {
          controller.viewer?.setOrtho(!s.ortho);
          s.set({ ortho: !s.ortho });
        }}
      >
        {s.ortho ? <IconOrtho /> : <IconCube />}
      </button>
      <button
        className="icon-btn"
        title={t.tools.shot}
        disabled={!has}
        onClick={() => controller.screenshot()}
      >
        <IconCamera />
      </button>
      <div className="divider" />
      <button className="btn primary" disabled={!has} onClick={() => s.set({ exportOpen: true })}>
        <IconExport width={15} height={15} />
        {t.export}
      </button>
    </div>
  );
}
