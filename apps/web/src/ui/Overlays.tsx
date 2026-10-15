import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { controller } from '../controller';
import { blockLabel, fmt, t } from '../i18n';
import { useApp } from '../store';
import { IconCheck, IconClose, IconInfo, IconPin, IconSparkle, IconWarn } from './Icons';

export function Inspector() {
  const sel = useApp((s) => s.selection);
  const set = useApp((s) => s.set);
  if (!sel) return null;
  const region = sel.from.join() !== sel.to.join();
  const state = sel.info?.state ?? '';
  const props = state.includes('[') ? state.slice(state.indexOf('[') + 1, -1).split(',') : [];
  const size = [0, 1, 2].map((i) => Math.abs((sel.to[i] as number) - (sel.from[i] as number)) + 1);
  return (
    <div className="inspector glass panel">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{region ? t.region : state ? blockLabel(state) : t.selection}</h3>
          {state && (
            <div className="faint mono" style={{ marginTop: 2 }}>
              {state.replace(/\[.*$/, '')}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={() => controller.clearSelection()}>
          <IconClose />
        </button>
      </div>
      {props.length > 0 && !region && (
        <div className="props">
          {props.map((p) => (
            <span className="chip" key={p}>
              {p.replace('=', ': ')}
            </span>
          ))}
        </div>
      )}
      <div className="kv">
        <div className="k">{t.coords}</div>
        <div className="v mono">
          {region ? `${sel.from.join(' ')} → ${sel.to.join(' ')}` : sel.to.join(' ')}
        </div>
        {region && (
          <>
            <div className="k">{t.size}</div>
            <div className="v mono">{size.join('×')}</div>
          </>
        )}
        {sel.info?.source && (
          <>
            <div className="k">{t.placedBy}</div>
            <div className="v mono" style={{ fontSize: 11 }}>
              {sel.info.source}
            </div>
          </>
        )}
      </div>
      <button
        className="btn"
        style={{ marginTop: 12, width: '100%' }}
        onClick={() => set({ noteDraft: { from: sel.from, to: sel.to } })}
      >
        <IconPin width={15} height={15} /> {t.addNoteHere}
      </button>
    </div>
  );
}

export function Status() {
  const s = useApp();
  let content: JSX.Element;
  if (!s.connected) {
    content = (
      <>
        <span className="live-dot off" /> {t.offline}
      </>
    );
  } else if (s.compiling) {
    content = (
      <>
        <span className="spinner" /> {t.building}
      </>
    );
  } else if (s.assetMessage) {
    content = (
      <>
        <span className="spinner" /> {s.assetMessage}
      </>
    );
  } else if (s.meshProgress) {
    content = (
      <>
        <span className="spinner" /> {t.meshing}{' '}
        {Math.round((s.meshProgress[0] / s.meshProgress[1]) * 100)}%
      </>
    );
  } else if (s.slice && s.header) {
    content = (
      <>
        <span className="live-dot" /> {t.layer} y = {s.sliceY}
      </>
    );
  } else {
    content = (
      <>
        <span className="live-dot" /> {t.live}
        {s.header && (
          <span className="faint">
            · {s.header.blockCount.toLocaleString()} {t.blocks}
          </span>
        )}
      </>
    );
  }
  return <div className={`status glass ${s.sidebarOpen ? '' : 'wide'}`}>{content}</div>;
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((x) => (
        <div key={x.id} className="toast glass">
          {x.tone === 'success' ? (
            <IconCheck className="ico" style={{ color: 'var(--green)' }} />
          ) : x.tone === 'error' ? (
            <IconWarn className="ico" style={{ color: 'var(--red)' }} />
          ) : (
            <IconInfo className="ico" style={{ color: 'var(--accent)' }} />
          )}
          <span>{x.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Empty() {
  const header = useApp((s) => s.header);
  const sidebar = useApp((s) => s.sidebarOpen);
  if (header) return null;
  return (
    <div className="empty glass panel" style={sidebar ? undefined : { left: '50%' }}>
      <svg className="cube" viewBox="0 0 64 64">
        <path d="M32 4 60 18 32 32 4 18z" fill="#6fbf4a" />
        <path d="M4 18 32 32v28L4 46z" fill="#8a6239" />
        <path d="M60 18 32 32v28l28-14z" fill="#6b4a2b" />
        <path d="M4 18 32 32 60 18v6L32 38 4 24z" fill="#4e8f34" opacity=".9" />
      </svg>
      <h1>{t.emptyTitle}</h1>
      <p>{t.emptyBody}</p>
      <div className="examples">
        {t.emptyExamples.map((e) => (
          <div key={e}>{e}</div>
        ))}
      </div>
    </div>
  );
}

export function FocusMessage() {
  const msg = useApp((s) => s.focusMessage);
  const sidebar = useApp((s) => s.sidebarOpen);
  const set = useApp((s) => s.set);
  if (!msg) return null;
  return (
    <div className="focus-message glass" style={sidebar ? undefined : { left: '50%' }}>
      <IconSparkle
        width={18}
        height={18}
        style={{ color: 'var(--accent)', flex: 'none', marginTop: 1 }}
      />
      <div style={{ flex: 1 }}>{msg}</div>
      <button
        className="icon-btn"
        style={{ width: 22, height: 22 }}
        onClick={() => set({ focusMessage: null })}
      >
        <IconClose width={14} height={14} />
      </button>
    </div>
  );
}

export function LayerSlider() {
  const s = useApp();
  const h = s.header;
  if (!s.slice || !h) return null;
  const min = h.origin[1];
  const max = h.origin[1] + h.size[1] - 1;
  return (
    <div className="layer-slider glass">
      <div className="y">{s.sliceY}</div>
      <input
        type="range"
        min={min}
        max={max}
        value={s.sliceY}
        aria-label={t.layer}
        onChange={(e) => controller.setSlice(true, Number(e.target.value))}
      />
      <div className="faint" style={{ fontSize: 11 }}>
        y
      </div>
    </div>
  );
}

/** Blender-style navigation gizmo: click an axis to look along it. */
export function Gizmo() {
  const ref = useRef<SVGSVGElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let last = '';
    const update = () => {
      const q = controller.viewer?.quaternion;
      if (!q) return;
      const key = `${q.x.toFixed(3)}${q.y.toFixed(3)}${q.z.toFixed(3)}${q.w.toFixed(3)}`;
      if (key !== last) {
        last = key;
        setTick((x) => x + 1);
      }
    };
    controller.frameListeners.add(update);
    return () => {
      controller.frameListeners.delete(update);
    };
  }, []);
  void tick;
  const q = controller.viewer?.quaternion.clone().invert() ?? new THREE.Quaternion();
  const axes = [
    { key: 'x', v: new THREE.Vector3(1, 0, 0), color: '#ff3653', view: 'right' as const },
    { key: 'y', v: new THREE.Vector3(0, 1, 0), color: '#8adb00', view: 'top' as const },
    { key: 'z', v: new THREE.Vector3(0, 0, 1), color: '#2c8fff', view: 'front' as const },
    { key: '-x', v: new THREE.Vector3(-1, 0, 0), color: '#ff3653', view: 'left' as const },
    { key: '-y', v: new THREE.Vector3(0, -1, 0), color: '#8adb00', view: 'top' as const },
    { key: '-z', v: new THREE.Vector3(0, 0, -1), color: '#2c8fff', view: 'back' as const },
  ].map((a) => {
    const p = a.v.clone().applyQuaternion(q);
    return { ...a, x: 46 + p.x * 30, y: 46 - p.y * 30, z: p.z };
  });
  axes.sort((a, b) => a.z - b.z);
  return (
    <div className="gizmo glass">
      <svg ref={ref} viewBox="0 0 92 92">
        {axes
          .filter((a) => !a.key.startsWith('-'))
          .map((a) => (
            <line
              key={`l${a.key}`}
              x1={46}
              y1={46}
              x2={a.x}
              y2={a.y}
              stroke={a.color}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          ))}
        {axes.map((a) => {
          const neg = a.key.startsWith('-');
          return (
            <g
              key={a.key}
              className="axis-dot"
              onClick={() => controller.viewer?.frameView(a.view, null)}
            >
              <circle
                cx={a.x}
                cy={a.y}
                r={neg ? 6.5 : 8.5}
                fill={neg ? 'transparent' : a.color}
                stroke={a.color}
                strokeWidth={neg ? 1.8 : 0}
                opacity={neg ? 0.8 : 1}
              />
              {!neg && (
                <text
                  x={a.x}
                  y={a.y + 3.6}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill="#111"
                >
                  {a.key.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function AssetNotice() {
  const textured = useApp((s) => s.textured);
  const header = useApp((s) => s.header);
  if (textured || !header) return null;
  return <span className="faint">{fmt(t.texturesFailed, { m: header.assetVersion })}</span>;
}
