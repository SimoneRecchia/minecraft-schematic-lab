import { buttonTicks, K, plateMaxWeight, PUSH } from './blocks';
import type { FullCubeTest, Kind } from './blocks';
import {
  containerSignal,
  containerSlots,
  hasAnalogOutput,
  itemsOf,
  maxStackSize,
  sameItem,
  stateSignal,
} from './containers';
import type { ItemStack, Slots } from './containers';
import {
  ALL,
  axisOf,
  clockwise,
  counterClockwise,
  DIR_NAMES,
  DOWN,
  DX,
  DY,
  DZ,
  EAST,
  HORIZONTAL,
  NORTH,
  OPPOSITE,
  SHAPE_ORDER,
  SOUTH,
  UP,
  UPDATE_ORDER,
  WEST,
} from './dirs';
import { FALL, FL, isLavaType, isWaterType, legacyLevel } from './shapes';
import type { FluidInfo } from './shapes';
import { SIDE_NONE, SIDE_SIDE, SIDE_UP, StateTable } from './states';
import type { StateInfo } from './states';
import { rulesFor } from './version';
import type { RedstoneRules } from './version';

export type Vec3 = [number, number, number];

/** Level.setBlock flags. */
export const F = {
  NEIGHBORS: 1,
  CLIENTS: 2,
  INVISIBLE: 4,
  KNOWN_SHAPE: 16,
  SUPPRESS_DROPS: 32,
  MOVED: 64,
} as const;
const UPDATE_ALL = 3;

/** TickPriority. */
const P_EXTREMELY_HIGH = -3;
const P_VERY_HIGH = -2;
const P_HIGH = -1;
const P_NORMAL = 0;

/** Something the simulation did that has no block state of its own. */
export interface SimEvent {
  tick: number;
  type:
    | 'note'
    | 'bell'
    | 'dispense'
    | 'craft'
    | 'tnt'
    | 'break'
    | 'burnout'
    | 'suppressed'
    | 'left-area'
    | 'land';
  pos: Vec3;
  detail?: string;
}

export interface WorldOptions {
  /** Minecraft release, e.g. "1.21.4": picks the mechanics that changed between versions. */
  version: string;
  size: Vec3;
  /** Canonical block states; index 0 is air. */
  palette: readonly string[];
  /** Palette indices in YZX order (x fastest), like BlockVolume. */
  data: ArrayLike<number>;
  /** Collision box is a full cube (the catalog knows). */
  isFullCube: FullCubeTest;
  /**
   * Default properties of blocks the engine creates (piston_head, moving_piston) in this
   * version, so new states stay valid for it. Missing entries use the modern properties.
   */
  defaults?: Record<string, Record<string, string>>;
  /** Solid ground under the build, like a paste on flat land (default true). */
  ground?: boolean;
  /**
   * Where the build sits in the world. Redstone dust and pistons update their neighbours in an
   * order that depends on world coordinates (Java hash sets); this picks the location.
   */
  offset?: Vec3;
  /** Air around the build that pistons can push into (default 6). */
  margin?: number;
  blockEntities?: readonly { pos: Vec3; data: Record<string, unknown> }[];
}

export interface WorldSnapshot {
  cells: Uint16Array;
  time: number;
  seq: number;
  heap: ScheduledTick[];
  fluidHeap: ScheduledTick[];
  events: BlockEvent[];
  moving: [number, MovingBlock][];
  tickers: MovingBlock[];
  pending: MovingBlock[];
  comparatorOut: Map<number, number>;
  inventories: Map<number, Slots>;
  plateEntities: Map<number, number>;
  toggles: { pos: number; when: number }[];
  eventLog: number;
  falling: FallingBlock[];
  hoppers: [number, HopperState][];
  hopperWake: boolean;
  openers: Map<number, number>;
}

/** FallingBlockEntity: a block dropping down its column. */
export interface FallingBlock {
  id: number;
  /** Local column. */
  x: number;
  z: number;
  /** Bottom of its box, in local block units. */
  y: number;
  vy: number;
  /** The block it carries. */
  state: number;
  /** Ticks lived. */
  time: number;
  /** Shatters on landing instead of being placed (suspicious sand and gravel). */
  cancelDrop: boolean;
}

/** HopperBlockEntity's timing. */
interface HopperState {
  cooldown: number;
  tickedGameTime: number;
}

interface ScheduledTick {
  time: number;
  priority: number;
  seq: number;
  pos: number;
  type: number;
}

interface BlockEvent {
  pos: number;
  type: number;
  b0: number;
  b1: number;
}

/** PistonMovingBlockEntity. */
export interface MovingBlock {
  pos: number;
  /** The state that lands when the move finishes. */
  state: number;
  dir: number;
  extending: boolean;
  /** The piston head (extending) or the base itself (retracting). */
  source: boolean;
  progress: number;
  progressO: number;
  lastTicked: number;
  removed: boolean;
}

/** LevelTicks: ticks scheduled per (position, type), run in (time, priority, order). */
class TickQueue {
  heap: ScheduledTick[] = [];
  readonly scheduled = new Map<number, ScheduledTick>();
  readonly running = new Set<number>();

  push(key: number, t: ScheduledTick): void {
    this.scheduled.set(key, t);
    const h = this.heap;
    h.push(t);
    let k = h.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!heapLess(t, h[parent] as ScheduledTick)) break;
      h[k] = h[parent] as ScheduledTick;
      k = parent;
    }
    h[k] = t;
  }

  pop(): ScheduledTick | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (!top || !last || h.length === 0) return top;
    let k = 0;
    const n = h.length;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && heapLess(h[r] as ScheduledTick, h[l] as ScheduledTick) ? r : l;
      if (!heapLess(h[c] as ScheduledTick, last)) break;
      h[k] = h[c] as ScheduledTick;
      k = c;
    }
    h[k] = last;
    return top;
  }

  load(heap: ScheduledTick[], key: (t: ScheduledTick) => number): void {
    this.heap = heap.map((t) => ({ ...t }));
    this.scheduled.clear();
    for (const t of this.heap) this.scheduled.set(key(t), t);
  }
}

/** Neighbour-update jobs (1.19+ CollectingNeighborUpdater). */
interface Job {
  kind: 0 | 1 | 2;
  pos: number;
  src: number;
  from: number;
  idx: number;
  skip: number;
  dir: number;
  state: number;
  flags: number;
  rec: number;
}

const PAD = 2;
/** Dust couldn't sit on these before 1.14. */
const GLASSY = /(^|_)glass$|^ice$|^sea_lantern$/;
const MAX_DEPTH = 900;
const MAX_UPDATES_PER_TICK = 20_000_000;

const MODERN_DEFAULTS: Record<string, Record<string, string>> = {
  piston_head: { facing: 'north', short: 'false', type: 'normal' },
  moving_piston: { facing: 'north', type: 'normal' },
};

function heapLess(a: ScheduledTick, b: ScheduledTick): boolean {
  return a.time !== b.time
    ? a.time < b.time
    : a.priority !== b.priority
      ? a.priority < b.priority
      : a.seq < b.seq;
}

/**
 * A Minecraft Java world reduced to what redstone needs, following the game's own code paths:
 * Level.setBlock with its flags, neighbour updates (W, E, down, up, N, S) and shape updates,
 * scheduled ticks ordered by time, priority and scheduling order, block events, and piston
 * moving-block entities, ticked in the game's phase order. Timing is in game ticks (20 per
 * second; one redstone tick = 2 game ticks).
 */
export class World {
  readonly rules: RedstoneRules;
  readonly states: StateTable;
  readonly size: Vec3;
  readonly offset: Vec3;
  /** Array dimensions and where local (0,0,0) sits in them. */
  readonly W: number;
  readonly H: number;
  readonly D: number;
  private readonly mx: number;
  private readonly my: number;
  private readonly mz: number;
  private readonly off: readonly number[];
  cells: Uint16Array;
  /** Game time: ticks completed. */
  time = 0;
  readonly events: SimEvent[] = [];

  private readonly AIR: number;
  private readonly defaults: Record<string, Record<string, string>>;
  private wireSignals = true;
  private handlingTick = false;
  private seq = 0;
  private readonly blockTicks = new TickQueue();
  private readonly fluidTicks = new TickQueue();
  private eventQueue: BlockEvent[] = [];
  private eventHead = 0;
  private readonly eventKeys = new Set<string>();
  readonly moving = new Map<number, MovingBlock>();
  private tickers: MovingBlock[] = [];
  private pendingTickers: MovingBlock[] = [];
  private readonly comparatorOut = new Map<number, number>();
  private readonly inventories = new Map<number, Slots>();
  private readonly plateEntities = new Map<number, number>();
  private toggles: { pos: number; when: number }[] = [];
  /** Falling block entities, in the order they were spawned (the game's entity order). */
  falling: FallingBlock[] = [];
  private nextEntityId = 1;
  /** Hopper block entities, ticked in the order they appeared. */
  private readonly hoppers = new Map<number, HopperState>();
  /** A hopper may move an item next tick (something changed since they last all failed). */
  private hopperWake = false;
  /** Players looking into a chest (trapped chests give that many as a signal). */
  private readonly openers = new Map<number, number>();
  private changedMark: Uint8Array;
  private changed: number[] = [];
  private depth = 0;
  private updates = 0;
  // queued updates (1.19+)
  private stack: Job[] = [];
  private added: Job[] = [];
  private count = 0;

  constructor(opts: WorldOptions) {
    this.rules = rulesFor(opts.version);
    this.states = new StateTable(opts.isFullCube);
    this.defaults = { ...MODERN_DEFAULTS, ...opts.defaults };
    this.size = [...opts.size];
    this.offset = opts.offset ?? [0, 64, 0];
    const margin = Math.max(0, opts.margin ?? 6);
    const [sx, sy, sz] = opts.size;
    this.mx = PAD + margin;
    this.mz = PAD + margin;
    this.my = PAD + 1;
    this.W = sx + 2 * this.mx;
    this.D = sz + 2 * this.mz;
    this.H = sy + this.my + margin + PAD;
    const total = this.W * this.H * this.D;
    this.cells = new Uint16Array(total);
    this.changedMark = new Uint8Array(total);
    this.off = [-this.W * this.D, this.W * this.D, -this.W, this.W, -1, 1];
    this.AIR = this.states.idOf('minecraft:air');
    const ids = opts.palette.map((s) => this.states.idOf(s));
    let i = 0;
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++, i++) {
          const id = ids[opts.data[i] as number];
          if (id !== undefined && id !== this.AIR) this.cells[this.index(x, y, z)] = id;
        }
    if (opts.ground ?? true) {
      const stone = this.states.idOf('minecraft:stone');
      for (let z = -margin; z < sz + margin; z++)
        for (let x = -margin; x < sx + margin; x++) this.cells[this.index(x, -1, z)] = stone;
    }
    if (this.AIR !== 0) throw new Error('air must be state 0');
    for (const be of opts.blockEntities ?? []) {
      const p = this.index(...be.pos);
      const slots = containerSlots(this.info(p).name);
      if (slots > 0) {
        const items = itemsOf(be.data, slots);
        if (items.some((s) => s)) this.inventories.set(p, items);
      }
      const out = be.data.OutputSignal;
      if (typeof out === 'number') this.comparatorOut.set(p, out);
    }
    for (let k = 0; k < this.cells.length; k++)
      if (this.states.kind(this.cells[k] as number) === K.HOPPER)
        this.hoppers.set(k, { cooldown: -1, tickedGameTime: 0 });
    this.hopperWake = this.hoppers.size > 0;
  }

  // ---------------------------------------------------------------- coordinates

  /** Cell index of local build coordinates (no bounds check). */
  index(x: number, y: number, z: number): number {
    return x + this.mx + this.W * (z + this.mz + this.D * (y + this.my));
  }

  /** Local build coordinates of a cell. */
  coords(i: number): Vec3 {
    const x = i % this.W;
    const t = (i - x) / this.W;
    const z = t % this.D;
    const y = (t - z) / this.D;
    return [x - this.mx, y - this.my, z - this.mz];
  }

  /** Inside the simulated area (the build, its margin and the ground layer). */
  valid(i: number): boolean {
    if (i < 0 || i >= this.cells.length) return false;
    const x = i % this.W;
    const t = (i - x) / this.W;
    const z = t % this.D;
    const y = (t - z) / this.D;
    return (
      x >= PAD && x < this.W - PAD && z >= PAD && z < this.D - PAD && y >= PAD && y < this.H - PAD
    );
  }

  inBuild(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size[0] && y < this.size[1] && z < this.size[2];
  }

  rel(i: number, d: number, n = 1): number {
    return i + (this.off[d] as number) * n;
  }

  info(i: number): StateInfo {
    return this.states.infos[this.cells[i] as number] as StateInfo;
  }

  stateAt(x: number, y: number, z: number): string {
    return this.info(this.index(x, y, z)).state;
  }

  /** What the viewer should draw: a moving block shows the block it carries, where it lands. */
  displayState(i: number): string {
    const m = this.moving.get(i);
    return m ? this.states.info(m.state).state : this.info(i).state;
  }

  /** Java's BlockPos.hashCode at this cell's world position (for HashSet/HashMap order). */
  private hashOf(i: number): number {
    const [x, y, z] = this.coords(i);
    const wx = x + this.offset[0];
    const wy = y + this.offset[1];
    const wz = z + this.offset[2];
    return (Math.imul((wy + Math.imul(wz, 31)) | 0, 31) + wx) | 0;
  }

  /** Iteration order of a Java HashSet/HashMap (capacity 16) holding these cells. */
  private javaHashOrder(cells: number[], hashes: number[]): number[] {
    const bucket = hashes.map((h) => (h ^ (h >>> 16)) & 15);
    const idx = cells.map((_, k) => k);
    idx.sort((a, b) => (bucket[a] as number) - (bucket[b] as number) || a - b);
    return idx.map((k) => cells[k] as number);
  }

  // ---------------------------------------------------------------- change tracking

  private markChanged(i: number): void {
    if (this.changedMark[i]) return;
    this.changedMark[i] = 1;
    this.changed.push(i);
  }

  /** Cells whose state (or displayed state) changed since the last call. */
  takeChanges(): number[] {
    const out = this.changed;
    this.changed = [];
    for (const i of out) this.changedMark[i] = 0;
    return out;
  }

  private event(type: SimEvent['type'], i: number, detail?: string): void {
    this.events.push({ tick: this.time, type, pos: this.coords(i), ...(detail ? { detail } : {}) });
    if (this.events.length > 5000) this.events.splice(0, 1000);
  }

  // ---------------------------------------------------------------- Level.setBlock

  setBlock(i: number, id: number, flags: number, rec = 512): boolean {
    if (!this.valid(i)) {
      if (id !== this.AIR) this.event('left-area', i, this.states.info(id).name);
      return false;
    }
    const oldId = this.cells[i] as number;
    if (oldId === id) return false;
    this.cells[i] = id;
    this.markChanged(i);
    const oldI = this.states.info(oldId);
    const newI = this.states.info(id);
    const moved = (flags & F.MOVED) !== 0;
    this.onRemove(i, oldI, newI, moved);
    if (this.info(i).nameId !== newI.nameId) return false;
    this.onPlace(i, newI, oldI, moved);
    if (this.cells[i] !== id) return true;
    if (flags & F.NEIGHBORS) {
      this.updateNeighborsAt(i, oldI.nameId);
      if (hasAnalogOutput(newI.name)) this.updateNeighbourForOutputSignal(i, newI.nameId);
    }
    if (!(flags & F.KNOWN_SHAPE) && rec > 0) {
      const f = flags & ~(F.NEIGHBORS | F.SUPPRESS_DROPS);
      this.updateIndirectNeighbourShapes(oldI, i, f, rec - 1);
      this.updateNeighbourShapes(newI, i, f, rec - 1);
      this.updateIndirectNeighbourShapes(newI, i, f, rec - 1);
    }
    return true;
  }

  /** Level.removeBlock: the fluid left behind (always air here). */
  removeBlock(i: number): boolean {
    return this.setBlock(i, this.AIR, UPDATE_ALL);
  }

  /** Level.destroyBlock: the block drops as an item. */
  destroyBlock(i: number, rec = 512): boolean {
    const info = this.info(i);
    if (info.kind === K.AIR) return false;
    this.event('break', i, info.name);
    return this.setBlock(i, this.AIR, UPDATE_ALL, rec);
  }

  private updateOrDestroy(oldId: number, newId: number, i: number, flags: number, rec: number) {
    if (newId === oldId) return;
    if (this.states.kind(newId) === K.AIR) this.destroyBlock(i, rec);
    else this.setBlock(i, newId, flags & ~F.SUPPRESS_DROPS, rec);
  }

  // ---------------------------------------------------------------- neighbour updates

  private guard(): boolean {
    if (++this.updates > MAX_UPDATES_PER_TICK) {
      throw new Error('More than 20 million block updates in one tick: the circuit loops.');
    }
    return true;
  }

  /** Level.neighborChanged. */
  neighborChanged(i: number, src: number, from: number): void {
    if (this.rules.queuedUpdates) {
      this.addAndRun(this.job(0, i, src, from));
      return;
    }
    if (this.depth > MAX_DEPTH) {
      this.event('suppressed', i);
      return;
    }
    this.depth++;
    try {
      this.runNeighborChanged(i, src, from);
    } finally {
      this.depth--;
    }
  }

  /** Level.updateNeighborsAt: the six neighbours in the game's order. */
  updateNeighborsAt(i: number, src: number, skip = -1): void {
    if (this.rules.queuedUpdates) {
      this.addAndRun(this.job(1, i, src, i, skip));
      return;
    }
    for (const d of UPDATE_ORDER) if (d !== skip) this.neighborChanged(this.rel(i, d), src, i);
  }

  private neighborShapeChanged(
    dir: number,
    neighborState: number,
    i: number,
    from: number,
    flags: number,
    rec: number,
  ): void {
    if (this.rules.queuedUpdates) {
      const j = this.job(2, i, 0, from);
      j.dir = dir;
      j.state = neighborState;
      j.flags = flags;
      j.rec = rec;
      this.addAndRun(j);
      return;
    }
    this.runShapeUpdate(dir, neighborState, i, from, flags, rec);
  }

  private job(kind: 0 | 1 | 2, pos: number, src: number, from: number, skip = -1): Job {
    return {
      kind,
      pos,
      src,
      from,
      idx: kind === 1 && UPDATE_ORDER[0] === skip ? 1 : 0,
      skip,
      dir: 0,
      state: 0,
      flags: 0,
      rec: 0,
    };
  }

  /** CollectingNeighborUpdater.addAndRun. */
  private addAndRun(job: Job): void {
    const nested = this.count > 0;
    this.count++;
    if (nested) this.added.push(job);
    else this.stack.push(job);
    if (nested) return;
    try {
      while (this.stack.length > 0 || this.added.length > 0) {
        for (let k = this.added.length - 1; k >= 0; k--) this.stack.push(this.added[k] as Job);
        this.added.length = 0;
        const top = this.stack[this.stack.length - 1] as Job;
        while (this.added.length === 0) {
          if (!this.runJobStep(top)) {
            this.stack.pop();
            break;
          }
        }
      }
    } finally {
      this.stack.length = 0;
      this.added.length = 0;
      this.count = 0;
    }
  }

  /** Run one step of a job; false when it has none left. */
  private runJobStep(j: Job): boolean {
    if (j.kind === 0) {
      this.runNeighborChanged(j.pos, j.src, j.from);
      return false;
    }
    if (j.kind === 2) {
      this.runShapeUpdate(j.dir, j.state, j.pos, j.from, j.flags, j.rec);
      return false;
    }
    const d = UPDATE_ORDER[j.idx++] as number;
    this.runNeighborChanged(this.rel(j.pos, d), j.src, j.pos);
    if (j.idx < 6 && UPDATE_ORDER[j.idx] === j.skip) j.idx++;
    return j.idx < 6;
  }

  private runShapeUpdate(
    dir: number,
    neighborState: number,
    i: number,
    from: number,
    flags: number,
    rec: number,
  ): void {
    this.guard();
    const old = this.cells[i] as number;
    const next = this.updateShape(i, old, dir, neighborState, from);
    this.updateOrDestroy(old, next, i, flags, rec);
  }

  /** BlockState.updateNeighbourShapes. */
  private updateNeighbourShapes(info: StateInfo, i: number, flags: number, rec: number): void {
    for (const d of SHAPE_ORDER)
      this.neighborShapeChanged(OPPOSITE[d], info.id, this.rel(i, d), i, flags, rec);
  }

  /** Only dust has indirect shape updates: wires one block up or down its connections. */
  private updateIndirectNeighbourShapes(info: StateInfo, i: number, flags: number, rec: number) {
    if (info.kind !== K.WIRE) return;
    for (const d of HORIZONTAL) {
      if (info.sides[d] === SIDE_NONE) continue;
      const n = this.rel(i, d);
      if (this.info(n).kind === K.WIRE) continue;
      const below = this.rel(n, DOWN);
      if (this.info(below).kind === K.WIRE) {
        const p = this.rel(below, OPPOSITE[d]);
        this.neighborShapeChanged(OPPOSITE[d], this.cells[p] as number, below, p, flags, rec);
      }
      const above = this.rel(n, UP);
      if (this.info(above).kind === K.WIRE) {
        const p = this.rel(above, OPPOSITE[d]);
        this.neighborShapeChanged(OPPOSITE[d], this.cells[p] as number, above, p, flags, rec);
      }
    }
  }

  /** Block.updateFromNeighbourShapes. */
  private updateFromNeighbourShapes(id: number, i: number): number {
    let s = id;
    for (const d of SHAPE_ORDER) {
      const n = this.rel(i, d);
      s = this.updateShape(i, s, d, this.cells[n] as number, n);
    }
    return s;
  }

  /** Level.updateNeighbourForOutputSignal: comparators next to (or behind a block from) it. */
  private updateNeighbourForOutputSignal(i: number, src: number): void {
    for (const d of HORIZONTAL) {
      let n = this.rel(i, d);
      let ni = this.info(n);
      if (ni.kind === K.COMPARATOR) this.neighborChanged(n, src, i);
      else if (ni.conductor) {
        n = this.rel(n, d);
        ni = this.info(n);
        if (ni.kind === K.COMPARATOR) this.neighborChanged(n, src, i);
      }
    }
  }

  // ---------------------------------------------------------------- scheduled ticks

  private tickKey(i: number, type: number): number {
    return i * 4096 + type;
  }

  /** Level.scheduleTick; `type` is the block asking (default: the block there now). */
  scheduleTick(i: number, delay: number, priority = P_NORMAL, type = this.info(i).nameId): void {
    const key = this.tickKey(i, type);
    if (this.blockTicks.scheduled.has(key)) return;
    this.blockTicks.push(key, { time: this.time + delay, priority, seq: this.seq++, pos: i, type });
  }

  /** Level.scheduleTick for a fluid (type is the fluid: FL.WATER, FL.FLOWING_WATER…). */
  private scheduleFluidTick(i: number, type: number, delay: number): void {
    const key = this.tickKey(i, type);
    if (this.fluidTicks.scheduled.has(key)) return;
    this.fluidTicks.push(key, {
      time: this.time + delay,
      priority: P_NORMAL,
      seq: this.seq++,
      pos: i,
      type,
    });
  }

  hasScheduledTick(i: number): boolean {
    return this.blockTicks.scheduled.has(this.tickKey(i, this.info(i).nameId));
  }

  private willTickThisTick(i: number): boolean {
    return this.blockTicks.running.has(this.tickKey(i, this.info(i).nameId));
  }

  /** LevelTicks.tick: everything due now, at most maxScheduledPerTick, in order. */
  private runTicks(q: TickQueue, run: (t: ScheduledTick) => void): void {
    this.handlingTick = true;
    try {
      const due: ScheduledTick[] = [];
      while (q.heap.length > 0 && (q.heap[0] as ScheduledTick).time <= this.time) {
        if (due.length >= this.rules.maxScheduledPerTick) break;
        const t = q.pop() as ScheduledTick;
        const key = this.tickKey(t.pos, t.type);
        q.scheduled.delete(key);
        q.running.add(key);
        due.push(t);
      }
      for (const t of due) {
        q.running.delete(this.tickKey(t.pos, t.type));
        run(t);
      }
    } finally {
      this.handlingTick = false;
      q.running.clear();
    }
  }

  private runScheduledTicks(): void {
    this.runTicks(this.blockTicks, (t) => {
      if (this.info(t.pos).nameId === t.type) this.tickBlock(t.pos);
    });
  }

  /** ServerLevel.tickFluid: the fluid there must still be of the type that asked. */
  private runFluidTicks(): void {
    this.runTicks(this.fluidTicks, (t) => {
      if (this.info(t.pos).fluid.type === t.type) this.tickFluid(t.pos);
    });
  }

  // ---------------------------------------------------------------- block events

  blockEvent(i: number, b0: number, b1: number): void {
    const type = this.info(i).nameId;
    const key = `${i},${type},${b0},${b1}`;
    if (this.eventKeys.has(key)) return;
    this.eventKeys.add(key);
    this.eventQueue.push({ pos: i, type, b0, b1 });
  }

  private runBlockEvents(): void {
    while (this.eventHead < this.eventQueue.length) {
      const e = this.eventQueue[this.eventHead++] as BlockEvent;
      this.eventKeys.delete(`${e.pos},${e.type},${e.b0},${e.b1}`);
      if (this.info(e.pos).nameId === e.type) this.triggerEvent(e.pos, e.b0, e.b1);
    }
    this.eventQueue = [];
    this.eventHead = 0;
  }

  // ---------------------------------------------------------------- the game tick

  /**
   * One game tick, in ServerLevel.tick's order: block ticks, fluid ticks, block events, entities
   * (pressure plates, falling blocks), block entities (hoppers, moving pistons).
   */
  tick(): void {
    this.time++;
    this.updates = 0;
    this.runScheduledTicks();
    this.runFluidTicks();
    this.runBlockEvents();
    this.tickEntities();
    this.tickBlockEntities();
  }

  run(ticks: number): void {
    for (let t = 0; t < ticks; t++) this.tick();
  }

  /** Nothing scheduled, queued, falling or moving: the circuit rests until something changes. */
  get idle(): boolean {
    if (this.blockTicks.heap.length > 0 || this.fluidTicks.heap.length > 0) return false;
    if (this.eventQueue.length > this.eventHead || this.falling.length > 0) return false;
    if (this.tickers.some((m) => !m.removed) || this.pendingTickers.some((m) => !m.removed))
      return false;
    for (const n of this.plateEntities.values()) if (n > 0) return false;
    if (this.hopperWake) return false;
    for (const h of this.hoppers.values()) if (h.cooldown > 0) return false;
    return true;
  }

  /** Ticks until the next scheduled tick (Infinity if none). */
  get nextTickIn(): number {
    const t = this.blockTicks.heap[0];
    const f = this.fluidTicks.heap[0];
    const next = Math.min(t?.time ?? Infinity, f?.time ?? Infinity);
    return Number.isFinite(next) ? Math.max(0, next - this.time) : Infinity;
  }

  private tickEntities(): void {
    for (const [i, n] of this.plateEntities) {
      if (n <= 0) continue;
      const info = this.info(i);
      if (info.kind !== K.PLATE && info.kind !== K.WEIGHTED_PLATE) continue;
      // Entity.checkInsideBlocks → entityInside: only an unpowered plate reacts at once.
      if (this.plateSignal(info) === 0) this.checkPlate(i, info, 0);
    }
    if (this.falling.length) {
      const ticked = [...this.falling];
      const gone = new Set<FallingBlock>();
      for (const e of ticked) if (!this.tickFalling(e)) gone.add(e);
      if (gone.size) this.falling = this.falling.filter((e) => !gone.has(e));
    }
  }

  private tickBlockEntities(): void {
    if (this.hoppers.size) this.hopperWake = this.tickHoppers();
    if (this.pendingTickers.length) {
      this.tickers.push(...this.pendingTickers);
      this.pendingTickers = [];
    }
    const list = this.tickers;
    for (let k = 0; k < list.length; k++) {
      const m = list[k] as MovingBlock;
      if (m.removed) continue;
      if (this.info(m.pos).kind !== K.MOVING_PISTON) {
        m.removed = true;
        if (this.moving.get(m.pos) === m) this.moving.delete(m.pos);
        continue;
      }
      this.tickMoving(m);
    }
    this.tickers = list.filter((m) => !m.removed);
  }

  // ---------------------------------------------------------------- signals

  /** BlockState.getSignal: what the block at i gives a neighbour that looks at it along d. */
  private signal(i: number, info: StateInfo, d: number): number {
    switch (info.kind) {
      case K.WIRE:
        return this.wireSignal(i, info, d);
      case K.TORCH:
        return info.lit && d !== UP ? 15 : 0;
      case K.WALL_TORCH:
        return info.lit && info.facing !== d ? 15 : 0;
      case K.REPEATER:
        return info.powered && info.facing === d ? 15 : 0;
      case K.COMPARATOR:
        return info.powered && info.facing === d ? (this.comparatorOut.get(i) ?? 0) : 0;
      case K.LEVER:
      case K.BUTTON:
      case K.LIGHTNING_ROD:
      case K.LECTERN:
      case K.TRIPWIRE_HOOK:
        return info.powered ? 15 : 0;
      case K.PLATE:
      case K.WEIGHTED_PLATE:
        return this.plateSignal(info);
      case K.REDSTONE_BLOCK:
        return 15;
      case K.OBSERVER:
        return info.powered && info.facing === d ? 15 : 0;
      case K.TARGET:
      case K.DAYLIGHT:
      case K.SCULK_SENSOR:
        return Math.max(0, info.power);
      case K.RAIL:
        return info.name === 'detector_rail' && info.powered ? 15 : 0;
      case K.TRAPPED_CHEST:
        return Math.min(15, this.openers.get(i) ?? 0);
      default:
        return 0;
    }
  }

  /** BlockState.getDirectSignal (strong power). */
  private directSignal(i: number, info: StateInfo, d: number): number {
    switch (info.kind) {
      case K.WIRE:
        return this.wireSignal(i, info, d);
      case K.TORCH:
      case K.WALL_TORCH:
        return d === DOWN ? this.signal(i, info, d) : 0;
      case K.REPEATER:
      case K.COMPARATOR:
      case K.OBSERVER:
        return this.signal(i, info, d);
      case K.LEVER:
      case K.BUTTON:
        return info.powered && connectedDir(info) === d ? 15 : 0;
      case K.PLATE:
      case K.WEIGHTED_PLATE:
        return d === UP ? this.plateSignal(info) : 0;
      case K.LIGHTNING_ROD:
      case K.TRIPWIRE_HOOK:
        return info.powered && info.facing === d ? 15 : 0;
      case K.LECTERN:
        return d === UP && info.powered ? 15 : 0;
      case K.SCULK_SENSOR:
        return d === UP ? Math.max(0, info.power) : 0;
      case K.RAIL:
        return d === UP && info.name === 'detector_rail' && info.powered ? 15 : 0;
      case K.TRAPPED_CHEST:
        return d === UP ? this.signal(i, info, d) : 0;
      default:
        return 0;
    }
  }

  /** Level.getSignal: a conductor passes on the strong power it receives. */
  levelSignal(i: number, d: number): number {
    const info = this.info(i);
    const s = this.signal(i, info, d);
    return info.conductor ? Math.max(s, this.directSignalTo(i)) : s;
  }

  /** Level.getDirectSignalTo: strongest strong power into a block. */
  private directSignalTo(i: number): number {
    let best = 0;
    for (const d of ALL) {
      const n = this.rel(i, d);
      const s = this.directSignal(n, this.info(n), d);
      if (s > best) {
        best = s;
        if (best >= 15) return best;
      }
    }
    return best;
  }

  hasNeighborSignal(i: number): boolean {
    for (const d of ALL) if (this.levelSignal(this.rel(i, d), d) > 0) return true;
    return false;
  }

  bestNeighborSignal(i: number): number {
    let best = 0;
    for (const d of ALL) {
      const s = this.levelSignal(this.rel(i, d), d);
      if (s > best) {
        best = s;
        if (best >= 15) return best;
      }
    }
    return best;
  }

  /**
   * Power a block receives from its neighbours, without passing through other blocks: what a
   * redstone lamp or piston placed there would see. For probes.
   */
  receivedPower(i: number): number {
    let best = this.directSignalTo(i);
    for (const d of ALL) {
      const n = this.rel(i, d);
      best = Math.max(best, this.signal(n, this.info(n), d));
    }
    return best;
  }

  private isSignalSource(info: StateInfo): boolean {
    return info.kind === K.WIRE ? this.wireSignals : info.signalSource;
  }

  // ---------------------------------------------------------------- redstone dust

  private wireSignal(i: number, info: StateInfo, d: number): number {
    if (!this.wireSignals || d === DOWN || info.power <= 0) return 0;
    if (d === UP) return info.power;
    if (this.rules.liveDustSides) return this.legacyWirePowers(i, d) ? info.power : 0;
    return info.sides[OPPOSITE[d] as number] !== SIDE_NONE ? info.power : 0;
  }

  /** 1.8–1.15 BlockRedstoneWire.getWeakPower: sides worked out from the neighbours. */
  private legacyWirePowers(i: number, d: number): boolean {
    let set = 0;
    for (const e of HORIZONTAL) if (this.legacyPowerSourceAt(i, e)) set |= 1 << e;
    if (set === 0) return true;
    return (
      (set & (1 << d)) !== 0 &&
      (set & (1 << counterClockwise(d))) === 0 &&
      (set & (1 << clockwise(d))) === 0
    );
  }

  private legacyPowerSourceAt(i: number, side: number): boolean {
    const b = this.rel(i, side);
    const bi = this.info(b);
    const aboveConducts = this.info(this.rel(i, UP)).conductor;
    if (!aboveConducts && bi.conductor && this.info(this.rel(b, UP)).kind === K.WIRE) return true;
    if (this.wireConnectsTo(bi, side)) return true;
    if (bi.kind === K.REPEATER && bi.powered && bi.facing === side) return true;
    return !bi.conductor && this.info(this.rel(b, DOWN)).kind === K.WIRE;
  }

  /** RedStoneWireBlock.shouldConnectTo (dir -1 = null). */
  private wireConnectsTo(info: StateInfo, dir: number): boolean {
    if (info.kind === K.WIRE) return true;
    if (info.kind === K.REPEATER)
      return dir >= 0 && (info.facing === dir || info.facing === OPPOSITE[dir]);
    if (info.kind === K.OBSERVER) return dir === info.facing;
    return dir >= 0 && this.isSignalSource(info);
  }

  private canHoldWire(info: StateInfo): boolean {
    if (!this.rules.dustOnGlass && GLASSY.test(info.name)) return false;
    return info.sturdyTop || info.kind === K.HOPPER;
  }

  private connectingSide(i: number, dir: number, canConnectUp: boolean): number {
    const n = this.rel(i, dir);
    const ni = this.info(n);
    if (canConnectUp && this.canHoldWire(ni) && this.wireConnectsTo(this.info(this.rel(n, UP)), -1))
      return ni.sturdySide ? SIDE_UP : SIDE_SIDE;
    if (
      !this.wireConnectsTo(ni, dir) &&
      (ni.conductor || !this.wireConnectsTo(this.info(this.rel(n, DOWN)), -1))
    )
      return SIDE_NONE;
    return SIDE_SIDE;
  }

  /** RedStoneWireBlock.getConnectionState (1.16+), or plain connections before 1.16. */
  private wireConnectionState(i: number, id: number): number {
    const st = this.states;
    const info = st.info(id);
    const canUp = !this.info(this.rel(i, UP)).conductor;
    let n = this.connectingSide(i, NORTH, canUp);
    let e = this.connectingSide(i, EAST, canUp);
    let s = this.connectingSide(i, SOUTH, canUp);
    let w = this.connectingSide(i, WEST, canUp);
    if (this.rules.liveDustSides) return st.withSides(id, n, e, s, w);
    const wasDot = isDot(info);
    if (wasDot && !n && !e && !s && !w) return st.withSides(id, 0, 0, 0, 0);
    const noNS = !n && !s;
    const noEW = !e && !w;
    if (!w && noNS) w = SIDE_SIDE;
    if (!e && noNS) e = SIDE_SIDE;
    if (!n && noEW) n = SIDE_SIDE;
    if (!s && noEW) s = SIDE_SIDE;
    return st.withSides(id, n, e, s, w);
  }

  private wireUpdateShape(i: number, id: number, dir: number): number {
    if (dir === DOWN) return id;
    if (dir === UP || this.rules.liveDustSides) return this.wireConnectionState(i, id);
    const info = this.states.info(id);
    const side = this.connectingSide(i, dir, !this.info(this.rel(i, UP)).conductor);
    if ((side !== SIDE_NONE) === (info.sides[dir] !== SIDE_NONE) && !isCross(info))
      return this.states.withSide(id, dir, side);
    const cross = this.states.withSides(id, SIDE_SIDE, SIDE_SIDE, SIDE_SIDE, SIDE_SIDE);
    return this.wireConnectionState(i, this.states.withSide(cross, dir, side));
  }

  private wirePower(info: StateInfo): number {
    return info.kind === K.WIRE ? info.power : 0;
  }

  private wireTarget(i: number): number {
    this.wireSignals = false;
    const received = this.bestNeighborSignal(i);
    this.wireSignals = true;
    let j = 0;
    if (received < 15) {
      const aboveConducts = this.info(this.rel(i, UP)).conductor;
      for (const d of HORIZONTAL) {
        const n = this.rel(i, d);
        const ni = this.info(n);
        j = Math.max(j, this.wirePower(ni));
        if (ni.conductor && !aboveConducts)
          j = Math.max(j, this.wirePower(this.info(this.rel(n, UP))));
        else if (!ni.conductor) j = Math.max(j, this.wirePower(this.info(this.rel(n, DOWN))));
      }
    }
    return Math.max(received, j - 1);
  }

  /** 1.8–1.12 calculateCurrentChanges: one level at a time while depowering. */
  private legacyWireTarget(i: number, info: StateInfo): number {
    let j = info.power;
    this.wireSignals = false;
    const k = this.bestNeighborSignal(i);
    this.wireSignals = true;
    if (k > 0 && k > j - 1) j = k;
    let l = 0;
    const aboveConducts = this.info(this.rel(i, UP)).conductor;
    for (const d of HORIZONTAL) {
      const n = this.rel(i, d);
      const ni = this.info(n);
      l = Math.max(l, this.wirePower(ni));
      if (ni.conductor && !aboveConducts)
        l = Math.max(l, this.wirePower(this.info(this.rel(n, UP))));
      else if (!ni.conductor) l = Math.max(l, this.wirePower(this.info(this.rel(n, DOWN))));
    }
    if (l > j) j = l - 1;
    else if (j > 0) j--;
    else j = 0;
    if (k > j - 1) j = k;
    return j;
  }

  /** RedStoneWireBlock.updatePowerStrength. */
  private updateWirePower(i: number, id: number): void {
    const info = this.states.info(id);
    const target = this.rules.incrementalDust ? this.legacyWireTarget(i, info) : this.wireTarget(i);
    if (info.power === target) return;
    if (this.cells[i] === id) this.setBlock(i, this.states.withPower(id, target), F.CLIENTS);
    // Sets.newHashSet(pos + its 6 neighbours): the iteration order depends on world position.
    const h = this.hashOf(i);
    const cells = [i];
    const hashes = [h];
    const dh = [-31, 31, -961, 961, -1, 1];
    for (const d of ALL) {
      cells.push(this.rel(i, d));
      hashes.push((h + (dh[d] as number)) | 0);
    }
    const src = info.nameId;
    for (const p of this.javaHashOrder(cells, hashes)) this.updateNeighborsAt(p, src);
  }

  private updateNeighborsOfNeighboringWires(i: number, src: number): void {
    for (const d of HORIZONTAL) this.checkCornerChangeAt(this.rel(i, d), src);
    for (const d of HORIZONTAL) {
      const n = this.rel(i, d);
      this.checkCornerChangeAt(this.rel(n, this.info(n).conductor ? UP : DOWN), src);
    }
  }

  private checkCornerChangeAt(i: number, src: number): void {
    if (this.info(i).kind !== K.WIRE) return;
    this.updateNeighborsAt(i, src);
    for (const d of ALL) this.updateNeighborsAt(this.rel(i, d), src);
  }

  // ---------------------------------------------------------------- survival

  private canSurvive(i: number, info: StateInfo): boolean {
    switch (info.kind) {
      case K.WIRE:
        return this.canHoldWire(this.info(this.rel(i, DOWN)));
      case K.REPEATER:
      case K.COMPARATOR:
      case K.RAIL:
      case K.POWERED_RAIL:
        return this.info(this.rel(i, DOWN)).sturdyTop;
      case K.TORCH:
        return this.info(this.rel(i, DOWN)).centerTop;
      case K.PLATE:
      case K.WEIGHTED_PLATE:
        return this.info(this.rel(i, DOWN)).centerTop;
      case K.WALL_TORCH:
        return this.info(this.rel(i, OPPOSITE[info.facing] as number)).sturdySide;
      case K.LEVER:
      case K.BUTTON: {
        const c = connectedDir(info);
        const support = this.info(this.rel(i, OPPOSITE[c] as number));
        return c === UP ? support.sturdyTop : support.sturdySide;
      }
      case K.PISTON_HEAD: {
        const base = this.info(this.rel(i, OPPOSITE[info.facing] as number));
        return (
          this.isFittingBase(info, base) ||
          (base.kind === K.MOVING_PISTON && base.facing === info.facing)
        );
      }
      case K.DOOR:
        return info.props.half === 'upper'
          ? this.info(this.rel(i, DOWN)).kind === K.DOOR
          : this.info(this.rel(i, DOWN)).sturdyTop;
      case K.POINTED_DRIPSTONE: {
        // PointedDripstoneBlock.isValidPointedDripstonePlacement
        const tip = dripstoneTip(info);
        const s = this.info(this.rel(i, OPPOSITE[tip] as number));
        return (
          (s.faces & (1 << tip)) !== 0 ||
          (s.kind === K.POINTED_DRIPSTONE && dripstoneTip(s) === tip)
        );
      }
      default:
        return true;
    }
  }

  private isFittingBase(head: StateInfo, base: StateInfo): boolean {
    const sticky = head.props.type === 'sticky';
    return (
      base.kind === K.PISTON &&
      (base.name === 'sticky_piston') === sticky &&
      base.facing === head.facing &&
      base.extended
    );
  }

  // ---------------------------------------------------------------- shape updates

  /** BlockState.updateShape: dir points from this block to the neighbour that changed. */
  private updateShape(i: number, id: number, dir: number, neighbor: number, _from: number): number {
    const info = this.states.info(id);
    const surviveOnShape = this.rules.shapeSurvival;
    // Every SimpleWaterloggedBlock: a waterlogged one wakes its water up.
    if (info.waterloggable && info.fluid.type === FL.WATER)
      this.scheduleFluidTick(i, FL.WATER, this.fluidTickDelay(FL.WATER));
    switch (info.kind) {
      case K.FALLING:
        // FallingBlock.updateShape (ConcretePowderBlock: water next to it sets it first)
        if (!surviveOnShape) return id;
        if (info.falls === FALL.CONCRETE_POWDER && this.touchesWater(i))
          return this.concreteOf(info);
        this.scheduleTick(i, 2, P_NORMAL, info.nameId);
        return id;
      case K.POINTED_DRIPSTONE: {
        if (dir !== UP && dir !== DOWN) return id;
        const tip = dripstoneTip(info);
        if (tip === DOWN && this.hasScheduledTickOf(i, info.nameId)) return id;
        if (dir === OPPOSITE[tip] && !this.canSurvive(i, info))
          this.scheduleTick(i, tip === DOWN ? 2 : 1, P_NORMAL, info.nameId);
        return id;
      }
      case K.LIQUID:
        // LiquidBlock.updateShape
        if (this.isSource(info.fluid) || this.isSource(this.states.info(neighbor).fluid))
          this.scheduleFluidTick(i, info.fluid.type, this.fluidTickDelay(info.fluid.type));
        return id;
      case K.WIRE:
        return this.wireUpdateShape(i, id, dir);
      case K.REPEATER:
        if (dir >= NORTH && axisOf(dir) !== axisOf(info.facing))
          return this.states.withBool(id, 'locked', this.isLocked(i, info));
        return id;
      case K.OBSERVER:
        // ObserverBlock.startSignal, as the observer itself: it may be landing from a piston
        // (the cell still holds the moving block), and its tick must still fire.
        if (info.facing === dir && !info.powered && !this.hasScheduledTickOf(i, info.nameId))
          this.scheduleTick(i, 2, P_NORMAL, info.nameId);
        return id;
      case K.TORCH:
      case K.PLATE:
      case K.WEIGHTED_PLATE:
        return surviveOnShape && dir === DOWN && !this.canSurvive(i, info) ? this.AIR : id;
      case K.WALL_TORCH:
        return surviveOnShape && dir === OPPOSITE[info.facing] && !this.canSurvive(i, info)
          ? this.AIR
          : id;
      case K.LEVER:
      case K.BUTTON:
        return surviveOnShape && OPPOSITE[connectedDir(info)] === dir && !this.canSurvive(i, info)
          ? this.AIR
          : id;
      case K.PISTON_HEAD:
        return dir === OPPOSITE[info.facing] && !this.canSurvive(i, info) ? this.AIR : id;
      case K.DOOR: {
        const lower = info.props.half === 'lower';
        if (dir === UP || dir === DOWN) {
          if (lower === (dir === UP)) {
            const ni = this.states.info(neighbor);
            if (ni.nameId === info.nameId && ni.props.half !== info.props.half) {
              let s = this.states.with(id, 'open', ni.props.open ?? 'false');
              s = this.states.with(s, 'powered', ni.props.powered ?? 'false');
              s = this.states.with(s, 'facing', ni.props.facing ?? 'north');
              return this.states.with(s, 'hinge', ni.props.hinge ?? 'left');
            }
            return this.AIR;
          }
          if (lower && dir === DOWN && !this.canSurvive(i, info)) return this.AIR;
        }
        return id;
      }
      default:
        return id;
    }
  }

  // ---------------------------------------------------------------- onPlace / onRemove

  private onPlace(i: number, info: StateInfo, old: StateInfo, moved: boolean): void {
    const sameBlock = old.nameId === info.nameId;
    switch (info.kind) {
      case K.WIRE:
        if (!sameBlock) {
          this.updateWirePower(i, info.id);
          this.updateNeighborsAt(this.rel(i, UP), info.nameId);
          this.updateNeighborsAt(this.rel(i, DOWN), info.nameId);
          this.updateNeighborsOfNeighboringWires(i, info.nameId);
        }
        return;
      case K.TORCH:
      case K.WALL_TORCH:
        if (this.rules.splitBlocks && (!info.lit || (sameBlock && old.lit))) return;
        for (const d of ALL) this.updateNeighborsAt(this.rel(i, d), info.nameId);
        return;
      case K.REPEATER:
      case K.COMPARATOR:
        if (info.kind === K.COMPARATOR && !this.comparatorOut.has(i)) this.comparatorOut.set(i, 0);
        this.updateDiodeFront(i, info);
        return;
      case K.OBSERVER:
        if (!sameBlock && info.powered && !this.hasScheduledTick(i)) {
          const s = this.states.withBool(info.id, 'powered', false);
          this.setBlock(i, s, F.CLIENTS | F.KNOWN_SHAPE);
          this.updateObserverFront(i, this.states.info(s));
        }
        return;
      case K.PISTON:
        if (!sameBlock && !this.moving.has(i)) this.checkIfExtend(i, info);
        return;
      case K.TNT:
        if (!sameBlock && this.hasNeighborSignal(i)) this.primeTnt(i);
        return;
      case K.HOPPER:
        if (!sameBlock) {
          this.hoppers.set(i, { cooldown: -1, tickedGameTime: 0 });
          this.hopperWake = true;
          this.checkHopper(i, info);
        }
        return;
      case K.COPPER_BULB:
        if (!sameBlock) this.checkBulb(i, info);
        return;
      case K.POWERED_RAIL:
        if (!sameBlock && !moved) this.neighborChanged(i, info.nameId, i);
        return;
      case K.FALLING:
        // FallingBlock.onPlace (1.8–1.12: onBlockAdded, and concrete powder tries water first)
        if (!this.rules.shapeSurvival) {
          if (sameBlock) return;
          if (info.falls === FALL.CONCRETE_POWDER && this.touchesWater(i)) {
            this.setBlock(i, this.concreteOf(info), UPDATE_ALL);
            return;
          }
        }
        this.scheduleTick(i, 2, P_NORMAL, info.nameId);
        return;
      case K.LIQUID:
        if (this.shouldSpreadLiquid(i, info))
          this.scheduleFluidTick(i, info.fluid.type, this.fluidTickDelay(info.fluid.type));
        return;
      default:
        return;
    }
  }

  private onRemove(i: number, old: StateInfo, info: StateInfo, moved: boolean): void {
    const sameBlock = old.nameId === info.nameId;
    if (!sameBlock && old.blockEntity) {
      if (this.inventories.delete(i)) this.hopperWake = true;
      this.hoppers.delete(i);
      this.openers.delete(i);
    }
    switch (old.kind) {
      case K.WIRE:
        if (!moved && !sameBlock) {
          for (const d of ALL) this.updateNeighborsAt(this.rel(i, d), old.nameId);
          this.updateWirePower(i, old.id);
          this.updateNeighborsOfNeighboringWires(i, old.nameId);
        }
        return;
      case K.TORCH:
      case K.WALL_TORCH:
        if (moved) return;
        if (this.rules.splitBlocks && (!old.lit || (sameBlock && info.lit))) return;
        for (const d of ALL) this.updateNeighborsAt(this.rel(i, d), old.nameId);
        return;
      case K.REPEATER:
      case K.COMPARATOR:
        if (!moved && !sameBlock) {
          this.comparatorOut.delete(i);
          this.updateDiodeFront(i, old);
        } else if (this.rules.splitBlocks && old.powered && !info.powered) {
          // 1.8–1.12: powered and unpowered diodes are separate blocks; breaking the powered
          // one updates around all six neighbours.
          for (const d of ALL) this.updateNeighborsAt(this.rel(i, d), old.nameId);
        }
        return;
      case K.OBSERVER:
        if (!sameBlock && old.powered && this.hasScheduledTickOf(i, old.nameId))
          this.updateObserverFront(
            i,
            this.states.info(this.states.withBool(old.id, 'powered', false)),
          );
        return;
      case K.LEVER:
      case K.BUTTON:
        if (!moved && !sameBlock && old.powered) this.updateAttachedNeighbours(i, old);
        return;
      case K.PLATE:
      case K.WEIGHTED_PLATE:
        if (!moved && !sameBlock && this.plateSignal(old) > 0) {
          this.updateNeighborsAt(i, old.nameId);
          this.updateNeighborsAt(this.rel(i, DOWN), old.nameId);
        }
        if (!sameBlock) this.plateEntities.delete(i);
        return;
      case K.PISTON_HEAD:
        if (!sameBlock) {
          const b = this.rel(i, OPPOSITE[old.facing] as number);
          if (this.isFittingBase(old, this.info(b))) this.destroyBlock(b);
        }
        return;
      case K.MOVING_PISTON:
        if (!sameBlock) {
          const m = this.moving.get(i);
          if (m) this.finalTick(m);
        }
        return;
      case K.POWERED_RAIL:
        if (!moved && !sameBlock) {
          if (/^ascending/.test(old.props.shape ?? ''))
            this.updateNeighborsAt(this.rel(i, UP), old.nameId);
          this.updateNeighborsAt(i, old.nameId);
          this.updateNeighborsAt(this.rel(i, DOWN), old.nameId);
        }
        return;
      default:
        return;
    }
  }

  private hasScheduledTickOf(i: number, nameId: number): boolean {
    return this.blockTicks.scheduled.has(this.tickKey(i, nameId));
  }

  // ---------------------------------------------------------------- neighbour changed

  private runNeighborChanged(i: number, src: number, from: number): void {
    this.guard();
    const info = this.info(i);
    switch (info.kind) {
      case K.AIR:
      case K.SOLID:
        return;
      case K.FALLING:
        // 1.8–1.12 BlockFalling.neighborChanged (1.13+ reacts to shape updates instead)
        if (this.rules.shapeSurvival) return;
        if (info.falls === FALL.CONCRETE_POWDER && this.touchesWater(i)) {
          this.setBlock(i, this.concreteOf(info), UPDATE_ALL);
          return;
        }
        this.scheduleTick(i, 2);
        return;
      case K.LIQUID:
        if (this.shouldSpreadLiquid(i, info))
          this.scheduleFluidTick(i, info.fluid.type, this.fluidTickDelay(info.fluid.type));
        return;
      case K.WIRE:
        if (this.canSurvive(i, info)) this.updateWirePower(i, info.id);
        else this.destroyBlock(i);
        return;
      case K.TORCH:
      case K.WALL_TORCH:
        if (!this.rules.shapeSurvival && !this.canSurvive(i, info)) {
          this.destroyBlock(i);
          return;
        }
        if (
          info.lit === this.torchHasSignal(i, info) &&
          !(this.rules.tickThisTickCheck && this.willTickThisTick(i))
        )
          this.scheduleTick(i, 2);
        return;
      case K.REPEATER:
      case K.COMPARATOR:
        if (!this.canSurvive(i, info)) {
          this.destroyBlock(i);
          for (const d of ALL) this.updateNeighborsAt(this.rel(i, d), info.nameId);
          return;
        }
        if (info.kind === K.REPEATER) this.repeaterCheck(i, info);
        else this.comparatorCheck(i, info);
        return;
      case K.LEVER:
      case K.BUTTON:
      case K.PLATE:
      case K.WEIGHTED_PLATE:
        if (!this.rules.shapeSurvival && !this.canSurvive(i, info)) this.destroyBlock(i);
        return;
      case K.LAMP: {
        const powered = this.hasNeighborSignal(i);
        if (info.lit !== powered) {
          if (info.lit) this.scheduleTick(i, 4);
          else this.setBlock(i, this.states.withBool(info.id, 'lit', true), F.CLIENTS);
        }
        return;
      }
      case K.PISTON:
        this.checkIfExtend(i, info);
        return;
      case K.PISTON_HEAD:
        if (this.canSurvive(i, info))
          this.neighborChanged(this.rel(i, OPPOSITE[info.facing] as number), src, from);
        return;
      case K.NOTE_BLOCK: {
        const powered = this.hasNeighborSignal(i);
        if (powered !== info.powered) {
          if (powered && this.info(this.rel(i, UP)).kind === K.AIR) this.blockEvent(i, 0, 0);
          const s = this.states.withBool(info.id, 'powered', powered);
          this.setBlock(i, s, this.rules.noteBlockState ? UPDATE_ALL : F.CLIENTS | F.KNOWN_SHAPE);
        }
        return;
      }
      case K.DOOR: {
        const other = this.rel(i, info.props.half === 'lower' ? UP : DOWN);
        const powered = this.hasNeighborSignal(i) || this.hasNeighborSignal(other);
        if (src !== info.nameId && powered !== info.powered) {
          let s = this.states.withBool(info.id, 'powered', powered);
          s = this.states.withBool(s, 'open', powered);
          this.setBlock(i, s, F.CLIENTS);
        }
        return;
      }
      case K.TRAPDOOR: {
        const powered = this.hasNeighborSignal(i);
        if (powered !== info.powered) {
          let s = this.states.withBool(info.id, 'powered', powered);
          if (info.open !== powered) s = this.states.withBool(s, 'open', powered);
          this.setBlock(i, s, F.CLIENTS);
        }
        return;
      }
      case K.FENCE_GATE: {
        const powered = this.hasNeighborSignal(i);
        if (powered !== info.powered) {
          let s = this.states.withBool(info.id, 'powered', powered);
          s = this.states.withBool(s, 'open', powered);
          this.setBlock(i, s, F.CLIENTS);
        }
        return;
      }
      case K.DISPENSER:
      case K.CRAFTER: {
        const powered =
          this.hasNeighborSignal(i) ||
          (info.kind === K.DISPENSER && this.hasNeighborSignal(this.rel(i, UP)));
        if (powered && !info.triggered) {
          this.scheduleTick(i, 4);
          this.setBlock(i, this.states.withBool(info.id, 'triggered', true), F.INVISIBLE);
        } else if (!powered && info.triggered) {
          let s = this.states.withBool(info.id, 'triggered', false);
          if (info.kind === K.CRAFTER) s = this.states.withBool(s, 'crafting', false);
          this.setBlock(i, s, F.INVISIBLE);
        }
        return;
      }
      case K.HOPPER:
        this.checkHopper(i, info);
        return;
      case K.COPPER_BULB:
        this.checkBulb(i, info);
        return;
      case K.TNT:
        if (this.hasNeighborSignal(i)) this.primeTnt(i);
        return;
      case K.POWERED_RAIL:
        if (!this.canSurvive(i, info)) {
          this.destroyBlock(i);
          return;
        }
        this.updatePoweredRail(i, info);
        return;
      case K.RAIL:
        if (!this.canSurvive(i, info)) this.destroyBlock(i);
        return;
      case K.BELL: {
        const powered = this.hasNeighborSignal(i);
        if (powered !== info.powered) {
          if (powered) this.event('bell', i);
          this.setBlock(i, this.states.withBool(info.id, 'powered', powered), UPDATE_ALL);
        }
        return;
      }
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- scheduled tick handlers

  private tickBlock(i: number): void {
    const info = this.info(i);
    switch (info.kind) {
      case K.TORCH:
      case K.WALL_TORCH:
        this.tickTorch(i, info);
        return;
      case K.REPEATER:
        this.tickRepeater(i, info);
        return;
      case K.COMPARATOR:
        this.refreshComparator(i, info);
        return;
      case K.LAMP:
        if (info.lit && !this.hasNeighborSignal(i))
          this.setBlock(i, this.states.withBool(info.id, 'lit', false), F.CLIENTS);
        return;
      case K.OBSERVER:
        if (info.powered)
          this.setBlock(i, this.states.withBool(info.id, 'powered', false), F.CLIENTS);
        else {
          this.setBlock(i, this.states.withBool(info.id, 'powered', true), F.CLIENTS);
          this.scheduleTick(i, 2);
        }
        this.updateObserverFront(i, info);
        return;
      case K.BUTTON:
        if (info.powered) {
          this.setBlock(i, this.states.withBool(info.id, 'powered', false), UPDATE_ALL);
          this.updateAttachedNeighbours(i, info);
        }
        return;
      case K.PLATE:
      case K.WEIGHTED_PLATE: {
        const s = this.plateSignal(info);
        if (s > 0) this.checkPlate(i, info, s);
        return;
      }
      case K.TARGET:
        if (info.power > 0) this.setBlock(i, this.states.withPower(info.id, 0), UPDATE_ALL);
        return;
      case K.DISPENSER:
        this.dispenseFrom(i, info);
        return;
      case K.CRAFTER:
        this.event('craft', i);
        return;
      case K.FALLING:
        // FallingBlock.tick (BrushableBlock: suspicious sand and gravel shatter when they land)
        if (this.isFree(this.info(this.rel(i, DOWN))) && this.valid(this.rel(i, DOWN)))
          this.spawnFalling(i, info, info.falls === FALL.BRUSHABLE);
        return;
      case K.POINTED_DRIPSTONE:
        if (dripstoneTip(info) === UP) {
          if (!this.canSurvive(i, info)) this.destroyBlock(i);
        } else this.spawnFallingStalactite(i);
        return;
      case K.LIGHTNING_ROD:
        if (info.powered) {
          this.setBlock(i, this.states.withBool(info.id, 'powered', false), UPDATE_ALL);
          this.updateNeighborsAt(this.rel(i, OPPOSITE[info.facing] as number), info.nameId);
        }
        return;
      case K.LECTERN:
        if (info.powered) this.lecternPowered(i, info, false);
        return;
      case K.SCULK_SENSOR: {
        // SculkSensorBlock.tick: active → cooldown (10 gt) → inactive
        const phase = info.props.sculk_sensor_phase;
        if (phase === 'active') {
          let s = this.states.with(info.id, 'sculk_sensor_phase', 'cooldown');
          s = this.states.withPower(s, 0);
          this.setBlock(i, s, UPDATE_ALL);
          this.scheduleTick(i, 10);
          this.updateNeighborsAt(i, info.nameId);
          this.updateNeighborsAt(this.rel(i, DOWN), info.nameId);
        } else if (phase === 'cooldown') {
          this.setBlock(i, this.states.with(info.id, 'sculk_sensor_phase', 'inactive'), UPDATE_ALL);
        }
        return;
      }
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- torches

  private torchHasSignal(i: number, info: StateInfo): boolean {
    if (info.kind === K.TORCH) return this.levelSignal(this.rel(i, DOWN), DOWN) > 0;
    const d = OPPOSITE[info.facing] as number;
    return this.levelSignal(this.rel(i, d), d) > 0;
  }

  /** RedstoneTorchBlock.isToggledTooFrequently: 8 toggles within 60 ticks burns it out. */
  private toggledTooOften(i: number, add: boolean): boolean {
    if (add) this.toggles.push({ pos: i, when: this.time });
    let n = 0;
    for (const t of this.toggles) if (t.pos === i && ++n >= 8) return true;
    return false;
  }

  private tickTorch(i: number, info: StateInfo): void {
    const powered = this.torchHasSignal(i, info);
    while (this.toggles.length > 0 && this.time - (this.toggles[0] as { when: number }).when > 60)
      this.toggles.shift();
    if (info.lit) {
      if (powered) {
        this.setBlock(i, this.states.withBool(info.id, 'lit', false), UPDATE_ALL);
        if (this.toggledTooOften(i, true)) {
          this.event('burnout', i);
          this.scheduleTick(i, 160);
        }
      }
    } else if (!powered && !this.toggledTooOften(i, false)) {
      this.setBlock(i, this.states.withBool(info.id, 'lit', true), UPDATE_ALL);
    }
  }

  // ---------------------------------------------------------------- repeaters and comparators

  private isDiode(info: StateInfo): boolean {
    return info.kind === K.REPEATER || info.kind === K.COMPARATOR;
  }

  /** DiodeBlock.getInputSignal (+ ComparatorBlock's container reading). */
  private diodeInput(i: number, info: StateInfo): number {
    const d = info.facing;
    const b = this.rel(i, d);
    let s = this.levelSignal(b, d);
    const bi = this.info(b);
    if (s < 15 && bi.kind === K.WIRE) s = Math.max(s, bi.power);
    if (info.kind !== K.COMPARATOR) return s;
    const analog = this.analogSignal(b, bi);
    if (analog !== null) return analog;
    if (s < 15 && bi.conductor) {
      const b2 = this.rel(b, d);
      const a2 = this.analogSignal(b2, this.info(b2));
      if (a2 !== null) return a2;
    }
    return s;
  }

  /** Strongest side input: diodes only for repeaters (locking), any source for comparators. */
  private sideInput(i: number, info: StateInfo): number {
    const diodesOnly = info.kind === K.REPEATER;
    let best = 0;
    for (const d of [clockwise(info.facing), counterClockwise(info.facing)]) {
      const n = this.rel(i, d);
      const ni = this.info(n);
      let s = 0;
      if (diodesOnly) s = this.isDiode(ni) ? this.directSignal(n, ni, d) : 0;
      else if (ni.kind === K.REDSTONE_BLOCK) s = 15;
      else if (ni.kind === K.WIRE) s = ni.power;
      else if (this.isSignalSource(ni)) s = this.directSignal(n, ni, d);
      best = Math.max(best, s);
    }
    return best;
  }

  private isLocked(i: number, info: StateInfo): boolean {
    return info.kind === K.REPEATER && this.sideInput(i, info) > 0;
  }

  /** The diode in front isn't pointing back at this one. */
  private shouldPrioritize(i: number, info: StateInfo): boolean {
    const d = OPPOSITE[info.facing] as number;
    const front = this.info(this.rel(i, d));
    return this.isDiode(front) && front.facing !== d;
  }

  private repeaterCheck(i: number, info: StateInfo): void {
    if (this.isLocked(i, info)) return;
    const on = this.diodeInput(i, info) > 0;
    if (info.powered === on) return;
    if (this.rules.tickThisTickCheck && this.willTickThisTick(i)) return;
    const p = this.shouldPrioritize(i, info)
      ? P_EXTREMELY_HIGH
      : info.powered
        ? P_VERY_HIGH
        : P_HIGH;
    this.scheduleTick(i, info.delay * 2, p);
  }

  private tickRepeater(i: number, info: StateInfo): void {
    if (this.isLocked(i, info)) return;
    const on = this.diodeInput(i, info) > 0;
    if (info.powered && !on)
      this.setBlock(i, this.states.withBool(info.id, 'powered', false), F.CLIENTS);
    else if (!info.powered) {
      this.setBlock(i, this.states.withBool(info.id, 'powered', true), F.CLIENTS);
      if (!on) this.scheduleTick(i, info.delay * 2, P_VERY_HIGH);
    }
  }

  private comparatorOutput(i: number, info: StateInfo): number {
    const input = this.diodeInput(i, info);
    if (input === 0) return 0;
    const side = this.sideInput(i, info);
    if (side > input) return 0;
    return info.subtract ? input - side : input;
  }

  private comparatorOn(i: number, info: StateInfo): boolean {
    const input = this.diodeInput(i, info);
    if (input === 0) return false;
    const side = this.sideInput(i, info);
    return input > side || (input === side && !info.subtract);
  }

  private comparatorCheck(i: number, info: StateInfo): void {
    if (this.rules.tickThisTickCheck && this.willTickThisTick(i)) return;
    const out = this.comparatorOutput(i, info);
    const cur = this.comparatorOut.get(i) ?? 0;
    if (out !== cur || info.powered !== this.comparatorOn(i, info)) {
      this.scheduleTick(i, 2, this.shouldPrioritize(i, info) ? P_HIGH : P_NORMAL);
    }
  }

  private refreshComparator(i: number, info: StateInfo): void {
    const out = this.comparatorOutput(i, info);
    const cur = this.comparatorOut.get(i) ?? 0;
    this.comparatorOut.set(i, out);
    if (cur === out && info.subtract) return;
    const on = this.comparatorOn(i, info);
    if (info.powered && !on)
      this.setBlock(i, this.states.withBool(info.id, 'powered', false), F.CLIENTS);
    else if (!info.powered && on)
      this.setBlock(i, this.states.withBool(info.id, 'powered', true), F.CLIENTS);
    this.updateDiodeFront(i, info);
  }

  /** DiodeBlock.updateNeighborsInFront. */
  private updateDiodeFront(i: number, info: StateInfo): void {
    const d = info.facing;
    const front = this.rel(i, OPPOSITE[d] as number);
    this.neighborChanged(front, info.nameId, i);
    this.updateNeighborsAt(front, info.nameId, d);
  }

  /** Signal a comparator reads from a container or a block with a fill level, or null. */
  analogSignal(i: number, info: StateInfo): number | null {
    const fromState = stateSignal(info.name, info.props);
    if (fromState !== null) return fromState;
    const slots = containerSlots(info.name);
    if (slots === 0) return null;
    const items = [...(this.inventories.get(i) ?? [])];
    let total = slots;
    if ((info.name === 'chest' || info.name === 'trapped_chest') && info.props.type !== 'single') {
      const d = info.props.type === 'left' ? clockwise(info.facing) : counterClockwise(info.facing);
      const other = this.rel(i, d);
      const oi = this.info(other);
      if (oi.nameId === info.nameId && oi.props.type !== 'single') {
        items.push(...(this.inventories.get(other) ?? []));
        total += slots;
      }
    }
    return containerSignal(items, total);
  }

  // ---------------------------------------------------------------- observers

  private updateObserverFront(i: number, info: StateInfo): void {
    const d = info.facing;
    const back = this.rel(i, OPPOSITE[d] as number);
    this.neighborChanged(back, info.nameId, i);
    this.updateNeighborsAt(back, info.nameId, d);
  }

  // ---------------------------------------------------------------- levers, buttons, plates

  private updateAttachedNeighbours(i: number, info: StateInfo): void {
    this.updateNeighborsAt(i, info.nameId);
    this.updateNeighborsAt(this.rel(i, OPPOSITE[connectedDir(info)] as number), info.nameId);
  }

  private plateSignal(info: StateInfo): number {
    return info.kind === K.WEIGHTED_PLATE ? Math.max(0, info.power) : info.powered ? 15 : 0;
  }

  private plateTarget(i: number, info: StateInfo): number {
    const n = this.plateEntities.get(i) ?? 0;
    if (n <= 0) return 0;
    if (info.kind === K.PLATE) return 15;
    const max = plateMaxWeight(info.name);
    return Math.ceil((Math.min(max, n) / max) * 15);
  }

  /** BasePressurePlateBlock.checkPressed. */
  private checkPlate(i: number, info: StateInfo, current: number): void {
    const target = this.plateTarget(i, info);
    if (current !== target) {
      const s =
        info.kind === K.WEIGHTED_PLATE
          ? this.states.withPower(info.id, target)
          : this.states.withBool(info.id, 'powered', target > 0);
      this.setBlock(i, s, F.CLIENTS);
      this.updateNeighborsAt(i, info.nameId);
      this.updateNeighborsAt(this.rel(i, DOWN), info.nameId);
    }
    if (target > 0) this.scheduleTick(i, info.kind === K.WEIGHTED_PLATE ? 10 : 20);
  }

  // ---------------------------------------------------------------- other consumers

  private checkHopper(i: number, info: StateInfo): void {
    const enabled = !this.hasNeighborSignal(i);
    if (enabled !== info.enabled) {
      this.setBlock(i, this.states.withBool(info.id, 'enabled', enabled), F.INVISIBLE);
      this.hopperWake = true;
    }
  }

  private checkBulb(i: number, info: StateInfo): void {
    const powered = this.hasNeighborSignal(i);
    if (powered === info.powered) return;
    let s = info.id;
    if (!info.powered) s = this.states.withBool(s, 'lit', !info.lit);
    this.setBlock(i, this.states.withBool(s, 'powered', powered), UPDATE_ALL);
  }

  private primeTnt(i: number): void {
    this.event('tnt', i, 'primed: explodes 80 ticks later (explosions are not simulated)');
    this.setBlock(i, this.AIR, UPDATE_ALL);
  }

  /** PoweredRailBlock: power travels up to 8 rails from a powered one. */
  private updatePoweredRail(i: number, info: StateInfo): void {
    const powered =
      this.hasNeighborSignal(i) ||
      this.findRailSignal(i, info, true, 0) ||
      this.findRailSignal(i, info, false, 0);
    if (powered === info.powered) return;
    this.setBlock(i, this.states.withBool(info.id, 'powered', powered), UPDATE_ALL);
    this.updateNeighborsAt(this.rel(i, DOWN), info.nameId);
    if (/^ascending/.test(info.props.shape ?? ''))
      this.updateNeighborsAt(this.rel(i, UP), info.nameId);
  }

  private findRailSignal(i: number, info: StateInfo, forward: boolean, depth: number): boolean {
    if (depth >= 8) return false;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let flat = true;
    let shape = info.props.shape ?? 'north_south';
    switch (shape) {
      case 'north_south':
        dz = forward ? 1 : -1;
        break;
      case 'east_west':
        dx = forward ? -1 : 1;
        break;
      case 'ascending_east':
        if (forward) dx = -1;
        else {
          dx = 1;
          dy = 1;
          flat = false;
        }
        shape = 'east_west';
        break;
      case 'ascending_west':
        if (forward) {
          dx = -1;
          dy = 1;
          flat = false;
        } else dx = 1;
        shape = 'east_west';
        break;
      case 'ascending_north':
        if (forward) dz = 1;
        else {
          dz = -1;
          dy = 1;
          flat = false;
        }
        shape = 'north_south';
        break;
      case 'ascending_south':
        if (forward) {
          dz = 1;
          dy = 1;
          flat = false;
        } else dz = -1;
        shape = 'north_south';
        break;
    }
    const n = i + dx + this.W * dz + this.W * this.D * dy;
    if (this.sameRailWithPower(n, info, forward, depth, shape)) return true;
    return flat && this.sameRailWithPower(this.rel(n, DOWN), info, forward, depth, shape);
  }

  private sameRailWithPower(
    i: number,
    rail: StateInfo,
    forward: boolean,
    depth: number,
    shape: string,
  ): boolean {
    const info = this.info(i);
    if (info.nameId !== rail.nameId) return false;
    const s = info.props.shape ?? '';
    if (shape === 'east_west' && /north|south/.test(s)) return false;
    if (shape === 'north_south' && /east|west/.test(s)) return false;
    if (!info.powered) return false;
    if (this.hasNeighborSignal(i)) return true;
    return this.findRailSignal(i, info, forward, depth + 1);
  }

  // ---------------------------------------------------------------- pistons

  /** PistonBaseBlock.isPushable; the simulated area's edge stands in for the world limits. */
  isPushable(i: number, move: number, allowDestroy: boolean, pistonFacing: number): boolean {
    if (!this.valid(i) || !this.valid(this.rel(i, move))) return false;
    const info = this.info(i);
    if (info.kind === K.AIR) return true;
    if (info.kind === K.PISTON) {
      if (info.extended) return false;
    } else {
      if (info.push === PUSH.BLOCK) return false;
      if (info.push === PUSH.DESTROY) return allowDestroy;
      if (info.push === PUSH.PUSH_ONLY) return move === pistonFacing;
    }
    if (this.rules.noteBlockImmovable && info.kind === K.NOTE_BLOCK) return false;
    return !info.blockEntity;
  }

  private pistonPowered(i: number, facing: number): boolean {
    for (const d of ALL) if (d !== facing && this.levelSignal(this.rel(i, d), d) > 0) return true;
    if (this.levelSignal(i, DOWN) > 0) return true;
    const above = this.rel(i, UP);
    for (const d of ALL) if (d !== DOWN && this.levelSignal(this.rel(above, d), d) > 0) return true;
    return false;
  }

  private checkIfExtend(i: number, info: StateInfo): void {
    const d = info.facing;
    const powered = this.pistonPowered(i, d);
    if (powered && !info.extended) {
      if (new PistonStructure(this, i, d, true).resolve()) this.blockEvent(i, 0, d);
    } else if (!powered && info.extended) {
      const p2 = this.rel(i, d, 2);
      const s2 = this.info(p2);
      let type = 1;
      if (s2.kind === K.MOVING_PISTON && s2.facing === d) {
        const m = this.moving.get(p2);
        if (
          m &&
          m.extending &&
          (m.progressO < 0.5 || this.time === m.lastTicked || this.handlingTick)
        )
          type = 2;
      }
      this.blockEvent(i, type, d);
    }
  }

  private triggerEvent(i: number, type: number, param: number): void {
    const info = this.info(i);
    if (info.kind === K.NOTE_BLOCK) {
      this.event('note', i, `${info.props.instrument ?? 'harp'} ${info.props.note ?? '0'}`);
      return;
    }
    if (info.kind !== K.PISTON) return;
    const d = info.facing;
    const sticky = info.name === 'sticky_piston';
    const extended = this.states.withBool(info.id, 'extended', true);
    const powered = this.pistonPowered(i, d);
    if (powered && (type === 1 || type === 2)) {
      this.setBlock(i, extended, F.CLIENTS);
      return;
    }
    if (!powered && type === 0) return;
    if (type === 0) {
      if (!this.moveBlocks(i, d, true, sticky)) return;
      this.setBlock(i, extended, F.MOVED | UPDATE_ALL);
      return;
    }
    const front = this.rel(i, d);
    const inFront = this.moving.get(front);
    if (inFront) this.finalTick(inFront);
    const movingId = this.newState('moving_piston', {
      facing: DIR_NAMES[d] as string,
      type: sticky ? 'sticky' : 'normal',
    });
    this.setBlock(i, movingId, F.INVISIBLE | F.KNOWN_SHAPE);
    const base = this.newState(
      info.name,
      {
        facing: DIR_NAMES[param & 7] as string,
        extended: 'false',
      },
      info.id,
    );
    this.addMoving(i, base, d, false, true);
    this.updateNeighborsAt(i, this.states.info(movingId).nameId);
    this.updateNeighbourShapes(this.states.info(movingId), i, F.CLIENTS, 512);
    if (sticky) {
      const p2 = this.rel(i, d, 2);
      const s3 = this.info(p2);
      let spat = false;
      if (s3.kind === K.MOVING_PISTON) {
        const m = this.moving.get(p2);
        if (m && m.dir === d && m.extending) {
          this.finalTick(m);
          spat = true;
        }
      }
      if (!spat) {
        if (
          type !== 1 ||
          s3.kind === K.AIR ||
          !this.isPushable(p2, OPPOSITE[d] as number, false, d) ||
          (s3.push !== PUSH.NORMAL && s3.kind !== K.PISTON)
        )
          this.removeBlock(front);
        else this.moveBlocks(i, d, false, sticky);
      }
    } else {
      this.removeBlock(front);
    }
  }

  /** A state the engine creates, with this version's properties for that block. */
  private newState(name: string, props: Record<string, string>, like?: number): number {
    const base =
      like !== undefined ? { ...this.states.info(like).props } : { ...(this.defaults[name] ?? {}) };
    for (const [k, v] of Object.entries(props)) if (k in base) base[k] = v;
    return this.states.idOfName(name, base);
  }

  private moveBlocks(i: number, dir: number, extending: boolean, sticky: boolean): boolean {
    const front = this.rel(i, dir);
    if (!extending && this.info(front).kind === K.PISTON_HEAD)
      this.setBlock(front, this.AIR, F.INVISIBLE | F.KNOWN_SHAPE);
    const res = new PistonStructure(this, i, dir, extending);
    if (!res.resolve()) return false;
    const toPush = res.toPush;
    const toDestroy = res.toDestroy;
    const map = new Map<number, number>();
    const moved: number[] = [];
    for (const p of toPush) {
      moved.push(this.cells[p] as number);
      map.set(p, this.cells[p] as number);
    }
    const order = [...map.keys()];
    const blockStates: number[] = [];
    const dir2 = extending ? dir : (OPPOSITE[dir] as number);
    for (let k = toDestroy.length - 1; k >= 0; k--) {
      const p = toDestroy[k] as number;
      const s = this.cells[p] as number;
      this.event('break', p, this.states.info(s).name);
      this.setBlock(p, this.AIR, F.CLIENTS | F.KNOWN_SHAPE);
      blockStates.push(s);
    }
    const movingNormal = this.newState('moving_piston', { facing: DIR_NAMES[dir] as string });
    for (let k = toPush.length - 1; k >= 0; k--) {
      const from = toPush[k] as number;
      const s = this.cells[from] as number;
      const p = this.rel(from, dir2);
      map.delete(p);
      this.setBlock(p, movingNormal, F.MOVED | F.INVISIBLE);
      this.addMoving(p, moved[k] as number, dir, extending, false);
      blockStates.push(s);
    }
    if (extending) {
      const type = sticky ? 'sticky' : 'normal';
      const head = this.newState('piston_head', {
        facing: DIR_NAMES[dir] as string,
        type,
        short: 'false',
      });
      const movingHead = this.newState('moving_piston', { facing: DIR_NAMES[dir] as string, type });
      map.delete(front);
      this.setBlock(front, movingHead, F.MOVED | F.INVISIBLE);
      this.addMoving(front, head, dir, true, true);
    }
    // The cells left empty, in Java HashMap order (it depends on world position).
    const left = order.filter((p) => map.has(p));
    const leftOrder = this.javaHashOrder(
      left,
      left.map((p) => this.hashOf(p)),
    );
    for (const p of leftOrder) this.setBlock(p, this.AIR, F.MOVED | F.KNOWN_SHAPE | F.CLIENTS);
    const airInfo = this.states.info(this.AIR);
    for (const p of leftOrder) {
      this.updateIndirectNeighbourShapes(this.states.info(map.get(p) as number), p, F.CLIENTS, 512);
      this.updateNeighbourShapes(airInfo, p, F.CLIENTS, 512);
    }
    let j = 0;
    for (let k = toDestroy.length - 1; k >= 0; k--) {
      const s = this.states.info(blockStates[j++] as number);
      const p = toDestroy[k] as number;
      this.updateIndirectNeighbourShapes(s, p, F.CLIENTS, 512);
      this.updateNeighborsAt(p, s.nameId);
    }
    for (let k = toPush.length - 1; k >= 0; k--)
      this.updateNeighborsAt(
        toPush[k] as number,
        this.states.info(blockStates[j++] as number).nameId,
      );
    if (extending) this.updateNeighborsAt(front, this.states.nameIdOf('piston_head'));
    return true;
  }

  private addMoving(
    i: number,
    state: number,
    dir: number,
    extending: boolean,
    source: boolean,
  ): void {
    const old = this.moving.get(i);
    if (old) old.removed = true;
    const m: MovingBlock = {
      pos: i,
      state,
      dir,
      extending,
      source,
      progress: 0,
      progressO: 0,
      lastTicked: 0,
      removed: false,
    };
    this.moving.set(i, m);
    this.pendingTickers.push(m);
    this.markChanged(i);
  }

  private removeMoving(m: MovingBlock): void {
    m.removed = true;
    if (this.moving.get(m.pos) === m) this.moving.delete(m.pos);
  }

  /** PistonMovingBlockEntity.tick. */
  private tickMoving(m: MovingBlock): void {
    m.lastTicked = this.time;
    m.progressO = m.progress;
    if (m.progressO >= 1) {
      this.removeMoving(m);
      if (this.info(m.pos).kind === K.MOVING_PISTON) {
        const s = this.updateFromNeighbourShapes(m.state, m.pos);
        if (this.states.kind(s) === K.AIR) {
          this.setBlock(m.pos, m.state, F.MOVED | F.KNOWN_SHAPE | F.INVISIBLE);
          this.updateOrDestroy(m.state, s, m.pos, UPDATE_ALL, 512);
        } else {
          this.setBlock(m.pos, s, F.MOVED | UPDATE_ALL);
          this.neighborChanged(m.pos, this.states.info(s).nameId, m.pos);
        }
      }
      this.markChanged(m.pos);
    } else {
      m.progress = Math.min(1, m.progress + 0.5);
    }
  }

  /** PistonMovingBlockEntity.finalTick: land the block now. */
  private finalTick(m: MovingBlock): void {
    if (m.progressO >= 1) return;
    m.progress = 1;
    m.progressO = 1;
    this.removeMoving(m);
    if (this.info(m.pos).kind === K.MOVING_PISTON) {
      const s = m.source ? this.AIR : this.updateFromNeighbourShapes(m.state, m.pos);
      this.setBlock(m.pos, s, UPDATE_ALL);
      this.neighborChanged(m.pos, this.states.info(s).nameId, m.pos);
    }
    this.markChanged(m.pos);
  }

  // ---------------------------------------------------------------- falling blocks

  /** FallingBlock.isFree: what a falling block drops through. */
  private isFree(info: StateInfo): boolean {
    if (info.kind === K.AIR || info.kind === K.LIQUID) return true;
    if (info.name === 'fire' || info.name === 'soul_fire') return true;
    return this.rules.fallThroughReplaceable && info.replaceable;
  }

  /** FallingBlockEntity.fall: the block becomes an entity, leaving its water (or air) behind. */
  private spawnFalling(i: number, info: StateInfo, cancelDrop: boolean): void {
    const [x, y, z] = this.coords(i);
    const state = info.waterloggable
      ? this.states.withBool(info.id, 'waterlogged', false)
      : info.id;
    this.falling.push({ id: this.nextEntityId++, x, z, y, vy: 0, state, time: 0, cancelDrop });
    if (this.rules.fallRemovesAtOnce) this.setBlock(i, this.liquidBlock(info.fluid), UPDATE_ALL);
  }

  /** PointedDripstoneBlock.spawnFallingStalactite: the stalactite falls down to its tip. */
  private spawnFallingStalactite(i: number): void {
    let p = i;
    let s = this.info(p);
    while (s.kind === K.POINTED_DRIPSTONE && dripstoneTip(s) === DOWN) {
      this.spawnFalling(p, s, false);
      if (s.props.thickness === 'tip' || s.props.thickness === 'tip_merge') break;
      p = this.rel(p, DOWN);
      s = this.info(p);
    }
  }

  /** Collision top of a cell, a moving block counting as the block it carries. */
  private collisionTop(i: number): number {
    const info = this.info(i);
    if (info.kind !== K.MOVING_PISTON) return info.collision;
    const m = this.moving.get(i);
    return m ? this.states.info(m.state).collision : 0;
  }

  /** Entity.move, straight down its column: the highest collision top it reaches stops it. */
  private moveFalling(e: FallingBlock): boolean {
    const from = e.y;
    let to = from + e.vy;
    let hit = false;
    if (e.vy < 0) {
      for (let cy = Math.floor(from); cy >= Math.floor(to) - 1; cy--) {
        const c = this.index(e.x, cy, e.z);
        if (!this.valid(c)) continue;
        const h = this.collisionTop(c);
        if (h <= 0) continue;
        const top = cy + h;
        if (top <= from + 1e-7 && top > to) {
          to = top;
          hit = true;
        }
      }
    }
    e.y = to;
    return hit;
  }

  private canBeReplacedByFalling(info: StateInfo): boolean {
    if (!info.replaceable) return false;
    // SnowLayerBlock.canBeReplaced: only a single layer, when not placing snow
    return info.name !== 'snow' || Number(info.props.layers ?? 1) <= 1;
  }

  /** FallingBlockEntity.tick; false once it is gone (landed, broke, or left the area). */
  private tickFalling(e: FallingBlock): boolean {
    const st = this.states.info(e.state);
    if (st.kind === K.AIR) return false;
    if (!this.rules.fallRemovesAtOnce && e.time === 0) {
      // ≤1.16: the entity removes its block on its first tick
      e.time++;
      const start = this.index(e.x, Math.round(e.y), e.z);
      if (this.info(start).nameId !== st.nameId) return false;
      this.setBlock(start, this.liquidBlock(this.info(start).fluid), UPDATE_ALL);
    } else e.time++;
    const fromY = e.y;
    e.vy -= 0.04;
    const onGround = this.moveFalling(e);
    if (e.y < -1) {
      this.event('left-area', this.index(e.x, Math.max(-1, Math.floor(fromY)), e.z), st.name);
      return false;
    }
    let cell = this.index(e.x, Math.floor(e.y), e.z);
    const powder = st.falls === FALL.CONCRETE_POWDER;
    let inWater = powder && isWaterType(this.info(cell).fluid.type);
    if (powder && !inWater && e.vy * e.vy > 1) {
      // ClipContext with Fluid.SOURCE_ONLY between the old and new position
      for (let cy = Math.floor(fromY); cy > Math.floor(e.y); cy--) {
        const c = this.index(e.x, cy, e.z);
        if (this.info(c).fluid.type === FL.WATER) {
          cell = c;
          inWater = true;
          break;
        }
      }
    }
    if (!onGround && !inWater) {
      if (e.time > 600) {
        this.event('break', cell, `${st.name} (fell for too long)`);
        return false;
      }
      e.vy *= 0.98;
      return true;
    }
    const here = this.info(cell);
    e.vy *= -0.5;
    if (here.kind === K.MOVING_PISTON) {
      e.vy *= 0.98;
      return true;
    }
    if (e.cancelDrop) {
      this.event('break', cell, `${st.name} (shattered)`);
      return false;
    }
    const free = this.isFree(this.info(this.rel(cell, DOWN))) && !(powder && inWater);
    if (this.canBeReplacedByFalling(here) && this.canSurvive(cell, st) && !free) {
      let state = e.state;
      if (st.waterloggable && here.fluid.type === FL.WATER)
        state = this.states.withBool(state, 'waterlogged', true);
      if (this.setBlock(cell, state, UPDATE_ALL)) {
        this.event('land', cell, st.name);
        // Fallable.onLand: ConcretePowderBlock hardens in or next to water
        if (powder && this.info(cell).nameId === st.nameId) {
          if (isWaterType(here.fluid.type) || this.touchesWater(cell))
            this.setBlock(cell, this.concreteOf(st), UPDATE_ALL);
        }
        return false;
      }
    }
    this.event('break', cell, `${st.name} (dropped as an item on ${here.name})`);
    return false;
  }

  /** ConcretePowderBlock.touchesLiquid: water on any side but below (unless in water). */
  private touchesWater(i: number): boolean {
    const self = this.info(i);
    for (const d of ALL) {
      if (d === DOWN && !isWaterType(self.fluid.type)) continue;
      const n = this.info(this.rel(i, d));
      if (isWaterType(n.fluid.type) && (n.faces & (1 << (OPPOSITE[d] as number))) === 0)
        return true;
    }
    return false;
  }

  private concreteOf(info: StateInfo): number {
    return this.states.idOfName(info.name.replace(/_powder$/, ''));
  }

  // ---------------------------------------------------------------- fluids (FlowingFluid)

  private isSource(f: FluidInfo): boolean {
    return f.type === FL.WATER || f.type === FL.LAVA;
  }

  /** Water every 5 gt, lava every 30 (the overworld; lava's random slowdown isn't simulated). */
  private fluidTickDelay(type: number): number {
    return isLavaType(type) ? 30 : 5;
  }

  /** FluidState.createLegacyBlock. */
  private liquidBlock(f: FluidInfo): number {
    if (f.type === FL.EMPTY) return this.AIR;
    return this.states.idOfName(isWaterType(f.type) ? 'water' : 'lava', {
      level: String(legacyLevel(f)),
    });
  }

  private fluidOfFamily(lava: boolean, amount: number, falling: boolean): FluidInfo {
    return { type: lava ? FL.FLOWING_LAVA : FL.FLOWING_WATER, amount, falling };
  }

  private sameFamily(f: FluidInfo, lava: boolean): boolean {
    return lava ? isLavaType(f.type) : isWaterType(f.type);
  }

  private isSourceOf(f: FluidInfo, lava: boolean): boolean {
    return f.type === (lava ? FL.LAVA : FL.WATER);
  }

  /**
   * FlowingFluid.canPassThroughWall: neither block's collision shape is a full cube, and
   * neither covers the face between them.
   */
  private canPassThroughWall(d: number, from: StateInfo, to: StateInfo): boolean {
    if (from.faces === 63 || to.faces === 63) return false;
    if (from.collision === 0 && to.collision === 0) return true;
    return (from.faces & (1 << d)) === 0 && (to.faces & (1 << (OPPOSITE[d] as number))) === 0;
  }

  /** FlowingFluid.canHoldFluid: a fluid can go into this block (washing it away). */
  private canHoldFluid(info: StateInfo, type: number): boolean {
    if (info.waterloggable) return type === FL.WATER;
    if (info.holdsNoFluid) return false;
    // BlockStateBase.blocksMotion
    return !(info.solid && info.name !== 'cobweb' && info.name !== 'bamboo_sapling');
  }

  /** Fluid.canBeReplacedWith: water gives way only to lava from above, lava to water. */
  private canBeReplacedWith(n: number, type: number, d: number): boolean {
    const f = this.info(n).fluid;
    if (f.type === FL.EMPTY) return true;
    if (isWaterType(f.type)) return d === DOWN && !isWaterType(type);
    return this.fluidHeight(n) >= 0.44444445 && isWaterType(type);
  }

  /** FluidState.getHeight. */
  private fluidHeight(n: number): number {
    const f = this.info(n).fluid;
    if (f.type === FL.EMPTY) return 0;
    if (this.sameFamily(this.info(this.rel(n, UP)).fluid, isLavaType(f.type))) return 1;
    return f.amount / 9;
  }

  private canSpreadTo(i: number, d: number, n: number, type: number): boolean {
    if (!this.valid(n)) return false;
    const to = this.info(n);
    return (
      this.canBeReplacedWith(n, type, d) &&
      this.canPassThroughWall(d, this.info(i), to) &&
      this.canHoldFluid(to, type)
    );
  }

  /** FlowingFluid.canPassThrough, for the spread search. */
  private canPassThrough(i: number, d: number, n: number, type: number, lava: boolean): boolean {
    if (!this.valid(n)) return false;
    const to = this.info(n);
    return (
      !this.isSourceOf(to.fluid, lava) &&
      this.canPassThroughWall(d, this.info(i), to) &&
      this.canHoldFluid(to, type)
    );
  }

  /** FlowingFluid.isWaterHole: the fluid can fall down from p. */
  private isWaterHole(p: number, type: number, lava: boolean): boolean {
    const b = this.rel(p, DOWN);
    if (!this.valid(b)) return false;
    const below = this.info(b);
    if (!this.canPassThroughWall(DOWN, this.info(p), below)) return false;
    return this.sameFamily(below.fluid, lava) || this.canHoldFluid(below, type);
  }

  /** FlowingFluid.getNewLiquid: what this cell should hold, from its neighbours. */
  private newLiquid(i: number, lava: boolean): FluidInfo {
    const here = this.info(i);
    let amount = 0;
    let sources = 0;
    for (const d of HORIZONTAL) {
      const ni = this.info(this.rel(i, d));
      if (this.sameFamily(ni.fluid, lava) && this.canPassThroughWall(d, here, ni)) {
        if (this.isSourceOf(ni.fluid, lava)) sources++;
        amount = Math.max(amount, ni.fluid.amount);
      }
    }
    if (!lava && sources >= 2) {
      const below = this.info(this.rel(i, DOWN));
      if (below.solid || below.fluid.type === FL.WATER)
        return { type: FL.WATER, amount: 8, falling: false };
    }
    const above = this.info(this.rel(i, UP));
    if (this.sameFamily(above.fluid, lava) && this.canPassThroughWall(UP, here, above))
      return this.fluidOfFamily(lava, 8, true);
    const k = amount - (lava ? 2 : 1);
    return k <= 0
      ? { type: FL.EMPTY, amount: 0, falling: false }
      : this.fluidOfFamily(lava, k, false);
  }

  /** FlowingFluid.tick. */
  private tickFluid(i: number): void {
    let f = this.info(i).fluid;
    if (!this.isSource(f)) {
      const next = this.newLiquid(i, isLavaType(f.type));
      if (next.type === FL.EMPTY) {
        f = next;
        this.setBlock(i, this.AIR, UPDATE_ALL);
      } else if (next.type !== f.type || next.amount !== f.amount || next.falling !== f.falling) {
        f = next;
        const b = this.liquidBlock(next);
        this.setBlock(i, b, F.CLIENTS);
        this.scheduleFluidTick(i, next.type, this.fluidTickDelay(next.type));
        this.updateNeighborsAt(i, this.states.info(b).nameId);
      }
    }
    this.spreadFluid(i, f);
  }

  /** FlowingFluid.spread: down first, then to the sides (toward the nearest drop). */
  private spreadFluid(i: number, f: FluidInfo): void {
    if (f.type === FL.EMPTY) return;
    const lava = isLavaType(f.type);
    const b = this.rel(i, DOWN);
    const down = this.newLiquid(b, lava);
    if (this.canSpreadTo(i, DOWN, b, down.type)) {
      this.spreadTo(b, DOWN, down, lava);
      if (this.sourceNeighbours(i, lava) >= 3) this.spreadToSides(i, f);
    } else if (this.isSource(f) || !this.isWaterHole(i, down.type, lava)) {
      this.spreadToSides(i, f);
    }
  }

  private sourceNeighbours(i: number, lava: boolean): number {
    let n = 0;
    for (const d of HORIZONTAL) if (this.isSourceOf(this.info(this.rel(i, d)).fluid, lava)) n++;
    return n;
  }

  private spreadToSides(i: number, f: FluidInfo): void {
    const lava = isLavaType(f.type);
    const amount = f.falling ? 7 : f.amount - (lava ? 2 : 1);
    if (amount <= 0) return;
    for (const [d, nf] of this.getSpread(i, lava)) {
      const n = this.rel(i, d);
      if (this.canSpreadTo(i, d, n, nf.type)) this.spreadTo(n, d, nf, lava);
    }
  }

  /** FlowingFluid.getSpread: the sides closest to a way down, in EnumMap order (N, S, W, E). */
  private getSpread(i: number, lava: boolean): [number, FluidInfo][] {
    let best = 1000;
    let out: [number, FluidInfo][] = [];
    const flowing = lava ? FL.FLOWING_LAVA : FL.FLOWING_WATER;
    for (const d of HORIZONTAL) {
      const n = this.rel(i, d);
      if (!this.valid(n)) continue;
      const nf = this.newLiquid(n, lava);
      if (!this.canPassThrough(i, d, n, nf.type, lava)) continue;
      const j = this.isWaterHole(n, flowing, lava)
        ? 0
        : this.slopeDistance(n, 1, OPPOSITE[d] as number, lava);
      if (j < best) out = [];
      if (j <= best) {
        out.push([d, nf]);
        best = j;
      }
    }
    return out.sort((a, b) => a[0] - b[0]);
  }

  /** FlowingFluid.getSlopeDistance: steps to the nearest drop (water looks 4 ahead, lava 2). */
  private slopeDistance(p: number, depth: number, back: number, lava: boolean): number {
    let best = 1000;
    const flowing = lava ? FL.FLOWING_LAVA : FL.FLOWING_WATER;
    for (const d of HORIZONTAL) {
      if (d === back) continue;
      const n = this.rel(p, d);
      if (!this.canPassThrough(p, d, n, flowing, lava)) continue;
      if (this.isWaterHole(n, flowing, lava)) return depth;
      if (depth < (lava ? 2 : 4)) {
        const j = this.slopeDistance(n, depth + 1, OPPOSITE[d] as number, lava);
        if (j < best) best = j;
      }
    }
    return best;
  }

  /** FlowingFluid.spreadTo (and LavaFluid's: lava falling on water makes stone). */
  private spreadTo(n: number, d: number, nf: FluidInfo, lava: boolean): void {
    const ni = this.info(n);
    if (lava && d === DOWN && isWaterType(ni.fluid.type)) {
      if (ni.kind === K.LIQUID) this.setBlock(n, this.states.idOf('minecraft:stone'), UPDATE_ALL);
      return;
    }
    if (ni.waterloggable) {
      // SimpleWaterloggedBlock.placeLiquid: only a water source fills it
      if (ni.fluid.type !== FL.WATER && nf.type === FL.WATER) {
        this.setBlock(n, this.states.withBool(ni.id, 'waterlogged', true), UPDATE_ALL);
        this.scheduleFluidTick(n, FL.WATER, this.fluidTickDelay(FL.WATER));
      }
      return;
    }
    if (ni.kind !== K.AIR && ni.kind !== K.LIQUID && !ni.replaceable)
      this.event('break', n, `${ni.name} (${lava ? 'burnt by lava' : 'washed away'})`);
    this.setBlock(n, this.liquidBlock(nf), UPDATE_ALL);
  }

  /** LiquidBlock.shouldSpreadLiquid: lava touching water turns to obsidian or cobblestone. */
  private shouldSpreadLiquid(i: number, info: StateInfo): boolean {
    if (!isLavaType(info.fluid.type)) return true;
    const soulSoil = this.info(this.rel(i, DOWN)).name === 'soul_soil';
    for (const d of [UP, NORTH, SOUTH, WEST, EAST]) {
      const n = this.info(this.rel(i, d));
      if (isWaterType(n.fluid.type)) {
        const source = this.isSource(info.fluid);
        // 1.8–1.12 BlockLiquid.checkForMixing: only lava of level ≤ 4 turns to cobblestone
        if (!source && !this.rules.shapeSurvival && Number(info.props.level ?? 0) > 4) return true;
        const block = source ? 'minecraft:obsidian' : 'minecraft:cobblestone';
        this.setBlock(i, this.states.idOf(block), UPDATE_ALL);
        return false;
      }
      if (soulSoil && n.name === 'blue_ice') {
        this.setBlock(i, this.states.idOfName('basalt', { axis: 'y' }), UPDATE_ALL);
        return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- containers and hoppers

  /** The inventory at a cell, as a Container (a double chest is both halves, right one first). */
  private containerAt(i: number): Container | null {
    if (!this.valid(i)) return null;
    const info = this.info(i);
    const size = containerSlots(info.name);
    if (size === 0 || info.name === 'brewing_stand') return null;
    const cells = [i];
    if ((info.name === 'chest' || info.name === 'trapped_chest') && info.props.type !== 'single') {
      const d = info.props.type === 'left' ? clockwise(info.facing) : counterClockwise(info.facing);
      const other = this.rel(i, d);
      const oi = this.info(other);
      const want = info.props.type === 'left' ? 'right' : 'left';
      if (oi.nameId === info.nameId && oi.props.type === want && oi.facing === info.facing) {
        if (info.props.type === 'right') cells.push(other);
        else cells.unshift(other);
      }
    }
    return { cells, size, name: info.name };
  }

  private slots(i: number, size: number): Slots {
    let s = this.inventories.get(i);
    if (!s) {
      s = Array.from({ length: size }, () => null);
      this.inventories.set(i, s);
    }
    return s;
  }

  private getItem(c: Container, k: number): ItemStack | null {
    const inv = this.inventories.get(c.cells[Math.floor(k / c.size)] as number);
    return inv?.[k % c.size] ?? null;
  }

  private setItem(c: Container, k: number, stack: ItemStack | null): void {
    this.slots(c.cells[Math.floor(k / c.size)] as number, c.size)[k % c.size] = stack;
  }

  private isEmptyContainer(c: Container): boolean {
    for (let k = 0; k < c.size * c.cells.length; k++) if (this.getItem(c, k)) return false;
    return true;
  }

  /** WorldlyContainer.getSlotsForFace (furnaces), every slot for the rest. */
  private slotsFor(c: Container, side: number | null): number[] {
    if (/(^|_)(furnace|smoker)$/.test(c.name)) {
      if (side === null) return [0, 1, 2];
      return side === DOWN ? [2, 1] : side === UP ? [0] : [1];
    }
    return Array.from({ length: c.size * c.cells.length }, (_, k) => k);
  }

  private canPlaceItem(c: Container, k: number, stack: ItemStack, side: number | null): boolean {
    const id = stack.id.replace(/^minecraft:/, '');
    if (c.name.endsWith('shulker_box') && /shulker_box$/.test(id)) return false;
    if (/(^|_)(furnace|smoker)$/.test(c.name)) {
      if (k === 2) return false;
      if (k === 1) {
        const fuel = this.getItem(c, 1);
        return FUEL.test(id) || (id === 'bucket' && fuel?.id !== 'minecraft:bucket');
      }
    }
    void side;
    return true;
  }

  private canTakeItem(c: Container, k: number, stack: ItemStack, side: number): boolean {
    if (/(^|_)(furnace|smoker)$/.test(c.name) && side === DOWN && k === 1)
      return stack.id === 'minecraft:water_bucket' || stack.id === 'minecraft:bucket';
    return true;
  }

  /** The container changed: comparators reading it update (BlockEntity.setChanged). */
  private containerChanged(c: Container): void {
    this.hopperWake = true;
    for (const cell of c.cells) this.updateNeighbourForOutputSignal(cell, this.info(cell).nameId);
  }

  /** HopperBlockEntity.addItem: put a stack in, slot by slot; returns what didn't fit. */
  private addItem(source: number | null, dest: Container, stack: ItemStack, side: number | null) {
    for (const k of this.slotsFor(dest, side)) {
      if (stack.count <= 0) break;
      this.tryMoveInItem(source, dest, stack, k, side);
    }
    return stack;
  }

  private tryMoveInItem(
    source: number | null,
    dest: Container,
    stack: ItemStack,
    k: number,
    side: number | null,
  ): void {
    if (!this.canPlaceItem(dest, k, stack, side)) return;
    const cur = this.getItem(dest, k);
    const wasEmpty = this.isEmptyContainer(dest);
    let moved = false;
    if (!cur) {
      this.setItem(dest, k, { ...stack });
      stack.count = 0;
      moved = true;
    } else if (sameItem(cur, stack) && cur.count < maxStackSize(cur.id)) {
      const n = Math.min(stack.count, maxStackSize(cur.id) - cur.count);
      stack.count -= n;
      cur.count += n;
      moved = n > 0;
    }
    if (!moved) return;
    const dh = dest.name === 'hopper' ? this.hoppers.get(dest.cells[0] as number) : undefined;
    if (wasEmpty && dh && dh.cooldown <= 8) {
      // A hopper that just ticked hands over with one tick less, so chains move 1 item / 8 gt
      const sh = source !== null ? this.hoppers.get(source) : undefined;
      dh.cooldown = 8 - (sh && dh.tickedGameTime >= sh.tickedGameTime ? 1 : 0);
    }
    this.containerChanged(dest);
  }

  private isFull(c: Container, side: number | null): boolean {
    for (const k of this.slotsFor(c, side)) {
      const s = this.getItem(c, k);
      if (!s || s.count < maxStackSize(s.id)) return false;
    }
    return true;
  }

  /** HopperBlockEntity.pushItemsTick, for every hopper. True when one moved an item. */
  private tickHoppers(): boolean {
    let moved = false;
    for (const [i, h] of this.hoppers) {
      const info = this.info(i);
      if (info.kind !== K.HOPPER) {
        this.hoppers.delete(i);
        continue;
      }
      h.cooldown--;
      h.tickedGameTime = this.time;
      if (h.cooldown > 0) continue;
      h.cooldown = 0;
      if (!info.enabled) continue;
      const self: Container = { cells: [i], size: 5, name: 'hopper' };
      let ok = false;
      if (!this.isEmptyContainer(self)) ok = this.ejectItems(i, info, self);
      if (!this.isFull(self, null)) ok = this.suckInItems(i, self) || ok;
      if (ok) {
        h.cooldown = 8;
        this.containerChanged(self);
        moved = true;
      }
    }
    return moved;
  }

  private ejectItems(i: number, info: StateInfo, self: Container): boolean {
    const target = this.containerAt(this.rel(i, info.facing));
    if (!target) return false;
    const side = OPPOSITE[info.facing] as number;
    if (this.isFull(target, side)) return false;
    for (let k = 0; k < self.size; k++) {
      const st = this.getItem(self, k);
      if (!st) continue;
      const rest = this.addItem(i, target, { ...st, count: 1 }, side);
      if (rest.count === 0) {
        st.count--;
        if (st.count <= 0) this.setItem(self, k, null);
        return true;
      }
    }
    return false;
  }

  /** HopperBlockEntity.suckInItems: one item from the container above (item entities aren't simulated). */
  private suckInItems(i: number, self: Container): boolean {
    const src = this.containerAt(this.rel(i, UP));
    if (!src) return false;
    for (const k of this.slotsFor(src, DOWN)) {
      const st = this.getItem(src, k);
      if (!st || !this.canTakeItem(src, k, st, DOWN)) continue;
      const srcCell = src.name === 'hopper' ? (src.cells[0] as number) : null;
      const rest = this.addItem(srcCell, self, { ...st, count: 1 }, null);
      if (rest.count === 0) {
        st.count--;
        if (st.count <= 0) this.setItem(src, k, null);
        this.containerChanged(src);
        return true;
      }
    }
    return false;
  }

  /** DispenserBlock.dispenseFrom / DropperBlock.dispenseFrom. */
  private dispenseFrom(i: number, info: StateInfo): void {
    const self = this.containerAt(i) ?? { cells: [i], size: 9, name: info.name };
    // The game picks a random non-empty slot; the first one keeps tests repeatable.
    let k = -1;
    for (let s = 0; s < 9; s++)
      if (this.getItem(self, s)) {
        k = s;
        break;
      }
    if (k < 0) {
      this.event('dispense', i, `${info.name} is empty`);
      return;
    }
    const st = this.getItem(self, k) as ItemStack;
    const front = this.rel(i, info.facing);
    const id = st.id.replace(/^minecraft:/, '');
    if (info.name === 'dropper') {
      const target = this.containerAt(front);
      if (target) {
        const rest = this.addItem(i, target, { ...st, count: 1 }, OPPOSITE[info.facing] as number);
        if (rest.count > 0) return;
      } else this.event('dispense', i, `dropper drops ${id}`);
      this.shrink(self, k, st);
      return;
    }
    if (id === 'water_bucket' || id === 'lava_bucket') {
      if (this.emptyBucket(front, id === 'water_bucket')) {
        this.consumeWithRemainder(self, k, st, 'minecraft:bucket');
        return;
      }
    } else if (id === 'bucket') {
      const filled = this.pickupFluid(front);
      if (filled) {
        this.consumeWithRemainder(self, k, st, filled);
        return;
      }
    } else if (id === 'tnt') {
      this.event('tnt', front, 'primed TNT dispensed (explosions are not simulated)');
      this.shrink(self, k, st);
      return;
    } else if (id === 'flint_and_steel') {
      if (this.info(front).kind === K.TNT) this.primeTnt(front);
      else this.event('dispense', i, 'flint and steel (fire is not simulated)');
      this.containerChanged(self);
      return;
    }
    this.event('dispense', i, `${info.name} shoots ${id}`);
    this.shrink(self, k, st);
  }

  private shrink(c: Container, k: number, st: ItemStack): void {
    st.count--;
    if (st.count <= 0) this.setItem(c, k, null);
    this.containerChanged(c);
  }

  /** DefaultDispenseItemBehavior.consumeWithRemainder: the bucket comes back. */
  private consumeWithRemainder(c: Container, k: number, st: ItemStack, remainder: string): void {
    st.count--;
    if (st.count <= 0) this.setItem(c, k, { id: remainder, count: 1 });
    else {
      const rest = this.addItem(null, c, { id: remainder, count: 1 }, null);
      if (rest.count > 0) this.event('dispense', c.cells[0] as number, `drops ${remainder}`);
    }
    this.containerChanged(c);
  }

  /** BucketItem.emptyContents. */
  private emptyBucket(n: number, water: boolean): boolean {
    if (!this.valid(n)) return false;
    const info = this.info(n);
    const fits = info.replaceable || !info.solid;
    if (info.waterloggable && water) {
      if (info.fluid.type !== FL.WATER) {
        this.setBlock(n, this.states.withBool(info.id, 'waterlogged', true), UPDATE_ALL);
        this.scheduleFluidTick(n, FL.WATER, this.fluidTickDelay(FL.WATER));
      }
      return true;
    }
    if (info.kind !== K.AIR && !fits) return false;
    if (fits && info.kind !== K.LIQUID && info.kind !== K.AIR) this.destroyBlock(n);
    const src = water
      ? { type: FL.WATER, amount: 8, falling: false }
      : { type: FL.LAVA, amount: 8, falling: false };
    this.setBlock(n, this.liquidBlock(src), UPDATE_ALL | 8);
    return true;
  }

  /** BucketPickup.pickupBlock: a source block (or a waterlogged block's water) into a bucket. */
  private pickupFluid(n: number): string | null {
    if (!this.valid(n)) return null;
    const info = this.info(n);
    if (info.kind === K.LIQUID && this.isSource(info.fluid)) {
      this.setBlock(n, this.AIR, UPDATE_ALL | 8);
      return info.fluid.type === FL.WATER ? 'minecraft:water_bucket' : 'minecraft:lava_bucket';
    }
    if (info.waterloggable && info.fluid.type === FL.WATER) {
      this.setBlock(n, this.states.withBool(info.id, 'waterlogged', false), UPDATE_ALL);
      return 'minecraft:water_bucket';
    }
    return null;
  }

  /** Items in a container block, by slot (null when it holds none). */
  inventoryAt(i: number): Slots | null {
    const inv = this.inventories.get(i);
    return inv && inv.some((s) => s) ? inv.map((s) => (s ? { ...s } : null)) : null;
  }

  // ---------------------------------------------------------------- lecterns

  /** LecternBlock.changePowered: powers the block below it. */
  private lecternPowered(i: number, info: StateInfo, on: boolean): void {
    this.setBlock(i, this.states.withBool(info.id, 'powered', on), UPDATE_ALL);
    this.updateNeighborsAt(this.rel(i, DOWN), info.nameId);
  }

  // ---------------------------------------------------------------- player actions

  /** Right-click: flip a lever, press a button, cycle a repeater, toggle a comparator or door. */
  use(i: number): boolean {
    const info = this.info(i);
    switch (info.kind) {
      case K.LEVER: {
        const s = this.states.withBool(info.id, 'powered', !info.powered);
        this.setBlock(i, s, UPDATE_ALL);
        this.updateAttachedNeighbours(i, this.states.info(s));
        return true;
      }
      case K.BUTTON: {
        if (info.powered) return false;
        const s = this.states.withBool(info.id, 'powered', true);
        this.setBlock(i, s, UPDATE_ALL);
        this.updateAttachedNeighbours(i, this.states.info(s));
        this.scheduleTick(i, buttonTicks(info.name));
        return true;
      }
      case K.REPEATER:
        this.setBlock(
          i,
          this.states.with(info.id, 'delay', String((info.delay % 4) + 1)),
          UPDATE_ALL,
        );
        return true;
      case K.COMPARATOR: {
        const s = this.states.with(info.id, 'mode', info.subtract ? 'compare' : 'subtract');
        this.setBlock(i, s, F.CLIENTS);
        this.refreshComparator(i, this.states.info(s));
        return true;
      }
      case K.DOOR:
      case K.TRAPDOOR:
      case K.FENCE_GATE:
        if (/^iron_/.test(info.name)) return false;
        this.setBlock(i, this.states.withBool(info.id, 'open', !info.open), F.CLIENTS | 8);
        return true;
      case K.NOTE_BLOCK: {
        // NoteBlock.useWithoutItem: tune up one note, then play
        const note = info.props.note;
        // 1.8–1.12 keep the note in a block entity: tuning updates nothing around it.
        const flags = this.rules.noteBlockState ? UPDATE_ALL : F.CLIENTS | F.KNOWN_SHAPE;
        if (note !== undefined)
          this.setBlock(
            i,
            this.states.with(info.id, 'note', String((Number(note) + 1) % 25)),
            flags,
          );
        if (this.info(this.rel(i, UP)).kind === K.AIR) this.blockEvent(i, 0, 0);
        return true;
      }
      case K.DAYLIGHT: {
        // DaylightDetectorBlock.useWithoutItem: inverted under the same sky gives 15 − power
        const s = this.states.withBool(info.id, 'inverted', info.props.inverted !== 'true');
        this.setBlock(i, s, F.CLIENTS);
        this.setPower(i, 15 - Math.max(0, info.power));
        return true;
      }
      case K.LECTERN:
        // Turning a page: a 2 gt pulse into the block below
        if (info.props.has_book !== 'true' || info.powered) return false;
        this.lecternPowered(i, info, true);
        this.scheduleTick(i, 2);
        return true;
      case K.TRAPPED_CHEST:
        this.setChestOpeners(i, this.chestOpenersAt(i) > 0 ? 0 : 1);
        return true;
      default:
        return false;
    }
  }

  /**
   * What a player does to set a block off, for the viewer: right-click (see use), step on a
   * pressure plate or off it, shoot a target (its power from where the arrow hits: `hit` is the
   * point on the block, 0–1, and the face), ride a minecart onto a detector rail, strike a
   * lightning rod, make a sculk sensor hear something, ring a bell, light TNT.
   */
  activate(i: number, hit?: { face: number; point: Vec3 }): boolean {
    const info = this.info(i);
    switch (info.kind) {
      case K.PLATE:
      case K.WEIGHTED_PLATE:
        this.setPlateEntities(i, this.plateEntitiesAt(i) > 0 ? 0 : 1);
        if (this.plateEntitiesAt(i) > 0 && this.plateSignal(info) === 0)
          this.checkPlate(i, info, 0);
        return true;
      case K.TARGET: {
        let power = 15;
        if (hit) {
          // TargetBlock.getRedstoneStrength: 15 in the middle of the face, down to 1 at its edge
          const [x, y, z] = hit.point.map((v) => Math.abs(v - Math.floor(v) - 0.5)) as Vec3;
          const axis = axisOf(hit.face);
          const d = axis === 1 ? Math.max(x, z) : axis === 2 ? Math.max(x, y) : Math.max(y, z);
          power = Math.max(1, Math.ceil(15 * Math.min(1, Math.max(0, (0.5 - d) / 0.5))));
        }
        this.hitTarget(i, power, 20);
        return true;
      }
      case K.RAIL:
        if (info.name !== 'detector_rail') return false;
        this.setBlock(i, this.states.withBool(info.id, 'powered', !info.powered), UPDATE_ALL);
        this.updateNeighborsAt(i, info.nameId);
        this.updateNeighborsAt(this.rel(i, DOWN), info.nameId);
        this.updateNeighbourForOutputSignal(i, info.nameId);
        return true;
      case K.LIGHTNING_ROD:
        // LightningRodBlock.onLightningStrike: 8 gt of power
        if (info.powered) return false;
        this.setBlock(i, this.states.withBool(info.id, 'powered', true), UPDATE_ALL);
        this.updateNeighborsAt(this.rel(i, OPPOSITE[info.facing] as number), info.nameId);
        this.scheduleTick(i, 8);
        return true;
      case K.SCULK_SENSOR: {
        // SculkSensorBlock.activate: a vibration right next to it
        if (
          info.props.sculk_sensor_phase !== 'inactive' &&
          info.props.sculk_sensor_phase !== undefined
        )
          return false;
        let s = this.states.withPower(info.id, 15);
        s = this.states.with(s, 'sculk_sensor_phase', 'active');
        this.setBlock(i, s, UPDATE_ALL);
        this.scheduleTick(i, info.name === 'calibrated_sculk_sensor' ? 10 : 30);
        this.updateNeighborsAt(i, info.nameId);
        this.updateNeighborsAt(this.rel(i, DOWN), info.nameId);
        return true;
      }
      case K.BELL:
        this.event('bell', i);
        return true;
      case K.TNT:
        this.primeTnt(i);
        return true;
      default:
        return this.use(i);
    }
  }

  /** Players looking into a chest, both halves of a double one: a trapped chest powers by it. */
  setChestOpeners(i: number, n: number): void {
    const count = Math.max(0, Math.floor(n));
    for (const cell of this.containerAt(i)?.cells ?? [i]) {
      if ((this.openers.get(cell) ?? 0) === count) continue;
      this.openers.set(cell, count);
      // TrappedChestBlockEntity.signalOpenCount
      const ci = this.info(cell);
      if (ci.kind !== K.TRAPPED_CHEST) continue;
      this.updateNeighborsAt(cell, ci.nameId);
      this.updateNeighborsAt(this.rel(cell, DOWN), ci.nameId);
    }
  }

  /** Players looking into a chest. */
  chestOpenersAt(i: number): number {
    return this.openers.get(i) ?? 0;
  }

  /** Entities standing on a pressure plate (weighted plates count them). */
  setPlateEntities(i: number, count: number): void {
    this.plateEntities.set(i, Math.max(0, count));
  }

  plateEntitiesAt(i: number): number {
    return this.plateEntities.get(i) ?? 0;
  }

  /** A projectile hits a target block: power for `ticks` (arrows 20, others 8). */
  hitTarget(i: number, power: number, ticks = 20): void {
    const info = this.info(i);
    if (info.kind !== K.TARGET) return;
    this.setBlock(i, this.states.withPower(info.id, Math.max(0, Math.min(15, power))), UPDATE_ALL);
    this.scheduleTick(i, ticks);
  }

  /** Set the power level a daylight detector, sculk sensor or similar block gives off. */
  setPower(i: number, power: number): void {
    const info = this.info(i);
    if (info.power < 0) return;
    this.setBlock(i, this.states.withPower(info.id, Math.max(0, Math.min(15, power))), UPDATE_ALL);
  }

  /** Place a block like a player (diodes start their tick if powered). */
  place(i: number, state: string): void {
    const id = this.states.idOf(state);
    this.setBlock(i, id, UPDATE_ALL | 8);
    const info = this.states.info(id);
    if (this.isDiode(info) && this.cells[i] === id) {
      const on =
        info.kind === K.COMPARATOR ? this.comparatorOn(i, info) : this.diodeInput(i, info) > 0;
      if (on) this.scheduleTick(i, 1);
    }
  }

  /** Break a block like a player. */
  breakBlock(i: number): void {
    this.destroyBlock(i);
  }

  /**
   * Bring the build to life as if every component had just been placed: refresh dust shapes,
   * repeater locks and door halves, update every component once, then run until nothing is
   * scheduled (or maxTicks pass). Returns true when the circuit came to rest.
   */
  powerOn(maxTicks = 1200): boolean {
    const comps: number[] = [];
    for (let i = 0; i < this.cells.length; i++) {
      const k = this.info(i).kind;
      // Sand, gravel and liquids stay as built until something next to them changes, as
      // after a WorldEdit paste.
      if (k === K.AIR || k === K.SOLID || k === K.FALLING || k === K.LIQUID) continue;
      if (k === K.POINTED_DRIPSTONE) continue;
      comps.push(i);
    }
    for (const i of comps) {
      const id = this.cells[i] as number;
      const k = this.states.kind(id);
      if (k !== K.WIRE && k !== K.REPEATER && k !== K.DOOR) continue;
      const s = this.updateFromNeighbourShapes(id, i);
      if (s !== id && this.states.kind(s) !== K.AIR) {
        this.cells[i] = s;
        this.markChanged(i);
      }
    }
    for (const i of comps) {
      const info = this.info(i);
      if (info.kind === K.COMPARATOR && !this.comparatorOut.has(i))
        this.comparatorOut.set(i, info.powered ? this.comparatorOutput(i, info) : 0);
      if (info.kind === K.AIR) continue;
      this.updates = 0;
      this.neighborChanged(i, info.nameId, i);
    }
    return this.settle(maxTicks);
  }

  /** Run until idle; false if still busy after maxTicks (a clock, or a long delay line). */
  settle(maxTicks: number): boolean {
    for (let t = 0; t < maxTicks; t++) {
      if (this.idle) return true;
      this.tick();
    }
    return this.idle;
  }

  /** Everything that changes while the world runs, to rewind it (test cases start alike). */
  snapshot(): WorldSnapshot {
    const copyMoving = (m: MovingBlock): MovingBlock => ({ ...m });
    const moving = new Map<MovingBlock, MovingBlock>();
    for (const m of [...this.moving.values(), ...this.tickers, ...this.pendingTickers])
      if (!moving.has(m)) moving.set(m, copyMoving(m));
    return {
      cells: this.cells.slice(),
      time: this.time,
      seq: this.seq,
      heap: this.blockTicks.heap.map((t) => ({ ...t })),
      fluidHeap: this.fluidTicks.heap.map((t) => ({ ...t })),
      events: this.eventQueue.slice(this.eventHead).map((e) => ({ ...e })),
      moving: [...this.moving.entries()].map(([k, m]) => [k, moving.get(m) as MovingBlock]),
      tickers: this.tickers.map((m) => moving.get(m) as MovingBlock),
      pending: this.pendingTickers.map((m) => moving.get(m) as MovingBlock),
      comparatorOut: new Map(this.comparatorOut),
      inventories: copyInventories(this.inventories),
      plateEntities: new Map(this.plateEntities),
      toggles: this.toggles.map((t) => ({ ...t })),
      eventLog: this.events.length,
      falling: this.falling.map((e) => ({ ...e })),
      hoppers: [...this.hoppers].map(([k, h]) => [k, { ...h }]),
      hopperWake: this.hopperWake,
      openers: new Map(this.openers),
    };
  }

  restore(s: WorldSnapshot): void {
    for (let i = 0; i < this.cells.length; i++)
      if (this.cells[i] !== s.cells[i]) this.markChanged(i);
    this.cells.set(s.cells);
    this.time = s.time;
    this.seq = s.seq;
    const copies = new Map<MovingBlock, MovingBlock>();
    const copy = (m: MovingBlock) => {
      let c = copies.get(m);
      if (!c) copies.set(m, (c = { ...m }));
      return c;
    };
    this.blockTicks.load(s.heap, (t) => this.tickKey(t.pos, t.type));
    this.fluidTicks.load(s.fluidHeap, (t) => this.tickKey(t.pos, t.type));
    this.eventQueue = s.events.map((e) => ({ ...e }));
    this.eventHead = 0;
    this.eventKeys.clear();
    for (const e of this.eventQueue) this.eventKeys.add(`${e.pos},${e.type},${e.b0},${e.b1}`);
    for (const k of this.moving.keys()) this.markChanged(k);
    this.moving.clear();
    for (const [k, m] of s.moving) {
      this.moving.set(k, copy(m));
      this.markChanged(k);
    }
    this.tickers = s.tickers.map(copy);
    this.pendingTickers = s.pending.map(copy);
    this.comparatorOut.clear();
    for (const [k, v] of s.comparatorOut) this.comparatorOut.set(k, v);
    this.inventories.clear();
    for (const [k, v] of copyInventories(s.inventories)) this.inventories.set(k, v);
    this.plateEntities.clear();
    for (const [k, v] of s.plateEntities) this.plateEntities.set(k, v);
    this.toggles = s.toggles.map((t) => ({ ...t }));
    this.events.length = Math.min(this.events.length, s.eventLog);
    this.falling = s.falling.map((e) => ({ ...e }));
    this.hoppers.clear();
    for (const [k, h] of s.hoppers) this.hoppers.set(k, { ...h });
    this.hopperWake = s.hopperWake;
    this.openers.clear();
    for (const [k, v] of s.openers) this.openers.set(k, v);
  }

  /**
   * The state a player placing this block would get from its neighbours: dust connections (a
   * lone dust is a cross from 1.16), a repeater's lock. Other blocks are returned unchanged.
   */
  placementState(i: number): number {
    const info = this.info(i);
    if (info.kind === K.WIRE)
      return this.wireConnectionState(i, this.states.withSides(info.id, 1, 1, 1, 1));
    if (info.kind === K.REPEATER)
      return this.states.withBool(info.id, 'locked', this.isLocked(i, info));
    return info.id;
  }

  /** Comparator output strength (its block entity), for probes. */
  comparatorOutputAt(i: number): number {
    return this.comparatorOut.get(i) ?? 0;
  }
}

function copyInventories(m: ReadonlyMap<number, Slots>): Map<number, Slots> {
  const out = new Map<number, Slots>();
  for (const [k, v] of m)
    out.set(
      k,
      v.map((s) => (s ? { ...s } : null)),
    );
  return out;
}

/** A block entity inventory seen as one container (a double chest has two cells). */
interface Container {
  cells: number[];
  /** Slots per cell. */
  size: number;
  name: string;
}

/** What furnaces take as fuel from a hopper on their side (the common ones). */
const FUEL =
  /^(coal|charcoal|coal_block|lava_bucket|blaze_rod|stick|bamboo|dried_kelp_block|scaffolding|bowl|crafting_table|bookshelf|chest|barrel|composter|ladder|jukebox|note_block)$|^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo)_(log|wood|planks|slab|stairs|fence|fence_gate|door|trapdoor|button|pressure_plate|sign|boat|sapling)$|^stripped_.*_(log|wood)$|_wool$|_carpet$/;

/** Which way a pointed dripstone points (its tip direction). */
function dripstoneTip(info: StateInfo): number {
  return info.props.vertical_direction === 'up' ? UP : DOWN;
}

/** Direction from the supporting block to a lever or button. */
function connectedDir(info: StateInfo): number {
  return info.face === 'floor' ? UP : info.face === 'ceiling' ? DOWN : info.facing;
}

function isDot(info: StateInfo): boolean {
  const s = info.sides;
  return !s[NORTH] && !s[SOUTH] && !s[EAST] && !s[WEST];
}

function isCross(info: StateInfo): boolean {
  const s = info.sides;
  return !!s[NORTH] && !!s[SOUTH] && !!s[EAST] && !!s[WEST];
}

/** PistonStructureResolver: which blocks a piston moves, at most 12, slime and honey included. */
class PistonStructure {
  readonly toPush: number[] = [];
  readonly toDestroy: number[] = [];
  private readonly pushDir: number;
  private readonly start: number;

  constructor(
    private readonly w: World,
    private readonly piston: number,
    private readonly pistonDir: number,
    private readonly extending: boolean,
  ) {
    this.pushDir = extending ? pistonDir : (OPPOSITE[pistonDir] as number);
    this.start = w.rel(piston, pistonDir, extending ? 1 : 2);
  }

  resolve(): boolean {
    this.toPush.length = 0;
    this.toDestroy.length = 0;
    const w = this.w;
    const info = w.info(this.start);
    if (!w.isPushable(this.start, this.pushDir, false, this.pistonDir)) {
      if (this.extending && info.push === PUSH.DESTROY && w.valid(this.start)) {
        this.toDestroy.push(this.start);
        return true;
      }
      return false;
    }
    if (!this.addBlockLine(this.start, this.pushDir)) return false;
    for (let k = 0; k < this.toPush.length; k++) {
      const p = this.toPush[k] as number;
      if (isStickyBlock(w.info(p)) && !this.addBranchingBlocks(p)) return false;
    }
    return true;
  }

  private addBlockLine(from: number, dir: number): boolean {
    const w = this.w;
    let info = w.info(from);
    if (info.kind === K.AIR) return true;
    if (!w.isPushable(from, this.pushDir, false, dir)) return true;
    if (from === this.piston) return true;
    if (this.toPush.includes(from)) return true;
    let i = 1;
    if (i + this.toPush.length > 12) return false;
    const back = OPPOSITE[this.pushDir] as number;
    while (isStickyBlock(info)) {
      const p = w.rel(from, back, i);
      const prev = info;
      info = w.info(p);
      if (
        info.kind === K.AIR ||
        !canStickBlocks(prev, info) ||
        !w.isPushable(p, this.pushDir, false, back) ||
        p === this.piston
      )
        break;
      if (++i + this.toPush.length > 12) return false;
    }
    let j = 0;
    for (let k = i - 1; k >= 0; k--) {
      this.toPush.push(w.rel(from, back, k));
      j++;
    }
    for (let k = 1; ; k++) {
      const p = w.rel(from, this.pushDir, k);
      const l = this.toPush.indexOf(p);
      if (l > -1) {
        this.reorder(j, l);
        for (let m = 0; m <= l + j; m++) {
          const q = this.toPush[m] as number;
          if (isStickyBlock(w.info(q)) && !this.addBranchingBlocks(q)) return false;
        }
        return true;
      }
      info = w.info(p);
      if (info.kind === K.AIR) return true;
      if (!w.isPushable(p, this.pushDir, true, this.pushDir) || p === this.piston) return false;
      if (info.push === PUSH.DESTROY) {
        this.toDestroy.push(p);
        return true;
      }
      if (this.toPush.length >= 12) return false;
      this.toPush.push(p);
      j++;
    }
  }

  private reorder(i: number, j: number): void {
    const a = this.toPush.slice(0, j);
    const b = this.toPush.slice(this.toPush.length - i);
    const c = this.toPush.slice(j, this.toPush.length - i);
    this.toPush.length = 0;
    this.toPush.push(...a, ...b, ...c);
  }

  private addBranchingBlocks(from: number): boolean {
    const w = this.w;
    const info = w.info(from);
    for (const d of ALL) {
      if (axisOf(d) === axisOf(this.pushDir)) continue;
      const p = w.rel(from, d);
      if (!canStickBlocks(w.info(p), info) || this.addBlockLine(p, d)) continue;
      return false;
    }
    return true;
  }
}

function isStickyBlock(info: StateInfo): boolean {
  return info.name === 'slime_block' || info.name === 'honey_block';
}

function canStickBlocks(a: StateInfo, b: StateInfo): boolean {
  if (a.name === 'honey_block' && b.name === 'slime_block') return false;
  if (a.name === 'slime_block' && b.name === 'honey_block') return false;
  return isStickyBlock(a) || isStickyBlock(b);
}

export { DX, DY, DZ };
export type { Kind };
