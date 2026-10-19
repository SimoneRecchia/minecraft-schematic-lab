import { blockTraits, hasBlockEntity, pushReactionOf, stateTraits } from './blocks';
import type { BlockTraits, FullCubeTest, Kind, PushReaction } from './blocks';
import { dirOf, NORTH, SOUTH, WEST } from './dirs';
import { fallingOf, fluidOf, HOLDS_NO_FLUID, isReplaceable, shapeOf } from './shapes';
import type { FluidInfo } from './shapes';

/** Wire connection on one side: none, side (flat), up (climbs the block on that side). */
export const SIDE_NONE = 0;
export const SIDE_SIDE = 1;
export const SIDE_UP = 2;
const SIDE_NAMES = ['none', 'side', 'up'] as const;
const sideOf = (v: string | undefined) => (v === 'up' ? SIDE_UP : v === 'side' ? SIDE_SIDE : 0);

// The engine also runs in the browser, so it parses states itself instead of importing the
// catalog (and its block data). Same canonical form: namespaced, properties sorted.
export function blockNameOf(state: string): string {
  const noNs = state.includes(':') ? state.slice(state.indexOf(':') + 1) : state;
  const br = noNs.indexOf('[');
  return br === -1 ? noNs : noNs.slice(0, br);
}

export function propsOf(state: string): Record<string, string> {
  const br = state.indexOf('[');
  const out: Record<string, string> = {};
  if (br === -1) return out;
  for (const pair of state.slice(br + 1, -1).split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

export function stringifyState(name: string, props: Readonly<Record<string, string>>): string {
  const keys = Object.keys(props).sort();
  const base = `minecraft:${name}`;
  return keys.length ? `${base}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : base;
}

/** Everything the engine reads from one block state, decoded once. */
export interface StateInfo extends BlockTraits {
  id: number;
  state: string;
  props: Readonly<Record<string, string>>;
  /** Direction index from `facing` (-1 if none). */
  facing: number;
  /** `face` of levers and buttons: floor, wall, ceiling. */
  face: string | undefined;
  /** `power` (dust, weighted plates, target, daylight detector, sculk sensors), -1 if none. */
  power: number;
  powered: boolean;
  lit: boolean;
  extended: boolean;
  open: boolean;
  triggered: boolean;
  enabled: boolean;
  locked: boolean;
  delay: number;
  subtract: boolean;
  /** Dust connections by direction index (only north/south/west/east are set). */
  sides: [number, number, number, number, number, number];
  push: PushReaction;
  blockEntity: boolean;
  /** Same number for every state of one block (scheduled ticks and block events are per block). */
  nameId: number;
  /** Top of the collision box over the middle of the cell (0: none, 1.5 for fences). */
  collision: number;
  /** Faces the collision shape covers completely (bit per direction; 63 = full cube). */
  faces: number;
  /** BlockStateBase.isSolid (legacy solidity: fluids, falling blocks and hoppers ask it). */
  solid: boolean;
  /** BlockState.canBeReplaced(): air, liquids, grass, snow… */
  replaceable: boolean;
  /** The fluid in this block (water, lava, or water in a waterlogged block). */
  fluid: FluidInfo;
  /** Has a `waterlogged` property (SimpleWaterloggedBlock). */
  waterloggable: boolean;
  /** FlowingFluid.canHoldFluid fails for it whatever its shape (doors, signs, ladders…). */
  holdsNoFluid: boolean;
  /** FALL.* — sand, gravel, anvils, concrete powder, suspicious sand… */
  falls: number;
}

function shapeFields(name: string, props: Readonly<Record<string, string>>, full: boolean) {
  const { top, faces, solid } = shapeOf(name, props, full);
  return { collision: top, faces, solid };
}

/**
 * All block states the simulation has seen, numbered. Cells store the number; changing one
 * property is a memoized table lookup, so ticking never parses strings.
 */
export class StateTable {
  readonly infos: StateInfo[] = [];
  private readonly ids = new Map<string, number>();
  private readonly withCache: Map<string, number>[] = [];
  private readonly baseTraits = new Map<string, BlockTraits>();
  private readonly nameIds = new Map<string, number>();

  constructor(private readonly isFullCube: FullCubeTest) {}

  get size(): number {
    return this.infos.length;
  }

  idOf(state: string): number {
    const hit = this.ids.get(state);
    if (hit !== undefined) return hit;
    const name = blockNameOf(state);
    return this.add(stringifyState(name, propsOf(state)), name, propsOf(state));
  }

  idOfName(name: string, props: Record<string, string> = {}): number {
    return this.idOf(stringifyState(name, props));
  }

  private add(state: string, name: string, props: Record<string, string>): number {
    const canonical = this.ids.get(state);
    if (canonical !== undefined) return canonical;
    let base = this.baseTraits.get(name);
    if (!base) {
      base = blockTraits(name, this.isFullCube);
      this.baseTraits.set(name, base);
    }
    const traits = stateTraits(base, props);
    const id = this.infos.length;
    const p = props;
    const info: StateInfo = {
      ...traits,
      id,
      state,
      props: p,
      facing: dirOf(p.facing),
      face: p.face,
      power: p.power !== undefined ? Number(p.power) : -1,
      powered: p.powered === 'true',
      lit: p.lit === 'true',
      extended: p.extended === 'true',
      open: p.open === 'true',
      triggered: p.triggered === 'true',
      enabled: p.enabled !== 'false',
      locked: p.locked === 'true',
      delay: p.delay !== undefined ? Number(p.delay) : 1,
      subtract: p.mode === 'subtract',
      sides: [0, 0, sideOf(p.north), sideOf(p.south), sideOf(p.west), sideOf(p.east)],
      push: pushReactionOf(name),
      blockEntity: hasBlockEntity(name),
      nameId: this.nameIdOf(name),
      ...shapeFields(name, p, this.isFullCube(name)),
      replaceable: isReplaceable(name),
      fluid: fluidOf(name, p),
      waterloggable: 'waterlogged' in p,
      holdsNoFluid: HOLDS_NO_FLUID.test(name),
      falls: fallingOf(name),
    };
    this.infos.push(info);
    this.withCache.push(new Map());
    this.ids.set(state, id);
    return id;
  }

  nameIdOf(name: string): number {
    let n = this.nameIds.get(name);
    if (n === undefined) {
      n = this.nameIds.size;
      this.nameIds.set(name, n);
    }
    return n;
  }

  info(id: number): StateInfo {
    return this.infos[id] as StateInfo;
  }

  kind(id: number): Kind {
    return (this.infos[id] as StateInfo).kind;
  }

  /** Same block with one or more properties changed (unknown properties are ignored). */
  with(id: number, key: string, value: string): number {
    const cache = this.withCache[id] as Map<string, number>;
    const k = `${key}=${value}`;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const info = this.info(id);
    let out = id;
    if (key in info.props && info.props[key] !== value) {
      const props = { ...info.props, [key]: value };
      out = this.add(stringifyState(info.name, props), info.name, props);
    }
    cache.set(k, out);
    return out;
  }

  withBool(id: number, key: string, value: boolean): number {
    return this.with(id, key, value ? 'true' : 'false');
  }

  withPower(id: number, power: number): number {
    return this.with(id, 'power', String(power));
  }

  withSides(id: number, n: number, e: number, s: number, w: number): number {
    let out = this.with(id, 'north', SIDE_NAMES[n] as string);
    out = this.with(out, 'east', SIDE_NAMES[e] as string);
    out = this.with(out, 'south', SIDE_NAMES[s] as string);
    return this.with(out, 'west', SIDE_NAMES[w] as string);
  }

  withSide(id: number, dir: number, side: number): number {
    const key = dir === NORTH ? 'north' : dir === SOUTH ? 'south' : dir === WEST ? 'west' : 'east';
    return this.with(id, key, SIDE_NAMES[side] as string);
  }
}
