import { useEffect, useRef, useState } from 'react';
import type { WorldInfo } from '@minecraft-schematic-lab/shared';
import { api, ApiError } from '../api';
import { fmt, t } from '../i18n';
import { useApp } from '../store';
import { IconClose, IconImport, IconWorld } from './Icons';

const SCHEMATIC = /\.(schem|schematic|litematic|nbt)$/i;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

/** Import a schematic file as the site of a new project (sheet, drop anywhere). */
export async function importSchematicFile(file: File): Promise<boolean> {
  const { toast, set } = useApp.getState();
  if (!SCHEMATIC.test(file.name)) {
    toast(t.importDrop, 'error');
    return false;
  }
  try {
    const r = await api.importFile(file.name, await readAsDataUrl(file));
    toast(r.warnings.length ? `${t.importDone} ${r.warnings[0]}` : t.importDone, 'success');
    set({ importOpen: false, onlyChanges: false });
    return true;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : String(e), 'error');
    return false;
  }
}

function ago(ms: number | null): string {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1) return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(ms).toLocaleDateString();
}

export function ImportSheet() {
  const open = useApp((s) => s.importOpen);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<'world' | 'file'>('world');
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null);
  const [sel, setSel] = useState<WorldInfo | null>(null);
  const [x, setX] = useState('0');
  const [z, setZ] = useState('0');
  const [dim, setDim] = useState('minecraft:overworld');
  const [radius, setRadius] = useState(48);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const choose = (w: WorldInfo, where: 'player' | 'spawn' = 'player') => {
    setSel(w);
    const p =
      where === 'player' && w.player
        ? w.player
        : w.spawn
          ? { pos: w.spawn, dimension: 'minecraft:overworld' }
          : null;
    setX(String(p?.pos[0] ?? 0));
    setZ(String(p?.pos[2] ?? 0));
    setDim(p?.dimension ?? w.dimensions[0] ?? 'minecraft:overworld');
  };

  useEffect(() => {
    if (!open) return;
    void api
      .worlds()
      .then((list) => {
        setWorlds(list);
        const first = list.find((w) => w.supported);
        if (first) choose(first);
        else setTab('file');
      })
      .catch(() => setWorlds([]));
  }, [open]);

  if (!open) return null;
  const close = () => set({ importOpen: false });
  const go = async () => {
    if (!sel) return;
    const cx = Number.parseInt(x, 10);
    const cz = Number.parseInt(z, 10);
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;
    setBusy(true);
    try {
      const r = await api.importWorld({
        world: sel.id,
        // y = 0 goes on the ground there, whatever height the player stood (or flew) at.
        center: [cx, cz],
        radius,
        dimension: dim,
      });
      toast(r.warnings.length ? `${t.importDone} ${r.warnings[0]}` : t.importDone, 'success');
      set({ importOpen: false, onlyChanges: false });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    await importSchematicFile(file);
    setBusy(false);
  };
  const side = radius * 2 + 1;
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" role="dialog" aria-label={t.importTitle}>
        <div className="sheet-head">
          <div>
            <h2>{t.importTitle}</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {t.importSub}
            </div>
          </div>
          <button className="icon-btn" onClick={close} aria-label={t.close}>
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          <div className="seg" style={{ marginBottom: 12 }}>
            <button className={tab === 'world' ? 'on' : ''} onClick={() => setTab('world')}>
              {t.importWorldTab}
            </button>
            <button className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}>
              {t.importFileTab}
            </button>
          </div>
          {tab === 'world' &&
            (worlds && worlds.length === 0 ? (
              <div className="callout">{t.importNoWorlds}</div>
            ) : (
              <>
                <div className="world-list">
                  {(worlds ?? []).map((w) => (
                    <button
                      key={w.id}
                      className={`world-card ${sel?.id === w.id ? 'on' : ''}`}
                      disabled={!w.supported}
                      onClick={() => choose(w)}
                    >
                      {w.hasIcon ? (
                        <img src={api.worldIconUrl(w.id)} alt="" width={40} height={40} />
                      ) : (
                        <span className="world-icon">
                          <IconWorld width={22} height={22} />
                        </span>
                      )}
                      <span className="grow">
                        <span className="title">{w.name}</span>
                        <span className="sub">
                          {w.version ?? '?'} · {t.lastPlayed} {ago(w.lastPlayed)}
                          {w.launcher !== 'Minecraft Launcher' ? ` · ${w.launcher}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {sel && (
                  <div className="import-form">
                    <div className="field">
                      <label>{t.importCenter}</label>
                      <div className="row-fields">
                        <input
                          className="input mono"
                          inputMode="numeric"
                          value={x}
                          onChange={(e) => setX(e.target.value)}
                        />
                        <input
                          className="input mono"
                          inputMode="numeric"
                          value={z}
                          onChange={(e) => setZ(e.target.value)}
                        />
                        {sel.player && (
                          <button className="btn" onClick={() => choose(sel, 'player')}>
                            {t.importHere}
                          </button>
                        )}
                        {sel.spawn && (
                          <button className="btn" onClick={() => choose(sel, 'spawn')}>
                            {t.importSpawn}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="field">
                      <label>
                        {t.importRadius} · {fmt(t.importArea, { s: side })}
                      </label>
                      <input
                        type="range"
                        min={8}
                        max={128}
                        step={4}
                        value={radius}
                        onChange={(e) => setRadius(Number(e.target.value))}
                      />
                    </div>
                    {sel.dimensions.length > 1 && (
                      <div className="field">
                        <label>{t.importDimension}</label>
                        <div className="chips">
                          {sel.dimensions.map((d) => (
                            <button
                              key={d}
                              className={`chip ${dim === d ? 'on' : ''}`}
                              onClick={() => setDim(d)}
                            >
                              {t.dimensionNames[d] ?? d}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="faint" style={{ fontSize: 11.5, margin: '10px 0 0' }}>
                      {t.importSaveFirst}
                    </p>
                  </div>
                )}
              </>
            ))}
          {tab === 'file' && (
            <label
              className={`drop-zone ${over ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOver(false);
                void pick(e.dataTransfer.files[0]);
              }}
            >
              <IconImport width={28} height={28} />
              <span>{t.importDrop}</span>
              <span className="btn">{t.importPick}</span>
              <input
                ref={input}
                type="file"
                accept=".schem,.schematic,.litematic,.nbt"
                hidden
                onChange={(e) => void pick(e.target.files?.[0])}
              />
            </label>
          )}
        </div>
        {tab === 'world' && sel && (
          <div className="sheet-foot">
            <button className="btn primary large" disabled={busy} onClick={() => void go()}>
              {busy ? t.importing : t.importGo}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
