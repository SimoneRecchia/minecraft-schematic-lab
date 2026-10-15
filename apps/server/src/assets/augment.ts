import type { BlockCatalog, PropSpec } from '@minecraft-schematic-lab/catalog';
import type { PackData } from './buildPack';

const FAMILY_SUFFIXES = [
  '_wall_hanging_sign',
  '_hanging_sign',
  '_wall_sign',
  '_sign',
  '_fence_gate',
  '_pressure_plate',
  '_trapdoor',
  '_stairs',
  '_slab',
  '_wall',
  '_fence',
  '_door',
  '_button',
  '_bars',
  '_chain',
  '_lantern',
  '_wall_torch',
  '_torch',
  '_log',
  '_wood',
  '_leaves',
  '_sapling',
  '_pane',
  '_candle',
  '_bulb',
  '_shelf',
];

function propsFromBlockstate(bs: unknown): PropSpec[] {
  const values = new Map<string, string[]>();
  const add = (k: string, v: string) => {
    const list = values.get(k) ?? [];
    for (const part of v.split('|')) if (!list.includes(part)) list.push(part);
    values.set(k, list);
  };
  const walk = (cond: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(cond)) {
      if (k === 'OR' || k === 'AND') (v as Record<string, unknown>[]).forEach(walk);
      else add(k, String(v));
    }
  };
  const b = bs as {
    variants?: Record<string, unknown>;
    multipart?: { when?: Record<string, unknown> }[];
  };
  for (const key of Object.keys(b.variants ?? {})) {
    if (!key || key === 'normal') continue;
    for (const pair of key.split(',')) {
      const [k, v] = pair.split('=');
      if (k && v !== undefined) add(k, v);
    }
  }
  for (const part of b.multipart ?? []) if (part.when) walk(part.when);
  return [...values.entries()].sort((a, c) => a[0].localeCompare(c[0])).map(([k, v]) => [k, v, 0]);
}

/**
 * For releases newer than the bundled block data: register blocks found in the game's
 * blockstates, reusing a known block's properties when the family is obvious (…_stairs, …_slab).
 * Returns the names added.
 */
export function augmentCatalog(catalog: BlockCatalog, pack: PackData): string[] {
  const added: string[] = [];
  const known = catalog.names();
  for (const [name, bs] of Object.entries(pack.blockstates)) {
    if (catalog.has(name)) continue;
    const suffix = FAMILY_SUFFIXES.find((s) => name.endsWith(s));
    const sibling = suffix
      ? known.find(
          (n) =>
            n.endsWith(suffix) &&
            !FAMILY_SUFFIXES.some((s) => s !== suffix && s.endsWith(suffix) && n.endsWith(s)),
        )
      : undefined;
    const props = (sibling && catalog.propSpec(sibling)) || propsFromBlockstate(bs);
    if (catalog.augment(name, props)) added.push(name);
  }
  return added;
}
