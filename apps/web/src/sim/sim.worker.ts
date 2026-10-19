/// <reference lib="webworker" />
import {
  Circuit,
  K,
  runCase,
  runCircuit,
  testCases,
  World,
  type CircuitSpec,
  type Failure,
  type SimEvent,
  type TestSpec,
  type WorldSnapshot,
} from '@minecraft-schematic-lab/redstone';
import type { Vec3 } from '@minecraft-schematic-lab/shared';
import type { InputKind, IoView, SimEntity, SimIn, SimOut, TestProgress } from './protocol';

/**
 * The redstone simulation for the viewer, off the main thread: the same engine the server runs
 * for Claude, so what the user plays here behaves exactly like the tests. It sends the blocks
 * that changed once per frame.
 */

const ctx = globalThis as unknown as DedicatedWorkerGlobalScope;

interface Loaded {
  buildId: string;
  size: Vec3;
  origin: Vec3;
  palette: string[];
  paletteIndex: Map<string, number>;
  sentPalette: number;
  data: Uint16Array;
  world: World;
  circuit: Circuit;
  spec: CircuitSpec;
  makeWorld: () => World;
  rest: WorldSnapshot | null;
  powered: boolean;
  settled: boolean | null;
  startTime: number;
}

let s: Loaded | null = null;
let playing = false;
let speed = 1;
let carry = 0;
let last = performance.now();
let test: {
  gen: Generator<number, Failure | null>;
  progress: TestProgress;
  spec: TestSpec;
} | null = null;
let eventsSent = 0;
/** Falling blocks were on screen in the last frame (so an empty list clears them). */
let entitiesShown = false;

function post(msg: SimOut, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function inputKind(kind: number, as?: string): InputKind {
  if (as) return 'block';
  switch (kind) {
    case K.LEVER:
      return 'lever';
    case K.BUTTON:
      return 'button';
    case K.PLATE:
      return 'plate';
    case K.WEIGHTED_PLATE:
      return 'weighted';
    case K.TARGET:
      return 'target';
    case K.TRAPPED_CHEST:
      return 'chest';
    case K.LIGHTNING_ROD:
      return 'strike';
    case K.RAIL:
      return 'rail';
    default:
      return 'power';
  }
}

/** States a component can switch to, so their models can be fetched before they're needed. */
function variantsOf(world: World): string[] {
  const out = new Set<string>();
  const st = world.states;
  const toggles = [
    'powered',
    'lit',
    'extended',
    'open',
    'triggered',
    'enabled',
    'locked',
    'inverted',
    'waterlogged',
  ];
  let fluids = false;
  for (let id = 0; id < st.size; id++) {
    const info = st.info(id);
    if (info.kind === K.LIQUID || info.waterloggable) fluids = true;
    if (info.kind === K.FALLING && info.name.endsWith('_concrete_powder'))
      out.add(`minecraft:${info.name.replace(/_powder$/, '')}`);
    if (info.kind === K.AIR || info.kind === K.SOLID) continue;
    let ids = [id];
    for (const key of toggles) {
      if (!(key in info.props)) continue;
      ids = ids.flatMap((x) => [st.withBool(x, key, true), st.withBool(x, key, false)]);
    }
    if (info.kind === K.WIRE || info.power >= 0)
      ids = ids.flatMap((x) => Array.from({ length: 16 }, (_, p) => st.withPower(x, p)));
    for (const x of ids) out.add(st.info(x).state);
    if (info.kind === K.PISTON) {
      for (const short of ['false', 'true'])
        out.add(
          `minecraft:piston_head[facing=${info.props.facing ?? 'north'},short=${short},type=${info.name === 'sticky_piston' ? 'sticky' : 'normal'}]`,
        );
    }
    if (out.size > 4000) break;
  }
  if (fluids)
    for (const name of ['water', 'lava'])
      for (let level = 0; level <= 8; level++) out.add(`minecraft:${name}[level=${level}]`);
  return [...out];
}

function load(msg: Extract<SimIn, { type: 'load' }>): void {
  const info = msg.info;
  const full = new Set(info.fullCubes);
  const spec = (info.circuit ?? {}) as CircuitSpec;
  const makeWorld = () =>
    new World({
      version: info.version,
      size: msg.size,
      palette: msg.palette,
      data: msg.data,
      isFullCube: (n) => full.has(n),
      defaults: info.defaults,
      blockEntities: info.blockEntities,
    });
  const world = makeWorld();
  const circuit = new Circuit(world, spec, msg.origin);
  s = {
    buildId: msg.buildId,
    size: msg.size,
    origin: msg.origin,
    palette: [...msg.palette],
    paletteIndex: new Map(msg.palette.map((p, i) => [p, i])),
    sentPalette: msg.palette.length,
    data: msg.data,
    world,
    circuit,
    spec,
    makeWorld,
    rest: null,
    powered: false,
    settled: null,
    startTime: 0,
  };
  playing = false;
  test = null;
  eventsSent = 0;
  entitiesShown = true;
  world.takeChanges();
  const view = (kind: 'input' | 'output') => {
    const map = kind === 'input' ? circuit.inputs : circuit.outputs;
    const out: IoView[] = [];
    for (const [name, io] of map) {
      const at = io.bits.map((b) => {
        const [x, y, z] = world.coords(b.i);
        return [x + msg.origin[0], y + msg.origin[1], z + msg.origin[2]] as Vec3;
      });
      const first = io.bits[0];
      out.push({
        name,
        kind:
          kind === 'output'
            ? 'output'
            : inputKind(first ? world.info(first.i).kind : -1, io.spec.as),
        bits: io.bits.length,
        at,
        ...(io.spec.read ? { read: io.spec.read } : {}),
      });
    }
    return out;
  };
  post({
    type: 'ready',
    buildId: msg.buildId,
    inputs: view('input'),
    outputs: view('output'),
    tests: (spec.tests ?? []).map((t) => t.name),
    errors: circuit.errors,
    variants: variantsOf(world),
  });
  frame();
}

/** Switch the circuit on the first time it's used (as if every block had just been placed). */
function powerOn(): void {
  if (!s || s.powered) return;
  s.powered = true;
  s.settled = s.world.powerOn(s.spec.settleTicks ?? 1200);
  s.rest = s.world.snapshot();
  s.startTime = s.world.time;
}

function frame(): void {
  if (!s) return;
  const w = s.world;
  const changes = w.takeChanges();
  const cells: number[] = [];
  const newStates: string[] = [];
  const [sx, sy, sz] = s.size;
  const paletteId = (state: string): number => {
    const st = s as Loaded;
    let id = st.paletteIndex.get(state);
    if (id === undefined) {
      id = st.palette.length;
      st.palette.push(state);
      st.paletteIndex.set(state, id);
      newStates.push(state);
    }
    return id;
  };
  for (const i of changes) {
    const [x, y, z] = w.coords(i);
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) continue;
    cells.push(x + sx * (z + sz * y), paletteId(w.displayState(i)));
  }
  let entities: SimEntity[] | null = null;
  if (w.falling.length || entitiesShown) {
    entities = w.falling.map((e) => ({
      id: e.id,
      state: paletteId(w.states.info(e.state).state),
      pos: [e.x, e.y, e.z] as Vec3,
    }));
    entitiesShown = entities.length > 0;
  }
  const events = w.events.slice(eventsSent).map((e) => ({
    ...e,
    pos: [e.pos[0] + s!.origin[0], e.pos[1] + s!.origin[1], e.pos[2] + s!.origin[2]] as Vec3,
  }));
  eventsSent = w.events.length;
  const buf = new Uint32Array(cells);
  post(
    {
      type: 'frame',
      tick: s.powered ? w.time - s.startTime : 0,
      playing,
      powered: s.powered,
      settled: s.settled,
      cells: buf,
      newStates,
      values: s.circuit.errors.length ? {} : s.circuit.values(),
      events: events as SimEvent[],
      test: test ? { ...test.progress } : null,
      entities,
    },
    [buf.buffer],
  );
}

function advance(): void {
  if (!s) return;
  if (test) {
    const r = test.gen.next();
    test.progress.tick = s.world.time - s.startTime;
    if (r.done) {
      test.progress.done = true;
      test.progress.ok = r.value === null;
      if (r.value) test.progress.message = r.value.message;
      playing = false;
      const done = test;
      test = null;
      frame();
      // Keep the final state of the run on screen; report it once.
      post({
        type: 'frame',
        tick: s.world.time - s.startTime,
        playing: false,
        powered: true,
        settled: s.settled,
        cells: new Uint32Array(0),
        newStates: [],
        values: s.circuit.values(),
        events: [],
        test: done.progress,
        entities: null,
      });
    }
    return;
  }
  s.world.tick();
}

/** The simulation clock: 20 ticks a second times the speed, or as many as fit (speed 0). */
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(250, now - last);
  last = now;
  if (!s || !playing) return;
  const budgetEnd = now + 12;
  let n: number;
  if (speed === 0) n = Infinity;
  else {
    carry += (dt / 1000) * 20 * speed;
    n = Math.floor(carry);
    carry -= n;
  }
  try {
    for (let k = 0; k < n && playing; k++) {
      advance();
      if (performance.now() > budgetEnd) {
        carry = 0;
        break;
      }
    }
  } catch (error) {
    playing = false;
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
  frame();
}, 16);

ctx.onmessage = (e: MessageEvent<SimIn>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      load(msg);
      return;
    }
    if (!s) return;
    switch (msg.type) {
      case 'play':
        powerOn();
        speed = msg.speed;
        playing = true;
        last = performance.now();
        break;
      case 'pause':
        playing = false;
        break;
      case 'speed':
        speed = msg.speed;
        break;
      case 'step':
        powerOn();
        playing = false;
        for (let k = 0; k < msg.ticks; k++) advance();
        break;
      case 'reset':
        playing = false;
        test = null;
        if (s.rest) {
          s.world.restore(s.rest);
          s.startTime = s.rest.time;
          eventsSent = s.world.events.length;
        }
        break;
      case 'use':
        powerOn();
        s.world.activate(s.world.index(...msg.pos), msg.hit);
        break;
      case 'set':
        powerOn();
        s.circuit.set(msg.name, msg.value);
        break;
      case 'press':
        powerOn();
        s.circuit.press(msg.name);
        break;
      case 'runTests': {
        // On a fresh copy, so the scene the user is looking at stays as it is.
        const { report } = runCircuit(s.makeWorld(), s.spec, s.origin);
        post({ type: 'tests', report });
        return;
      }
      case 'playTest': {
        powerOn();
        if (msg.circuit) {
          s.spec = msg.circuit;
          s.circuit = new Circuit(s.world, msg.circuit, s.origin);
        }
        if (s.rest) s.world.restore(s.rest);
        const progress: TestProgress = {
          name: msg.test.name,
          step: 0,
          steps: msg.test.steps.length,
          tick: 0,
          done: false,
        };
        s.startTime = s.world.time;
        const vars = testCases(msg.test)[0] ?? {};
        const gen = runCase(s.circuit, msg.test, vars, { notes: [], progress });
        test = { gen, progress, spec: msg.test };
        playing = true;
        last = performance.now();
        break;
      }
      case 'stopTest':
        test = null;
        playing = false;
        break;
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
  frame();
};
