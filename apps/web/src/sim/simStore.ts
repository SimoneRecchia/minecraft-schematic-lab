import { create } from 'zustand';
import type { SimEvent } from '@minecraft-schematic-lab/redstone';
import type { IoView, TestProgress } from './protocol';

export interface TestOutcome {
  ok: boolean;
  cases: number;
  failed: number;
  message?: string;
}

/** Live redstone state, kept apart from the app store: it changes every frame while running. */
interface SimState {
  /** The build has redstone components. */
  available: boolean;
  ready: boolean;
  playing: boolean;
  /** Multiple of real game speed (20 ticks/s); 0 = as fast as possible. */
  speed: number;
  tick: number;
  powered: boolean;
  settled: boolean | null;
  inputs: IoView[];
  outputs: IoView[];
  tests: string[];
  errors: string[];
  values: Record<string, number>;
  results: Record<string, TestOutcome>;
  running: boolean;
  testRun: TestProgress | null;
  events: SimEvent[];
  set: (patch: Partial<SimState>) => void;
}

export const useSim = create<SimState>((set) => ({
  available: false,
  ready: false,
  playing: false,
  speed: 1,
  tick: 0,
  powered: false,
  settled: null,
  inputs: [],
  outputs: [],
  tests: [],
  errors: [],
  values: {},
  results: {},
  running: false,
  testRun: null,
  events: [],
  set: (patch) => set(patch),
}));
