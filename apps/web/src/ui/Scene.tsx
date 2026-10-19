import { useEffect, useRef, useState } from 'react';
import type { Vec3 } from '@minecraft-schematic-lab/shared';
import { api } from '../api';
import { controller } from '../controller';
import { blockLabel, t } from '../i18n';
import { useApp } from '../store';
import { CircuitLabels } from './Redstone';

/** Full-bleed 3D viewport, plus the overlays that follow the camera (pins, hover label). */
export function Scene() {
  const ref = useRef<HTMLDivElement>(null);
  const tool = useApp((s) => s.tool);
  const usable = useApp((s) => s.hover?.usable === true);
  useEffect(() => {
    if (ref.current) controller.attach(ref.current);
  }, []);
  return (
    <div ref={ref} className={`scene tool-${tool} ${usable ? 'can-use' : ''}`}>
      <CircuitLabels />
      <Pins />
      <HoverLabel />
      <Composer />
    </div>
  );
}

function HoverLabel() {
  const hover = useApp((s) => s.hover);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);
  if (!hover) return null;
  return (
    <div className="hover-label glass" style={{ left: pos.x + 16, top: pos.y + 14 }}>
      {blockLabel(hover.state)} <span className="faint mono">{hover.pos.join(' ')}</span>
    </div>
  );
}

/** Feedback pins anchored to blocks; positions are updated every rendered frame without React. */
function Pins() {
  const feedback = useApp((s) => s.feedback);
  const header = useApp((s) => s.header);
  const set = useApp((s) => s.set);
  const layer = useRef<HTMLDivElement>(null);
  const open = feedback
    .filter((f) => f.status === 'open')
    .sort((a, b) => a.createdAt - b.createdAt);
  const items = feedback
    .filter((f) => f.pos || f.region)
    .map((f) => ({ f, num: open.indexOf(f) + 1 }))
    .filter((x) => x.f.status === 'open' || Date.now() - (x.f.resolvedAt ?? 0) < 3 * 60_000);

  useEffect(() => {
    const update = () => {
      const el = layer.current;
      const viewer = controller.viewer;
      if (!el || !viewer || !header) return;
      el.querySelectorAll<HTMLDivElement>('[data-pin]').forEach((node) => {
        const [x, y, z] = (node.dataset.pin as string).split(',').map(Number) as Vec3;
        const p = viewer.project([
          x - header.origin[0] + 0.5,
          y - header.origin[1] + 1.05,
          z - header.origin[2] + 0.5,
        ]);
        if (!p) {
          node.style.display = 'none';
          return;
        }
        node.style.display = '';
        node.style.left = `${p.x}px`;
        node.style.top = `${p.y}px`;
      });
    };
    controller.frameListeners.add(update);
    update();
    return () => {
      controller.frameListeners.delete(update);
    };
  }, [header, items.length]);

  if (!header) return null;
  return (
    <div ref={layer} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {items.map(({ f, num }) => {
        const p: Vec3 = f.region
          ? [
              Math.round((f.region.from[0] + f.region.to[0]) / 2),
              Math.max(f.region.from[1], f.region.to[1]),
              Math.round((f.region.from[2] + f.region.to[2]) / 2),
            ]
          : (f.pos as Vec3);
        return (
          <div
            key={f.id}
            className={`pin ${f.status === 'resolved' ? 'resolved' : ''}`}
            data-pin={p.join(',')}
            title={f.text}
            onClick={() => {
              set({ panel: 'notes', sidebarOpen: true });
              controller.focus(f.region?.from ?? (f.pos as Vec3), f.region?.to ?? (f.pos as Vec3));
            }}
          >
            <div className="bubble">{f.status === 'resolved' ? '✓' : `#${num}`}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Popover to write a note for Claude on the clicked block/area. */
function Composer() {
  const draft = useApp((s) => s.noteDraft);
  const header = useApp((s) => s.header);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!draft || !header || !controller.viewer) return;
    const p = controller.viewer.project([
      draft.to[0] - header.origin[0] + 0.5,
      draft.to[1] - header.origin[1] + 1,
      draft.to[2] - header.origin[2] + 0.5,
    ]);
    setAnchor(p);
  }, [draft, header]);

  if (!draft || !anchor) return null;
  const isRegion = draft.from.join() !== draft.to.join();
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addFeedback({
        text: text.trim(),
        ...(isRegion
          ? { region: { from: draft.from, to: draft.to }, pos: draft.to }
          : { pos: draft.to }),
      });
      setText('');
      set({ noteDraft: null, panel: 'notes', sidebarOpen: true });
      toast(t.noteTell, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const left = Math.min(window.innerWidth - 316, Math.max(16, anchor.x + 18));
  const top = Math.min(window.innerHeight - 170, Math.max(16, anchor.y - 40));
  return (
    <div
      className="composer glass panel"
      style={{ left, top, pointerEvents: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        {isRegion
          ? `${t.region} ${draft.from.join(' ')} → ${draft.to.join(' ')}`
          : `${t.coords} ${draft.to.join(' ')}`}
      </div>
      <textarea
        className="input"
        autoFocus
        placeholder={t.notePlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === 'Escape') set({ noteDraft: null });
          e.stopPropagation();
        }}
      />
      <div className="actions">
        <button className="btn" onClick={() => set({ noteDraft: null })}>
          {t.cancel}
        </button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void save()}>
          {t.noteSave}
        </button>
      </div>
    </div>
  );
}
