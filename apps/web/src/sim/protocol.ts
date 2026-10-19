import type {
  CircuitReport,
  CircuitSpec,
  SimEvent,
  TestSpec,
} from '@minecraft-schematic-lab/redstone';
import type { SimInfo, Vec3 } from '@minecraft-schematic-lab/shared';

export type InputKind =
  | 'lever'
  | 'button'
  | 'plate'
  | 'weighted'
  | 'target'
  | 'power'
  | 'block'
  | 'chest'
  | 'strike'
  | 'rail';

export interface IoView {
  name: string;
  kind: InputKind | 'output';
  bits: number;
  /** Spec coordinates of each bit. */
  at: Vec3[];
  read?: 'bit' | 'power' | 'block';
}

export interface SimEntity {
  id: number;
  state: number;
  pos: Vec3;
}

export interface TestProgress {
  name: string;
  step: number;
  steps: number;
  tick: number;
  done: boolean;
  ok?: boolean;
  message?: string;
}

export type SimIn =
  | {
      type: 'load';
      buildId: string;
      size: Vec3;
      origin: Vec3;
      palette: string[];
      data: Uint16Array;
      info: SimInfo;
    }
  | { type: 'play'; speed: number }
  | { type: 'pause' }
  | { type: 'speed'; speed: number }
  | { type: 'step'; ticks: number }
  | { type: 'reset' }
  /**
   * Set a block off like a player (local coordinates): right-click it, step on a plate, shoot a
   * target (`hit`: where, in local coordinates, and the face's direction index).
   */
  | { type: 'use'; pos: Vec3; hit?: { face: number; point: Vec3 } }
  | { type: 'set'; name: string; value: number }
  | { type: 'press'; name: string }
  | { type: 'runTests' }
  | { type: 'playTest'; test: TestSpec; circuit?: CircuitSpec }
  | { type: 'stopTest' };

export type SimOut =
  | {
      type: 'ready';
      buildId: string;
      inputs: IoView[];
      outputs: IoView[];
      tests: string[];
      errors: string[];
      /** States the simulation will probably show (to fetch their models up front). */
      variants: string[];
    }
  | {
      type: 'frame';
      /** Game ticks since the simulation started. */
      tick: number;
      playing: boolean;
      /** Whether the circuit has been switched on yet. */
      powered: boolean;
      settled: boolean | null;
      /** Pairs of (volume cell index, palette index). */
      cells: Uint32Array;
      /** Palette entries added since the last frame, in order. */
      newStates: string[];
      values: Record<string, number>;
      events: SimEvent[];
      test: TestProgress | null;
      /** Falling blocks: palette index and position of the bottom (local block units). */
      entities: SimEntity[] | null;
    }
  | { type: 'tests'; report: CircuitReport }
  | { type: 'error'; message: string };
