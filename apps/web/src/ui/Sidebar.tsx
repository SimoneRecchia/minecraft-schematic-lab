import { useEffect, useMemo, useState } from 'react';
import type { FeedbackItem } from '@minecraft-schematic-lab/shared';
import { api } from '../api';
import { controller } from '../controller';
import { blockLabel, t } from '../i18n';
import { useApp, type Panel } from '../store';
import { blockIcon } from './blockIcons';
import { IconCheck, IconChevron, IconFolder, IconTrash, IconWarn } from './Icons';

function timeAgo(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  const it = navigator.language.toLowerCase().startsWith('it');
  if (d < 60) return it ? 'ora' : 'now';
  if (d < 3600) return `${Math.floor(d / 60)} min`;
  if (d < 86400) return `${Math.floor(d / 3600)} h`;
  return new Date(ms).toLocaleDateString();
}

export function BlockIcon({ state, size = 26 }: { state: string; size?: number }) {
  const header = useApp((s) => s.header);
  const textured = useApp((s) => s.textured);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const a = controller.assets;
    void blockIcon(
      state,
      textured ? a.version : null,
      textured ? a.manifest : null,
      textured ? controller.modelOf(state) : null,
    ).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [state, header?.assetVersion, textured]);
  return src ? (
    <img className="block-icon" src={src} width={size} height={size} alt="" />
  ) : (
    <div className="block-icon" />
  );
}

export function Sidebar() {
  const s = useApp();
  const h = s.header;
  const openNotes = s.feedback.filter((f) => f.status === 'open').length;
  const tabs: Panel[] = ['build', 'materials', 'history', 'notes'];
  return (
    <aside className={`sidebar glass panel ${s.sidebarOpen ? '' : 'closed'}`}>
      <div className="sidebar-head">
        <div className="app-title">
          <div className="logo" />
          {t.appName}
          <span style={{ flex: 1 }} />
          <button
            className="icon-btn"
            title={t.projects}
            onClick={() => s.set({ projectsOpen: !s.projectsOpen, versionOpen: false })}
          >
            <IconFolder />
          </button>
        </div>
        <div className="build-name" title={h?.name}>
          {h?.name ?? t.noBuild}
        </div>
        {h && (
          <div className="build-meta">
            <button
              className="chip accent"
              title={t.versionTitle}
              onClick={() => s.set({ versionOpen: !s.versionOpen, projectsOpen: false })}
            >
              {t.minecraft} {h.minecraftVersion}
              <IconChevron width={12} height={12} />
            </button>
            <span className="chip">v{h.n}</span>
            {s.compiling && <span className="chip orange">{t.building}</span>}
          </div>
        )}
      </div>
      <div className="sidebar-tabs">
        <div className="seg">
          {tabs.map((p) => (
            <button
              key={p}
              className={s.panel === p ? 'on' : ''}
              onClick={() => s.set({ panel: p })}
            >
              {t.tabs[p]}
              {p === 'notes' && openNotes > 0 ? ` ${openNotes}` : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar-body">
        {s.panel === 'build' && <BuildPane />}
        {s.panel === 'materials' && <MaterialsPane />}
        {s.panel === 'history' && <HistoryPane />}
        {s.panel === 'notes' && <NotesPane />}
      </div>
    </aside>
  );
}

function BuildPane() {
  const h = useApp((s) => s.header);
  const errors = useApp((s) => s.buildErrors);
  if (!h) return <p className="muted">{t.emptyBody}</p>;
  const [x, y, z] = h.size;
  return (
    <>
      {errors && (
        <div className="callout error">
          <strong>{t.buildFailed}</strong>
          <ul>
            {errors.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="section-title">{t.size}</div>
      <div className="stat-grid">
        <div className="stat">
          <div className="v">
            {x}×{y}×{z}
          </div>
          <div className="l">X × Y × Z</div>
        </div>
        <div className="stat">
          <div className="v">{h.blockCount.toLocaleString()}</div>
          <div className="l">{t.blocks}</div>
        </div>
        <div className="stat">
          <div className="v">{h.palette.length - 1}</div>
          <div className="l">{t.blockStates}</div>
        </div>
        <div className="stat">
          <div className="v">{h.compileMs} ms</div>
          <div className="l">{t.compileTime}</div>
        </div>
      </div>
      {h.description && (
        <p className="muted" style={{ marginTop: 12 }}>
          {h.description}
        </p>
      )}
      {h.warnings.length > 0 && (
        <div className="callout warn">
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconWarn width={15} height={15} /> {t.warnings}
          </strong>
          <ul>
            {h.warnings.slice(0, 10).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="section-title">{t.anchor}</div>
      <div className="muted mono">
        {h.anchor.map((v, i) => v + (h.origin[i] as number)).join(' ')}
      </div>
      <p className="faint" style={{ fontSize: 11.5, marginTop: 16 }}>
        {t.shortcuts}
      </p>
    </>
  );
}

function MaterialsPane() {
  const h = useApp((s) => s.header);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => controller.materialCounts(), [h?.buildId]);
  if (!h) return null;
  const filtered = rows.filter((r) => r.name.includes(query.toLowerCase().replace(/\s+/g, '_')));
  return (
    <>
      <input
        className="input"
        placeholder={t.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {filtered.map((r) => {
        const stacks = Math.floor(r.count / 64);
        const rest = r.count % 64;
        return (
          <div className="row" key={r.name}>
            <BlockIcon state={r.state} />
            <div className="grow">
              <div className="title">{blockLabel(r.name)}</div>
              <div className="sub">
                {stacks > 0 ? `${stacks} ${t.stacks}${rest ? ` + ${rest}` : ''}` : `${rest}`}
                {r.count > 64 * 27 ? ` · ${Math.ceil(r.count / (64 * 27))} ${t.shulkers}` : ''}
              </div>
            </div>
            <div className="count">{r.count.toLocaleString()}</div>
          </div>
        );
      })}
    </>
  );
}

function HistoryPane() {
  const history = useApp((s) => s.history);
  const h = useApp((s) => s.header);
  const toast = useApp((s) => s.toast);
  return (
    <div className="timeline">
      <div className="section-title">{t.history}</div>
      {[...history].reverse().map((v) => (
        <div className={`row ${h?.n === v.n ? 'active' : ''}`} key={v.n}>
          <div className="dot" />
          <div className="grow">
            <div className="title">
              v{v.n} · {v.label}
            </div>
            <div className="sub">
              {timeAgo(v.createdAt)} · {v.size.join('×')} · {v.blockCount.toLocaleString()}{' '}
              {t.blocks}
            </div>
          </div>
          {h?.n === v.n ? (
            <span className="chip accent">{t.current}</span>
          ) : (
            <button
              className="btn"
              onClick={() => void api.restore(v.n).catch((e: Error) => toast(e.message, 'error'))}
            >
              {t.restore}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function NotesPane() {
  const feedback = useApp((s) => s.feedback);
  const toast = useApp((s) => s.toast);
  const open = feedback
    .filter((f) => f.status === 'open')
    .sort((a, b) => a.createdAt - b.createdAt);
  const done = feedback
    .filter((f) => f.status === 'resolved')
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  const card = (f: FeedbackItem, num?: number) => (
    <div className={`note-card ${f.status}`} key={f.id}>
      <div className="note-head">
        {num ? (
          <span className="pin-num">#{num}</span>
        ) : (
          <IconCheck width={16} height={16} style={{ color: 'var(--green)' }} />
        )}
        <span className="faint" style={{ fontSize: 11 }}>
          {f.kind === 'version'
            ? `→ ${f.targetVersion}`
            : f.region
              ? `${f.region.from.join(' ')} → ${f.region.to.join(' ')}`
              : f.pos?.join(' ')}
        </span>
        <span style={{ flex: 1 }} />
        {f.pos && (
          <button
            className="icon-btn"
            title="Focus"
            onClick={() => controller.focus(f.region?.from ?? f.pos!, f.region?.to ?? f.pos!)}
          >
            <IconChevron width={14} height={14} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        )}
        <button
          className="icon-btn"
          title={t.noteDelete}
          onClick={() =>
            void api.deleteFeedback(f.id).catch((e: Error) => toast(e.message, 'error'))
          }
        >
          <IconTrash width={15} height={15} />
        </button>
      </div>
      <div>{f.text}</div>
      {f.block && (
        <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
          {blockLabel(f.block)}
        </div>
      )}
      {f.reply && (
        <div className="reply">
          <strong>{t.claudeReply}:</strong> {f.reply}
        </div>
      )}
    </div>
  );
  return (
    <>
      <p className="muted" style={{ fontSize: 12, margin: '4px 2px 10px' }}>
        {t.notesHint}
      </p>
      {open.length > 0 && <div className="section-title">{t.noteOpen}</div>}
      {open.map((f, i) => card(f, i + 1))}
      {done.length > 0 && <div className="section-title">{t.noteDone}</div>}
      {done.slice(0, 20).map((f) => card(f))}
    </>
  );
}
