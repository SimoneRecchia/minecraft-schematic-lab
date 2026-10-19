import { useEffect, useRef } from 'react';
import type { Vec3 } from '@minecraft-schematic-lab/shared';
import { controller } from '../controller';
import { fmt, t } from '../i18n';
import type { IoView } from '../sim/protocol';
import { useSim } from '../sim/simStore';
import { useApp } from '../store';
import { IconBolt, IconCheck, IconPause, IconPlay, IconReset, IconStep, IconWarn } from './Icons';

const SPEEDS: [number, string][] = [
  [0.25, '¼×'],
  [0.5, '½×'],
  [1, '1×'],
  [2, '2×'],
  [5, '5×'],
  [20, '20×'],
  [0, t.sim.max],
];

/** Transport for the live simulation: run/pause, one tick, back to the start, speed. */
export function SimBar() {
  const sim = useSim();
  const sidebar = useApp((s) => s.sidebarOpen);
  if (!sim.available) return null;
  const run = sim.testRun;
  return (
    <div className={`simbar glass ${sidebar ? '' : 'wide'}`}>
      <button
        className="play"
        title={sim.playing ? t.sim.pause : t.sim.play}
        onClick={() => controller.sim.toggle()}
      >
        {sim.playing ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />}
      </button>
      <button className="icon-btn" title={t.sim.step} onClick={() => controller.sim.step(1)}>
        <IconStep />
      </button>
      <button
        className="icon-btn"
        title={t.sim.reset}
        disabled={!sim.powered}
        onClick={() => controller.sim.reset()}
      >
        <IconReset />
      </button>
      <div className="divider" />
      <select
        className="speed"
        aria-label={t.sim.speed}
        value={sim.speed}
        onChange={(e) => controller.sim.setSpeed(Number(e.target.value))}
      >
        {SPEEDS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <div className="divider" />
      <div className="clock mono">
        {sim.powered ? (
          <>
            {sim.tick.toLocaleString()} <span className="faint">{t.sim.tick}</span>
          </>
        ) : (
          <span className="faint">{t.sim.off}</span>
        )}
      </div>
      {run && (
        <div
          className={`test-chip ${run.done ? (run.ok ? 'pass' : 'fail') : ''}`}
          title={run.message}
        >
          {run.done ? (
            run.ok ? (
              <IconCheck width={13} height={13} />
            ) : (
              <IconWarn width={13} height={13} />
            )
          ) : (
            <span className="spinner" />
          )}
          {fmt(t.sim.testOf, { n: run.name })}
          <span className="faint">
            {run.done
              ? run.ok
                ? t.sim.passed
                : t.sim.failed
              : fmt(t.sim.stepOf, { s: run.step + 1, t: run.steps })}
          </span>
        </div>
      )}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

function Led({ on }: { on: boolean }) {
  return <span className={`led ${on ? 'on' : ''}`} />;
}

function bitsOf(v: number, n: number): number[] {
  return Array.from({ length: n }, (_, k) => Math.floor(v / 2 ** k) % 2).reverse();
}

function focusIo(io: IoView): void {
  const xs = io.at.map((p) => p[0]);
  const ys = io.at.map((p) => p[1]);
  const zs = io.at.map((p) => p[2]);
  const from: Vec3 = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
  const to: Vec3 = [Math.max(...xs), Math.max(...ys), Math.max(...zs)];
  controller.focus(from, to);
}

function InputRow({ io, value }: { io: IoView; value: number }) {
  const max = io.bits > 1 ? 2 ** io.bits - 1 : io.kind === 'weighted' ? 150 : 15;
  let control: JSX.Element;
  if (io.bits > 1) {
    control = (
      <div className="bus">
        {bitsOf(value, io.bits).map((b, k) => {
          const bit = io.bits - 1 - k;
          return (
            <button
              key={bit}
              className={`bit ${b ? 'on' : ''}`}
              title={`${io.name}[${bit}]`}
              onClick={() => controller.sim.setInput(io.name, value ^ (2 ** bit))}
            >
              {b}
            </button>
          );
        })}
        <input
          className="input num mono"
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) =>
            controller.sim.setInput(
              io.name,
              Math.max(0, Math.min(max, Number(e.target.value) || 0)),
            )
          }
        />
      </div>
    );
  } else if (io.kind === 'button') {
    control = (
      <button className="btn small" onClick={() => controller.sim.press(io.name)}>
        {t.sim.press}
      </button>
    );
  } else if (io.kind === 'weighted' || io.kind === 'target' || io.kind === 'power') {
    control = (
      <div className="stepper">
        <button onClick={() => controller.sim.setInput(io.name, Math.max(0, value - 1))}>−</button>
        <span className="mono">{value}</span>
        <button onClick={() => controller.sim.setInput(io.name, Math.min(max, value + 1))}>
          +
        </button>
      </div>
    );
  } else {
    control = (
      <Switch on={value > 0} onChange={(v) => controller.sim.setInput(io.name, v ? 1 : 0)} />
    );
  }
  return (
    <div className="io-row">
      <button
        className="io-name mono"
        onClick={() => focusIo(io)}
        title={io.at.map((p) => p.join(' ')).join(' · ')}
      >
        {io.name}
      </button>
      <span className="faint io-kind">{io.bits > 1 ? `${io.bits} bit` : io.kind}</span>
      <span style={{ flex: 1 }} />
      {control}
    </div>
  );
}

function OutputRow({ io, value }: { io: IoView; value: number }) {
  return (
    <div className="io-row">
      <button
        className="io-name mono"
        onClick={() => focusIo(io)}
        title={io.at.map((p) => p.join(' ')).join(' · ')}
      >
        {io.name}
      </button>
      <span style={{ flex: 1 }} />
      {io.bits > 1 ? (
        <div className="bus readonly">
          {bitsOf(value, io.bits).map((b, k) => (
            <span key={k} className={`bit ${b ? 'on' : ''}`}>
              {b}
            </span>
          ))}
          <span className="mono value">{value}</span>
        </div>
      ) : io.read === 'power' ? (
        <div className="power">
          <div className="bar">
            <div style={{ width: `${(value / 15) * 100}%` }} />
          </div>
          <span className="mono value">{value}</span>
        </div>
      ) : (
        <Led on={value > 0} />
      )}
    </div>
  );
}

/** Sidebar pane: drive the inputs, watch the outputs, run and replay the circuit's tests. */
export function RedstonePane() {
  const sim = useSim();
  if (!sim.available) return null;
  const hasIo = sim.inputs.length + sim.outputs.length > 0;
  return (
    <div className="redstone-pane">
      {sim.errors.length > 0 && (
        <div className="callout error">
          <ul>
            {sim.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {!hasIo && sim.tests.length === 0 && (
        <div className="callout">
          <IconBolt width={16} height={16} style={{ color: 'var(--redstone)', flex: 'none' }} />
          <span>{t.sim.noCircuit}</span>
        </div>
      )}
      {sim.inputs.length > 0 && (
        <>
          <div className="section-title">{t.sim.inputs}</div>
          {sim.inputs.map((io) => (
            <InputRow key={io.name} io={io} value={sim.values[io.name] ?? 0} />
          ))}
        </>
      )}
      {sim.outputs.length > 0 && (
        <>
          <div className="section-title">{t.sim.outputs}</div>
          {sim.outputs.map((io) => (
            <OutputRow key={io.name} io={io} value={sim.values[io.name] ?? 0} />
          ))}
        </>
      )}
      {sim.tests.length > 0 && (
        <>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center' }}>
            {t.sim.tests}
            <span style={{ flex: 1 }} />
            <button
              className="btn small"
              disabled={sim.running}
              onClick={() => controller.sim.runTests()}
            >
              {sim.running ? t.sim.running : t.sim.runAll}
            </button>
          </div>
          {sim.tests.map((name) => {
            const r = sim.results[name];
            const live = sim.testRun?.name === name && !sim.testRun.done;
            return (
              <div key={name} className="test-row">
                <span className={`status-dot ${r ? (r.ok ? 'pass' : 'fail') : ''}`}>
                  {r ? (
                    r.ok ? (
                      <IconCheck width={12} height={12} />
                    ) : (
                      <IconWarn width={12} height={12} />
                    )
                  ) : null}
                </span>
                <div className="grow">
                  <div className="title">{name}</div>
                  {r && (
                    <div className="sub">
                      {r.cases > 1 && fmt(t.sim.cases, { p: r.cases - r.failed, t: r.cases })}
                      {r.message && <span className={r.ok ? '' : 'fail-text'}> {r.message}</span>}
                    </div>
                  )}
                </div>
                <button
                  className="icon-btn"
                  title={live ? t.sim.stop : t.sim.replay}
                  onClick={() =>
                    live ? controller.sim.stopTest() : controller.sim.playStored(name)
                  }
                >
                  {live ? <IconPause /> : <IconPlay />}
                </button>
              </div>
            );
          })}
        </>
      )}
      {sim.events.length > 0 && (
        <>
          <div className="section-title">{t.sim.events}</div>
          <div className="events">
            {sim.events.slice(0, 12).map((e, k) => (
              <div key={k} className="event">
                <span className={e.type === 'note' || e.type === 'bell' ? '' : 'warn'}>
                  {(t.sim.ev as Record<string, string>)[e.type] ?? e.type}
                </span>
                {e.detail && <span className="faint"> {e.detail}</span>}
                <span className="faint mono">
                  {' '}
                  · {e.pos.join(' ')} · t={e.tick}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Names of the circuit's inputs and outputs, floating over their blocks. */
export function CircuitLabels() {
  const sim = useSim();
  const header = useApp((s) => s.header);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const el = layer.current;
      const viewer = controller.viewer;
      if (!el || !viewer || !header) return;
      el.querySelectorAll<HTMLDivElement>('[data-at]').forEach((node) => {
        const [x, y, z] = (node.dataset.at as string).split(',').map(Number) as Vec3;
        const p = viewer.project([
          x - header.origin[0] + 0.5,
          y - header.origin[1] + 1.15,
          z - header.origin[2] + 0.5,
        ]);
        if (!p) {
          node.style.display = 'none';
          return;
        }
        node.style.display = '';
        node.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      });
    };
    controller.frameListeners.add(update);
    update();
    return () => {
      controller.frameListeners.delete(update);
    };
  }, [header, sim.inputs, sim.outputs]);
  if (!sim.available || !header) return null;
  const labels: { key: string; at: Vec3; text: string; kind: 'in' | 'out'; on: boolean }[] = [];
  for (const [list, kind] of [
    [sim.inputs, 'in'],
    [sim.outputs, 'out'],
  ] as const) {
    for (const io of list) {
      const v = sim.values[io.name] ?? 0;
      io.at.forEach((at, k) => {
        const on = io.bits > 1 ? Math.floor(v / 2 ** k) % 2 === 1 : v > 0;
        labels.push({
          key: `${io.name}${k}`,
          at,
          text: io.bits > 1 ? `${io.name}${k}` : io.name,
          kind,
          on,
        });
      });
    }
  }
  return (
    <div ref={layer} className="circuit-labels">
      {labels.map((l) => (
        <div
          key={l.key}
          data-at={l.at.join(',')}
          className={`io-label ${l.kind} ${l.on ? 'on' : ''}`}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}
