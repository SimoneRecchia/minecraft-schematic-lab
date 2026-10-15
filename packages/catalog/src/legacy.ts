import { catalogData } from './data';
import { blockNameOf, propsOf } from './blockState';

interface LegacyEntry {
  id: number;
  meta: number;
  props: Record<string, string>;
}

let index: Map<string, LegacyEntry[]> | null = null;
const resolved = new Map<string, { id: number; meta: number } | null>();

function buildIndex(): Map<string, LegacyEntry[]> {
  const map = new Map<string, LegacyEntry[]>();
  for (const [key, state] of Object.entries(catalogData.legacyBlocks)) {
    const [id, meta] = key.split(':').map(Number) as [number, number];
    const name = blockNameOf(state);
    const list = map.get(name) ?? [];
    list.push({ id, meta, props: propsOf(state) });
    map.set(name, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.id - b.id || a.meta - b.meta);
  return map;
}

/**
 * Map a flattened (1.13-named) block state to the pre-1.13 numeric id + metadata, choosing the
 * legacy entry whose properties match best (legacy entries lack properties the old game computed
 * at render time, like fence connections or stair shapes). Null if the block has no legacy form.
 */
export function toLegacyIdMeta(state: string): { id: number; meta: number } | null {
  const hit = resolved.get(state);
  if (hit !== undefined) return hit;
  index ??= buildIndex();
  const entries = index.get(blockNameOf(state));
  let best: LegacyEntry | null = null;
  let bestScore = -1;
  if (entries) {
    const props = propsOf(state);
    for (const e of entries) {
      let score = 0;
      for (const [k, v] of Object.entries(e.props)) {
        if (props[k] === v) score += 2;
        else if (k in props) score -= 1;
      }
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
  }
  const result = best ? { id: best.id, meta: best.meta } : null;
  resolved.set(state, result);
  return result;
}
