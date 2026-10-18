import type { CircuitSpec, TestSpec } from '@minecraft-schematic-lab/redstone';
import type { BakedBlock, BuildHeader, Vec3 } from '@minecraft-schematic-lab/shared';
import { api } from '../api';
import type { Viewer } from '../engine/Viewer';
import { useApp } from '../store';
import type { SimIn, SimOut } from './protocol';
import { useSim } from './simStore';

/** Blocks the simulation brings to life; other builds never start the worker. */
const REDSTONE =
  /redstone|repeater|comparator|piston|observer|lever|_button|pressure_plate|daylight_detector|target|copper_bulb|note_block|tripwire_hook/;

export interface SimHost {
  viewer: Viewer | null;
  /** Models for these states (fetched or cached), null where there is none. */
  models(states: string[]): Promise<(BakedBlock | null)[]>;
  /** Fetch models ahead of time. */
  warm(states: string[]): void;
}

/**
 * The main-thread side of the redstone simulation: drives the worker, and turns its frames
 * into in-place updates of the 3D scene, fetching models for states it hasn't drawn before.
 */
export class SimController {
  private worker: Worker | null = null;
  private buildId: string | null = null;
  private models: (BakedBlock | null)[] = [];
  /** Palette of the scene: the build's, plus states the simulation added. */
  private palette: string[] = [];
  private nameIds: number[] = [];
  private names = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();
  private tests: TestSpec[] = [];
  /** Paused by the user: clicks then don't start the clock. */
  private userPaused = false;

  constructor(private readonly host: SimHost) {}

  private send(msg: SimIn): void {
    this.worker?.postMessage(msg);
  }

  /** A build was loaded into the viewer (data = its voxels as the server sent them). */
  async load(
    header: BuildHeader,
    data: Uint16Array,
    models: (BakedBlock | null)[],
    nameIds: Int32Array,
  ): Promise<void> {
    const sim = useSim.getState();
    const available = header.palette.some((s) => REDSTONE.test(s));
    this.buildId = header.buildId;
    if (!available) {
      sim.set({ available: false, ready: false, playing: false });
      this.send({ type: 'pause' });
      if (useApp.getState().tool === 'use') useApp.getState().set({ tool: 'navigate' });
      return;
    }
    const info = await api.sim().catch(() => null);
    if (!info || info.buildId !== header.buildId || this.buildId !== header.buildId) return;
    this.tests = ((info.circuit?.tests as TestSpec[] | undefined) ?? []).slice();
    this.models = [...models];
    this.palette = [...header.palette];
    this.nameIds = [...nameIds];
    this.names.clear();
    header.palette.forEach((st, i) =>
      this.names.set(st.replace(/\[.*$/, ''), nameIds[i] as number),
    );
    if (!this.worker) {
      this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<SimOut>) => this.onMessage(e.data);
    }
    this.chain = Promise.resolve();
    this.userPaused = false;
    sim.set({
      available: true,
      ready: false,
      playing: false,
      tick: 0,
      powered: false,
      settled: null,
      results: {},
      testRun: null,
      events: [],
      values: {},
    });
    this.send({
      type: 'load',
      buildId: header.buildId,
      size: header.size,
      origin: header.origin,
      palette: header.palette,
      data,
      info,
    });
  }

  private onMessage(msg: SimOut): void {
    const sim = useSim.getState();
    switch (msg.type) {
      case 'ready':
        if (msg.buildId !== this.buildId) return;
        sim.set({
          ready: true,
          inputs: msg.inputs,
          outputs: msg.outputs,
          tests: msg.tests,
          errors: msg.errors,
        });
        this.host.warm(msg.variants);
        return;
      case 'frame':
        // Frames apply in order, each once the models of its new states are in.
        this.chain = this.chain.then(() => this.applyFrame(msg));
        return;
      case 'tests': {
        const results: Record<
          string,
          { ok: boolean; cases: number; failed: number; message?: string }
        > = {};
        for (const t of msg.report.tests)
          results[t.name] = {
            ok: t.ok,
            cases: t.cases,
            failed: t.failed,
            ...(t.failures[0] ? { message: t.failures[0].message } : {}),
          };
        sim.set({ results, running: false });
        return;
      }
      case 'error':
        sim.set({ playing: false, running: false });
        console.warn('redstone simulation:', msg.message);
        return;
    }
  }

  private async applyFrame(f: Extract<SimOut, { type: 'frame' }>): Promise<void> {
    if (f.newStates.length) {
      const baked = await this.host.models(f.newStates);
      f.newStates.forEach((st, k) => {
        this.models.push(baked[k] ?? null);
        this.palette.push(st);
        const name = st.replace(/\[.*$/, '');
        let id = this.names.get(name);
        if (id === undefined) {
          id = this.names.size + 100000;
          this.names.set(name, id);
        }
        this.nameIds.push(id);
      });
    }
    if (f.cells.length)
      this.host.viewer?.patch(f.cells, this.models, Int32Array.from(this.nameIds));
    const sim = useSim.getState();
    const events = f.events.length
      ? [...f.events.slice(-20).reverse(), ...sim.events].slice(0, 30)
      : sim.events;
    if (f.test?.done && sim.testRun?.done !== true) {
      // A replay counts as a run of that test.
      sim.set({
        results: {
          ...sim.results,
          [f.test.name]: {
            ok: f.test.ok === true,
            cases: 1,
            failed: f.test.ok ? 0 : 1,
            ...(f.test.message ? { message: f.test.message } : {}),
          },
        },
      });
    }
    sim.set({
      tick: f.tick,
      playing: f.playing,
      powered: f.powered,
      settled: f.settled,
      values: f.values,
      events,
      testRun: f.test ?? (sim.testRun?.done ? sim.testRun : null),
    });
  }

  /** The state drawn with this palette index (it may be one the simulation added). */
  stateOf(id: number): string | undefined {
    return this.palette[id];
  }

  play(): void {
    const { speed } = useSim.getState();
    this.userPaused = false;
    this.send({ type: 'play', speed });
  }

  pause(): void {
    this.userPaused = true;
    this.send({ type: 'pause' });
  }

  /** Using the circuit starts its clock, like in the game, unless the user paused it. */
  private interact(msg: SimIn): void {
    this.send(msg);
    if (!useSim.getState().playing && !this.userPaused) this.play();
  }

  toggle(): void {
    if (useSim.getState().playing) this.pause();
    else this.play();
  }

  step(ticks = 1): void {
    this.send({ type: 'step', ticks });
  }

  setSpeed(speed: number): void {
    useSim.getState().set({ speed });
    this.send({ type: 'speed', speed });
  }

  reset(): void {
    useSim.getState().set({ testRun: null });
    this.send({ type: 'reset' });
  }

  use(pos: Vec3): void {
    this.interact({ type: 'use', pos });
  }

  setInput(name: string, value: number): void {
    this.interact({ type: 'set', name, value });
  }

  press(name: string): void {
    this.interact({ type: 'press', name });
  }

  runTests(): void {
    useSim.getState().set({ running: true });
    this.send({ type: 'runTests' });
  }

  playTest(test: TestSpec, circuit?: CircuitSpec): void {
    useSim.getState().set({ testRun: null });
    this.send({ type: 'playTest', test, ...(circuit ? { circuit } : {}) });
  }

  /** Replay one of the build's stored tests in the scene. */
  playStored(name: string): void {
    const test = this.tests.find((t) => t.name === name);
    if (test) this.playTest(test);
  }

  stopTest(): void {
    this.send({ type: 'stopTest' });
  }
}
