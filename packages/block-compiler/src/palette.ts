import { stringifyState, type BlockCatalog } from '@minecraft-schematic-lab/catalog';
import { transformProps, type Transform } from './transform';

export const AIR_STATE = 'minecraft:air';

/** Compute fence/wall/pane connections from neighbours (the game doesn't on paste). */
export const FLAG_CONNECT = 1;
/** Compute the stair corner shape from neighbours. */
export const FLAG_STAIR_SHAPE = 2;
/** Add the missing half of a door / tall plant / bed. */
export const FLAG_COMPLETE = 4;

export interface PaletteEntry {
  state: string;
  name: string;
  props: Record<string, string>;
  flags: number;
}

const SIDES = ['north', 'east', 'south', 'west'];

export function connectsLikeFence(cat: BlockCatalog, name: string): boolean {
  const v = cat.propValues(name, 'north');
  if (!v) return false;
  return (
    name.endsWith('_fence') ||
    name.endsWith('_wall') ||
    name.endsWith('_pane') ||
    name.endsWith('_bars') ||
    name === 'iron_bars' ||
    name === 'glass_pane'
  );
}

/**
 * Compile-time palette. Each entry is a full block state plus flags telling the post-pass which
 * properties it should still compute; the same state written with explicit connections and
 * without are distinct entries until the post-pass resolves them.
 */
export class InternalPalette {
  readonly entries: PaletteEntry[] = [{ state: AIR_STATE, name: 'air', props: {}, flags: 0 }];
  private readonly index = new Map<string, number>([[`${AIR_STATE}|0`, 0]]);
  private readonly transformed = new Map<number, number>();

  constructor(readonly catalog: BlockCatalog) {}

  /** Register a normalized state; `explicit` lists properties the author set by hand. */
  add(name: string, props: Record<string, string>, explicit: readonly string[]): number {
    let flags = 0;
    const ex = new Set(explicit);
    if (connectsLikeFence(this.catalog, name) && !SIDES.some((s) => ex.has(s))) {
      flags |= FLAG_CONNECT;
    }
    if (name.endsWith('_stairs') && !ex.has('shape')) flags |= FLAG_STAIR_SHAPE;
    if ((props.half === 'lower' && 'half' in props) || props.part === 'foot')
      flags |= FLAG_COMPLETE;
    return this.addRaw(name, props, flags);
  }

  addRaw(name: string, props: Record<string, string>, flags: number): number {
    if (name === 'air') return 0;
    const state = stringifyState(name, props);
    const key = `${state}|${flags}`;
    const existing = this.index.get(key);
    if (existing !== undefined) return existing;
    const id = this.entries.length;
    if (id > 65000) throw new Error('Too many distinct block states (over 65000).');
    this.entries.push({ state, name, props, flags });
    this.index.set(key, id);
    return id;
  }

  get(id: number): PaletteEntry {
    return this.entries[id] as PaletteEntry;
  }

  /** The id of `id` rotated/mirrored by `t` (cached per transform kind). */
  transform(id: number, t: Transform): number {
    if (id === 0 || t.isIdentityLinear) return id;
    const key = id * 8 + t.linearKey;
    const hit = this.transformed.get(key);
    if (hit !== undefined) return hit;
    const e = this.get(id);
    const props = transformProps(t, e.name, e.props);
    const out = this.addRaw(e.name, props, e.flags);
    this.transformed.set(key, out);
    return out;
  }
}
