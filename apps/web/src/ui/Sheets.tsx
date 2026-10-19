import { useEffect, useMemo, useState } from 'react';
import type { ExportFormatInfo, ExportTarget, WorldInfo } from '@minecraft-schematic-lab/shared';
import { api, ApiError } from '../api';
import { fmt, t } from '../i18n';
import { useApp } from '../store';
import { IconClose, IconTrash, IconWorld } from './Icons';

export function ExportSheet() {
  const open = useApp((s) => s.exportOpen);
  const header = useApp((s) => s.header);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<{ formats: ExportFormatInfo[]; targets: ExportTarget[] } | null>(
    null,
  );
  const [format, setFormat] = useState<string>('schem');
  const [busy, setBusy] = useState(false);
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null);

  useEffect(() => {
    if (open && format === 'datapack' && header?.site?.kind !== 'world' && worlds === null)
      void api
        .worlds()
        .then(setWorlds)
        .catch(() => setWorlds([]));
  }, [open, format, header?.site?.kind, worlds]);

  useEffect(() => {
    if (!open) return;
    void api.exportInfo().then((i) => {
      setInfo(i);
      setFormat(
        i.formats.find((f) => f.recommended)?.id ??
          i.formats.find((f) => f.available)?.id ??
          'schem',
      );
    });
  }, [open, header?.buildId]);

  if (!open || !header) return null;
  const close = () => set({ exportOpen: false });
  const meta = t.formats[format];
  const targets = (info?.targets ?? []).filter(
    (x) =>
      x.exists &&
      x.id !== 'downloads' &&
      (x.id !== 'litematica' || format === 'litematic') &&
      (x.id !== 'worldedit' || ['schem', 'schem3', 'schematic'].includes(format)),
  );
  const save = async (target: string) => {
    setBusy(true);
    try {
      const r = await api.saveExport(format, target);
      toast(`${t.saved} ${r.path}`, 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await task(), 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const install = (world?: string) =>
    run(async () => {
      const r = await api.installDatapack(world);
      return fmt(t.installDone, { f: r.functionId });
    });
  const site = header.site;
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" role="dialog" aria-label={t.exportTitle}>
        <div className="sheet-head">
          <div>
            <h2>{t.exportTitle}</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {header.name} · {t.exportFor} {header.minecraftVersion} · {header.size.join('×')}
            </div>
          </div>
          <button className="icon-btn" onClick={close} aria-label={t.close}>
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          <div className="format-grid">
            {(info?.formats ?? []).map((f) => {
              const m = t.formats[f.id];
              return (
                <button
                  key={f.id}
                  className={`format-card ${format === f.id ? 'on' : ''} ${f.available ? '' : 'off'}`}
                  disabled={!f.available}
                  title={f.reason}
                  onClick={() => setFormat(f.id)}
                >
                  {f.recommended && <span className="chip accent badge">{t.recommended}</span>}
                  <div className="t">{m?.title ?? f.id}</div>
                  <div className="d">{f.available ? m?.desc : (t.reasons[f.id] ?? f.reason)}</div>
                </button>
              );
            })}
          </div>
          {meta && <div className="howto">{meta.how}</div>}
          {site?.kind === 'world' && site.writable && (
            <div className="export-extra">
              <IconWorld width={22} height={22} style={{ color: 'var(--accent)', flex: 'none' }} />
              <div className="grow">
                <div className="t">{t.worldCopy}</div>
                <div className="d">{t.worldCopyDesc}</div>
              </div>
              <button
                className="btn"
                disabled={busy || site.changes === 0}
                onClick={() =>
                  void run(async () => fmt(t.worldCopyDone, { n: (await api.exportWorld()).name }))
                }
              >
                {t.worldCopyGo}
              </button>
            </div>
          )}
        </div>
        <div className="sheet-foot">
          {format === 'datapack' &&
            (site?.kind === 'world' ? (
              <button className="btn large" disabled={busy} onClick={() => void install()}>
                {fmt(t.installIn, { w: site.world ?? '' })}
              </button>
            ) : (
              (worlds?.length ?? 0) > 0 && (
                <select
                  className="input"
                  style={{ width: 'auto' }}
                  disabled={busy}
                  value=""
                  onChange={(e) => e.target.value && void install(e.target.value)}
                >
                  <option value="">{t.pickWorld}</option>
                  {(worlds ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.version ?? '?'})
                    </option>
                  ))}
                </select>
              )
            ))}
          {targets.map((x) => (
            <button
              key={x.id}
              className="btn large"
              disabled={busy}
              title={x.path}
              onClick={() => void save(x.id)}
            >
              {t.saveTo} {x.label}
            </button>
          ))}
          <a
            className="btn primary large"
            href={api.exportUrl(format)}
            download
            onClick={() => toast(t.download, 'success')}
          >
            {t.download}
          </a>
        </div>
      </div>
    </div>
  );
}

export function VersionPopover() {
  const open = useApp((s) => s.versionOpen);
  const versions = useApp((s) => s.versions);
  const header = useApp((s) => s.header);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [checking, setChecking] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ version: string; errors: string[] } | null>(null);
  const majors = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of versions) m.set(v.major, [...(m.get(v.major) ?? []), v.id]);
    return [...m.entries()];
  }, [versions]);
  if (!open || !header) return null;

  const choose = async (v: string) => {
    if (v === header.minecraftVersion) return;
    setChecking(v);
    setProblem(null);
    try {
      await api.changeVersion(v, true);
      toast(fmt(t.versionApplied, { v }), 'success');
      set({ versionOpen: false });
    } catch (e) {
      if (e instanceof ApiError && e.errors) setProblem({ version: v, errors: e.errors });
      else toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setChecking(null);
    }
  };
  const ask = async () => {
    if (!problem) return;
    await api.addFeedback({
      kind: 'version',
      targetVersion: problem.version,
      text: `Adapt the build to Minecraft ${problem.version}: ${problem.errors.length} block(s) don't exist there.`,
    });
    toast(t.versionAsked, 'success');
    setProblem(null);
    set({ versionOpen: false, panel: 'notes' });
  };
  return (
    <div className="popover glass" style={{ left: 336, top: 112 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 14 }}>{t.versionTitle}</strong>
        <button className="icon-btn" onClick={() => set({ versionOpen: false })}>
          <IconClose />
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {checking ? t.versionChecking : t.versionHint}
      </div>
      {problem ? (
        <div className="callout warn" style={{ overflowY: 'auto' }}>
          {fmt(t.versionIncompatible, { v: problem.version })}
          <ul>
            {problem.errors.slice(0, 12).map((e) => (
              <li key={e}>{e.replace(/^operations\[[^\]]*\][^:]*: /, '')}</li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button className="btn primary" onClick={() => void ask()}>
              {t.versionAskClaude}
            </button>
            <button className="btn" onClick={() => setProblem(null)}>
              {t.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="list">
          {majors.map(([m, ids]) => (
            <div className="version-major" key={m}>
              <div className="m">{m}</div>
              <div className="chips">
                {ids.map((id) => (
                  <button
                    key={id}
                    className={`chip ${id === header.minecraftVersion ? 'on' : ''}`}
                    disabled={!!checking}
                    onClick={() => void choose(id)}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectsPopover() {
  const open = useApp((s) => s.projectsOpen);
  const projects = useApp((s) => s.projects);
  const header = useApp((s) => s.header);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  if (!open) return null;
  return (
    <div className="popover glass" style={{ left: 336, top: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 14 }}>{t.projects}</strong>
        <button className="icon-btn" onClick={() => set({ projectsOpen: false })}>
          <IconClose />
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {t.newHint}
      </div>
      <div className="list">
        {projects.map((p) => (
          <div
            className={`row ${p.id === header?.projectId ? 'active' : ''}`}
            key={p.id}
            onDoubleClick={() => void api.openProject(p.id)}
          >
            <div className="grow">
              <div className="title">{p.name}</div>
              <div className="sub">
                {p.minecraftVersion} · v{p.versions} · {p.blockCount.toLocaleString()} {t.blocks}
              </div>
            </div>
            {p.id !== header?.projectId && (
              <button
                className="btn"
                onClick={() =>
                  void api
                    .openProject(p.id)
                    .then(() => set({ projectsOpen: false }))
                    .catch((e: Error) => toast(e.message, 'error'))
                }
              >
                {t.open}
              </button>
            )}
            <button
              className="icon-btn"
              title={t.delete}
              onClick={() => {
                if (window.confirm(t.deleteConfirm))
                  void api.deleteProject(p.id).catch((e: Error) => toast(e.message, 'error'));
              }}
            >
              <IconTrash width={15} height={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
