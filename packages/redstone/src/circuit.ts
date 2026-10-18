import { K } from './blocks';
import { Expr } from './expr';
import type { SimEvent, Vec3, World, WorldSnapshot } from './world';

/** A named input or output: one block, or a bus of blocks (bit 0 first). */
export interface IoSpec {
  at: Vec3 | Vec3[];
  /** Input only: place this block for 1 and put back what was there for 0 (e.g. redstone_block). */
  as?: string;
  /**
   * Output only: "bit" (0/1, default), "power" (signal strength 0–15) or "block" (1 when a
   * block stands there — for piston doors and other moving parts).
   */
  read?: 'bit' | 'power' | 'block';
}

export type Value = number | boolean | string;

/** A tick count: a number, or an expression over the test's variables ("k * 4"). */
export type Ticks = number | string;

export type Step =
  | { set: Record<string, Value> }
  | { pulse: Record<string, Ticks> }
  | { press: string | string[] }
  | { wait: Ticks }
  | { settle: Ticks | true }
  | { expect: Record<string, Value> | string; within?: Ticks; for?: Ticks }
  | { measure: string; ticks: Ticks; expect?: { period?: number; high?: number; pulses?: number } }
  | { log: string | string[] }
  | { use: Vec3 }
  | { place: { at: Vec3; block: string } }
  | { break: Vec3 };

export interface TestSpec {
  name: string;
  steps: Step[];
  /** Run the steps once per combination: { "A": [0, 15] } is every A from 0 to 15. */
  forAll?: Record<string, [number, number] | { values: number[] }>;
  /** More combinations than this are sampled at random (seeded). Default 256. */
  samples?: number;
  seed?: number;
  /** Record every change of these signals (first case). */
  trace?: string[];
}

export interface CircuitSpec {
  inputs?: Record<string, IoSpec>;
  outputs?: Record<string, IoSpec>;
  tests?: TestSpec[];
  /** Ticks power-on may take before the circuit counts as never resting. Default 1200. */
  settleTicks?: number;
}

export interface Failure {
  vars?: Record<string, number>;
  /** Game ticks since the case started. */
  tick: number;
  step: number;
  message: string;
}

export interface TestResult {
  name: string;
  ok: boolean;
  cases: number;
  failed: number;
  failures: Failure[];
  /** Latencies, measurements and logged values (first case). */
  notes: string[];
  trace?: Record<string, [number, number][]>;
  /** Events worth knowing about (torch burnout, blocks popping off…). */
  events: SimEvent[];
  ticks: number;
}

export interface CircuitReport {
  errors: string[];
  powerOn: { settled: boolean; ticks: number };
  tests: TestResult[];
  /** Tests not run because the time budget ran out. */
  skipped: string[];
  ms: number;
}

interface Bit {
  i: number;
  /** What was there before an `as` input placed its block. */
  original: string;
}

interface Io {
  name: string;
  bits: Bit[];
  spec: IoSpec;
}

const INPUT_KINDS = new Set<number>([
  K.LEVER,
  K.BUTTON,
  K.PLATE,
  K.WEIGHTED_PLATE,
  K.TARGET,
  K.DAYLIGHT,
  K.SCULK_SENSOR,
]);
const NOTABLE = new Set(['burnout', 'break', 'suppressed', 'left-area', 'tnt']);

/** The named inputs and outputs of a build, on a world. Coordinates are spec coordinates. */
export class Circuit {
  readonly inputs = new Map<string, Io>();
  readonly outputs = new Map<string, Io>();
  readonly errors: string[] = [];

  constructor(
    readonly world: World,
    readonly spec: CircuitSpec,
    /** Spec coordinates of the world's local (0,0,0). */
    readonly origin: Vec3,
  ) {
    const list = (at: Vec3 | Vec3[]): Vec3[] =>
      Array.isArray(at[0]) ? (at as Vec3[]) : [at as Vec3];
    for (const [kind, map, target] of [
      ['input', spec.inputs, this.inputs],
      ['output', spec.outputs, this.outputs],
    ] as const) {
      for (const [name, io] of Object.entries(map ?? {})) {
        if (!/^[A-Za-z_]\w*$/.test(name)) {
          this.errors.push(
            `${kind} "${name}": names are letters, digits and _ (like A, sum, clk_2).`,
          );
          continue;
        }
        if (this.inputs.has(name) || this.outputs.has(name)) {
          this.errors.push(`"${name}" is both an input and an output.`);
          continue;
        }
        const bits: Bit[] = [];
        for (const p of list(io.at)) {
          const local: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
          const i = world.index(...local);
          if (!world.valid(i)) {
            this.errors.push(`${kind} ${name} at [${p.join(', ')}] is outside the build.`);
            continue;
          }
          const info = world.info(i);
          if (kind === 'input' && !io.as && !INPUT_KINDS.has(info.kind)) {
            this.errors.push(
              `input ${name} at [${p.join(', ')}] is ${info.name}: an input must be a lever, button, pressure plate, target or daylight detector — or give "as" (e.g. "redstone_block") to place a block there for 1.`,
            );
          }
          bits.push({ i, original: info.state });
        }
        target.set(name, { name, bits, spec: io });
      }
    }
  }

  private io(name: string): Io {
    const io = this.inputs.get(name) ?? this.outputs.get(name);
    if (!io) throw new Error(`No input or output named "${name}".`);
    return io;
  }

  private readBit(i: number, mode: 'bit' | 'power' | 'block'): number {
    const w = this.world;
    const info = w.info(i);
    if (mode === 'block')
      return /^minecraft:(air|cave_air|void_air)$/.test(w.displayState(i)) ? 0 : 1;
    let p: number;
    switch (info.kind) {
      case K.WIRE:
      case K.WEIGHTED_PLATE:
      case K.TARGET:
      case K.DAYLIGHT:
      case K.SCULK_SENSOR:
        p = Math.max(0, info.power);
        break;
      case K.COMPARATOR:
        p = info.powered ? w.comparatorOutputAt(i) : 0;
        break;
      case K.LAMP:
      case K.TORCH:
      case K.WALL_TORCH:
      case K.COPPER_BULB:
        p = info.lit ? 15 : 0;
        break;
      case K.PISTON:
        p = info.extended ? 15 : 0;
        break;
      case K.DOOR:
      case K.TRAPDOOR:
      case K.FENCE_GATE:
        p = info.open ? 15 : 0;
        break;
      case K.DISPENSER:
      case K.CRAFTER:
        p = info.triggered ? 15 : 0;
        break;
      case K.HOPPER:
        p = info.enabled ? 0 : 15;
        break;
      case K.REPEATER:
      case K.OBSERVER:
      case K.LEVER:
      case K.BUTTON:
      case K.NOTE_BLOCK:
      case K.POWERED_RAIL:
      case K.BELL:
      case K.PLATE:
        p = info.powered ? 15 : 0;
        break;
      default:
        p = w.receivedPower(i);
    }
    return mode === 'power' ? p : p > 0 ? 1 : 0;
  }

  /** Current value: a bus reads as an integer, bit 0 first. */
  read(name: string): number {
    const io = this.io(name);
    const mode = this.outputs.has(name) ? (io.spec.read ?? 'bit') : 'bit';
    if (io.bits.length === 1) return this.readBit((io.bits[0] as Bit).i, mode);
    let v = 0;
    io.bits.forEach((b, k) => {
      if (this.readBit(b.i, mode === 'block' ? 'block' : 'bit')) v += 2 ** k;
    });
    return v;
  }

  values(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const n of [...this.inputs.keys(), ...this.outputs.keys()]) out[n] = this.read(n);
    return out;
  }

  /** Drive an input like a player would. Between ticks, like a click. */
  set(name: string, value: number): void {
    const io = this.inputs.get(name);
    if (!io) throw new Error(`No input named "${name}".`);
    const w = this.world;
    const single = io.bits.length === 1;
    io.bits.forEach((b, k) => {
      const bit = Math.floor(value / 2 ** k) % 2 === 1;
      const info = w.info(b.i);
      if (io.spec.as) {
        const want = bit ? io.spec.as : b.original;
        const cur = info.state.replace(/^minecraft:/, '');
        if (cur !== want.replace(/^minecraft:/, '') && info.state !== want) {
          if (bit) w.place(b.i, want.includes(':') ? want : `minecraft:${want}`);
          else if (b.original === 'minecraft:air') w.breakBlock(b.i);
          else w.place(b.i, b.original);
        }
        return;
      }
      switch (info.kind) {
        case K.LEVER:
          if (info.powered !== bit) w.use(b.i);
          return;
        case K.BUTTON:
          if (bit) w.use(b.i);
          return;
        case K.PLATE:
        case K.WEIGHTED_PLATE:
          w.setPlateEntities(b.i, single ? value : bit ? 1 : 0);
          return;
        case K.TARGET:
          if (bit || (single && value > 0))
            w.hitTarget(b.i, single ? Math.min(15, value) || 15 : 15);
          return;
        case K.DAYLIGHT:
        case K.SCULK_SENSOR:
          w.setPower(b.i, single ? Math.min(15, value) : bit ? 15 : 0);
          return;
        default:
          throw new Error(`${name}: ${info.name} at bit ${k} can't be driven.`);
      }
    });
  }

  /** Press a button input (every bit). */
  press(name: string): void {
    const io = this.inputs.get(name);
    if (!io) throw new Error(`No input named "${name}".`);
    for (const b of io.bits) {
      const info = this.world.info(b.i);
      if (info.kind !== K.BUTTON)
        throw new Error(
          `press ${name}: ${info.name} isn't a button — use {"pulse": {"${name}": ticks}}.`,
        );
      this.world.use(b.i);
    }
  }

  local(p: Vec3): number {
    return this.world.index(p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]);
  }
}

// ---------------------------------------------------------------- running tests

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The variable assignments of a test: every combination, or a seeded sample. */
export function testCases(test: TestSpec): Record<string, number>[] {
  const entries = Object.entries(test.forAll ?? {});
  if (entries.length === 0) return [{}];
  const domains = entries.map(([name, d]) => {
    const values = Array.isArray(d)
      ? Array.from({ length: Math.max(0, d[1] - d[0] + 1) }, (_, k) => d[0] + k)
      : d.values;
    return { name, values };
  });
  const total = domains.reduce((n, d) => n * d.values.length, 1);
  const limit = test.samples ?? 256;
  const pick = (index: number) => {
    const v: Record<string, number> = {};
    let rest = index;
    for (const d of domains) {
      v[d.name] = d.values[rest % d.values.length] as number;
      rest = Math.floor(rest / d.values.length);
    }
    return v;
  };
  if (total <= limit) return Array.from({ length: total }, (_, k) => pick(k));
  const rand = mulberry(test.seed ?? 1);
  const out: Record<string, number>[] = [];
  // The extremes first (all minimum, all maximum), then random combinations.
  out.push(pick(0), pick(total - 1));
  while (out.length < limit) out.push(pick(Math.floor(rand() * total)));
  return out;
}

function stepName(s: Step): string {
  return Object.keys(s)[0] ?? '?';
}

/**
 * Runs one case of a test, a tick at a time: each `yield` is one game tick, so the viewer can
 * play it at any speed and the server can run it flat out. Returns the failure, or null.
 */
export function* runCase(
  c: Circuit,
  test: TestSpec,
  vars: Record<string, number>,
  out: {
    notes: string[];
    trace?: Record<string, [number, number][]>;
    /** Updated with the step being run (for a live display). */
    progress?: { step: number };
  },
): Generator<number, Failure | null> {
  const w = c.world;
  const t0 = w.time;
  const pulses: { at: number; name: string; value: number }[] = [];
  const traced = out.trace ? (test.trace ?? []) : [];
  const last = new Map<string, number>();
  const sample = () => {
    for (const n of traced) {
      const v = c.read(n);
      if (last.get(n) !== v) {
        last.set(n, v);
        (out.trace as Record<string, [number, number][]>)[n] ??= [];
        (out.trace as Record<string, [number, number][]>)[n]?.push([w.time - t0, v]);
      }
    }
  };
  const lookup = (name: string): number | undefined =>
    name in vars
      ? vars[name]
      : c.inputs.has(name) || c.outputs.has(name)
        ? c.read(name)
        : undefined;
  const value = (v: Value): number => {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    return expr(v).eval(lookup);
  };
  const ticks = (v: Ticks): number => Math.max(0, Math.floor(typeof v === 'number' ? v : value(v)));
  const fail = (step: number, message: string): Failure => ({
    ...(Object.keys(vars).length ? { vars } : {}),
    tick: w.time - t0,
    step,
    message,
  });
  /** One game tick, applying pulses that end now. */
  function* tick(): Generator<number, void> {
    w.tick();
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k] as { at: number; name: string; value: number };
      if (w.time - t0 >= p.at) {
        c.set(p.name, p.value);
        pulses.splice(k, 1);
      }
    }
    sample();
    yield w.time - t0;
  }
  const check = (spec: Record<string, Value> | string): string | null => {
    if (typeof spec === 'string') {
      const e = expr(spec);
      return e.eval(lookup) ? null : `${spec} is false (${describe(e.names)})`;
    }
    const wrong: string[] = [];
    for (const [name, want] of Object.entries(spec)) {
      const got = c.read(name);
      const exp = value(want);
      if (got !== exp) wrong.push(`${name} is ${got}, expected ${exp}`);
    }
    return wrong.length ? wrong.join('; ') : null;
  };
  const describe = (names: ReadonlySet<string>) =>
    [...names].map((n) => `${n}=${lookup(n) ?? '?'}`).join(', ');

  sample();
  for (let s = 0; s < test.steps.length; s++) {
    const step = test.steps[s] as Step;
    if (out.progress) out.progress.step = s;
    try {
      if ('set' in step) {
        for (const [name, v] of Object.entries(step.set)) c.set(name, value(v));
        sample();
      } else if ('pulse' in step) {
        for (const [name, n] of Object.entries(step.pulse)) {
          c.set(name, 1);
          pulses.push({ at: w.time - t0 + Math.max(1, ticks(n)), name, value: 0 });
        }
        sample();
      } else if ('press' in step) {
        for (const name of Array.isArray(step.press) ? step.press : [step.press]) c.press(name);
        sample();
      } else if ('wait' in step) {
        const n = ticks(step.wait);
        for (let k = 0; k < n; k++) yield* tick();
      } else if ('settle' in step) {
        const max = step.settle === true ? 400 : ticks(step.settle);
        let k = 0;
        while ((!w.idle || pulses.length > 0) && k < max) {
          yield* tick();
          k++;
        }
        if (!w.idle) return fail(s, `still changing after ${max} ticks (a clock never settles)`);
      } else if ('measure' in step) {
        const rises: number[] = [];
        let highTicks = 0;
        let prev = c.read(step.measure);
        const total = ticks(step.ticks);
        for (let k = 0; k < total; k++) {
          yield* tick();
          const v = c.read(step.measure);
          if (v && !prev) rises.push(k);
          if (v) highTicks++;
          prev = v;
        }
        const period =
          rises.length >= 2
            ? ((rises[rises.length - 1] as number) - (rises[0] as number)) / (rises.length - 1)
            : 0;
        const high = rises.length ? highTicks / rises.length : highTicks ? total : 0;
        const m = { pulses: rises.length, period, high };
        if (out.notes.length < 40)
          out.notes.push(
            `${step.measure}: ${m.pulses} pulses in ${total} ticks` +
              (m.pulses >= 2 ? `, period ${round(m.period)}` : '') +
              (m.pulses ? `, high ${round(m.high)} ticks each` : ''),
          );
        for (const [k, want] of Object.entries(step.expect ?? {})) {
          const got = m[k as keyof typeof m];
          if (Math.abs(got - (want as number)) > 0.01)
            return fail(s, `${step.measure} ${k} is ${round(got)}, expected ${want as number}`);
        }
      } else if ('expect' in step) {
        if (step.within !== undefined) {
          const within = ticks(step.within);
          let k = 0;
          let wrong = check(step.expect);
          while (wrong && k < within) {
            yield* tick();
            k++;
            wrong = check(step.expect);
          }
          if (wrong) return fail(s, `not within ${within} ticks: ${wrong}`);
          if (out.notes.length < 40) out.notes.push(`${label(step.expect)} after ${k} ticks`);
        } else {
          let wrong = check(step.expect);
          if (wrong) return fail(s, wrong);
          const hold = ticks(step.for ?? 0);
          for (let k = 0; k < hold; k++) {
            yield* tick();
            wrong = check(step.expect);
            if (wrong) return fail(s, `held ${k} ticks, then ${wrong}`);
          }
        }
      } else if ('log' in step) {
        const names = Array.isArray(step.log) ? step.log : [step.log];
        if (out.notes.length < 40)
          out.notes.push(`t=${w.time - t0}: ${names.map((n) => `${n}=${c.read(n)}`).join(', ')}`);
      } else if ('use' in step) {
        w.use(c.local(step.use));
      } else if ('place' in step) {
        const b = step.place.block;
        w.place(c.local(step.place.at), b.includes(':') ? b : `minecraft:${b}`);
      } else if ('break' in step) {
        w.breakBlock(c.local(step.break));
      } else {
        return fail(s, `unknown step ${stepName(step)}`);
      }
    } catch (error) {
      return fail(s, error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}

const exprCache = new Map<string, Expr>();
function expr(src: string): Expr {
  let e = exprCache.get(src);
  if (!e) {
    e = new Expr(src);
    if (exprCache.size > 500) exprCache.clear();
    exprCache.set(src, e);
  }
  return e;
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function label(e: Record<string, Value> | string): string {
  return typeof e === 'string'
    ? e
    : Object.entries(e)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ');
}

/** Run every case of one test from the same starting state, until `deadline` (epoch ms). */
export function runTest(
  c: Circuit,
  test: TestSpec,
  start: WorldSnapshot,
  deadline = Infinity,
): TestResult {
  const result: TestResult = {
    name: test.name,
    ok: true,
    cases: 0,
    failed: 0,
    failures: [],
    notes: [],
    events: [],
    ticks: 0,
  };
  const cases = testCases(test);
  for (const vars of cases) {
    c.world.restore(start);
    const first = result.cases === 0;
    const out =
      first && test.trace?.length
        ? { notes: result.notes, trace: {} }
        : { notes: first ? result.notes : [] };
    const eventsBefore = c.world.events.length;
    const t0 = c.world.time;
    const gen = runCase(c, test, vars, out);
    let failure: Failure | null = null;
    let timedOut = false;
    try {
      let r = gen.next();
      for (let n = 1; !r.done; n++) {
        if ((n & 255) === 0 && Date.now() > deadline) {
          timedOut = true;
          break;
        }
        r = gen.next();
      }
      if (r.done) failure = r.value;
    } catch (error) {
      failure = {
        tick: c.world.time - t0,
        step: 0,
        message: `the simulation stopped: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (timedOut) {
      result.ok = false;
      result.failed++;
      result.failures.push({
        tick: c.world.time - t0,
        step: 0,
        message:
          'ran out of time (the tests of one build may take 15 s): fewer cases or shorter waits',
      });
      break;
    }
    result.cases++;
    result.ticks += c.world.time - t0;
    if (first) {
      if ('trace' in out && out.trace) result.trace = out.trace;
      const o = c.origin;
      for (const e of c.world.events.slice(eventsBefore))
        if (NOTABLE.has(e.type) && result.events.length < 20)
          result.events.push({
            ...e,
            tick: e.tick - t0,
            pos: [e.pos[0] + o[0], e.pos[1] + o[1], e.pos[2] + o[2]],
          });
    }
    if (failure) {
      result.ok = false;
      result.failed++;
      if (result.failures.length < 5) result.failures.push(failure);
    }
  }
  c.world.restore(start);
  return result;
}

/**
 * Power the circuit on and run its tests. The world is left in its rest state (the state right
 * after power-on), which is what the build should look like and export as.
 */
export function runCircuit(
  world: World,
  spec: CircuitSpec,
  origin: Vec3,
  opts: { tests?: TestSpec[]; budgetMs?: number } = {},
): { circuit: Circuit; report: CircuitReport } {
  const started = Date.now();
  const circuit = new Circuit(world, spec, origin);
  const t0 = world.time;
  const report: CircuitReport = {
    errors: [...circuit.errors],
    powerOn: { settled: false, ticks: 0 },
    tests: [],
    skipped: [],
    ms: 0,
  };
  try {
    report.powerOn.settled = world.powerOn(spec.settleTicks ?? 1200);
  } catch (error) {
    report.errors.push(
      `Power-on stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  report.powerOn.ticks = world.time - t0;
  const tests = opts.tests ?? spec.tests ?? [];
  if (report.errors.length === 0 && tests.length) {
    const start = world.snapshot();
    const deadline = started + (opts.budgetMs ?? 15_000);
    for (const t of tests) {
      if (Date.now() > deadline) {
        report.skipped.push(t.name);
        continue;
      }
      report.tests.push(runTest(circuit, t, start, deadline));
    }
    world.restore(start);
  }
  report.ms = Date.now() - started;
  return { circuit, report };
}

function fmtVars(v?: Record<string, number>): string {
  return v
    ? ` [${Object.entries(v)
        .map(([k, n]) => `${k}=${n}`)
        .join(', ')}]`
    : '';
}

/** The report as text for Claude: one line per test, details for failures. */
export function formatReport(r: CircuitReport): string {
  const lines: string[] = [];
  for (const e of r.errors) lines.push(`✗ ${e}`);
  lines.push(
    r.powerOn.settled
      ? `Power-on: the circuit rests after ${r.powerOn.ticks} ticks.`
      : `Power-on: still changing after ${r.powerOn.ticks} ticks — a clock, or something oscillating.`,
  );
  const passed = r.tests.filter((t) => t.ok).length;
  if (r.tests.length) lines.push(`Tests: ${passed}/${r.tests.length} passed (${r.ms} ms).`);
  for (const t of r.tests) {
    const cases = t.cases > 1 ? ` (${t.cases - t.failed}/${t.cases} cases)` : '';
    lines.push(`${t.ok ? '✓' : '✗'} ${t.name}${cases}`);
    for (const f of t.failures)
      lines.push(`    step ${f.step + 1}, t=${f.tick}${fmtVars(f.vars)}: ${f.message}`);
    if (t.failed > t.failures.length)
      lines.push(`    …and ${t.failed - t.failures.length} more failing cases`);
    for (const n of t.notes.slice(0, 12)) lines.push(`    · ${n}`);
    for (const [name, changes] of Object.entries(t.trace ?? {}))
      lines.push(`    ~ ${name}: ${changes.map(([tick, v]) => `${v}@${tick}`).join(' ')}`);
    for (const e of t.events.slice(0, 6))
      lines.push(
        `    ! ${e.type} at [${e.pos.join(', ')}] t=${e.tick}${e.detail ? ` (${e.detail})` : ''}`,
      );
  }
  if (r.skipped.length) lines.push(`Not run (time budget): ${r.skipped.join(', ')}`);
  return lines.join('\n');
}
