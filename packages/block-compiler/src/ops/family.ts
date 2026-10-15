import type { CompileContext } from '../context';

const REF_RE = /^\s*([^[\]]+?)\s*(?:\[[^\]]*\])?\s*$/;

/** Full-block candidates for a stairs/slab base name, most likely first. */
function fullCandidates(base: string): string[] {
  return [
    base,
    `${base}s`, // stone_brick -> stone_bricks, deepslate_tile -> deepslate_tiles
    `${base}_planks`, // oak -> oak_planks
    `${base}_block`, // quartz -> quartz_block, purpur -> purpur_block
    base.replace(/_brick$/, '_bricks'),
  ];
}

function deriveName(
  ctx: CompileContext,
  name: string,
  kind: 'slab' | 'full' | 'stairs',
): string | undefined {
  const cat = ctx.catalog;
  const base = name.replace(/_(stairs|slab)$/, '');
  if (kind === 'slab') {
    const cands = [`${base}_slab`, `${base.replace(/s$/, '')}_slab`];
    return cands.find((c) => cat.has(c));
  }
  if (kind === 'stairs') {
    const cands = [
      `${base}_stairs`,
      `${base.replace(/s$/, '')}_stairs`,
      `${base.replace(/_planks$/, '')}_stairs`,
    ];
    return cands.find((c) => cat.has(c));
  }
  if (base === name) return cat.has(name) ? name : undefined;
  return fullCandidates(base).find((c) => cat.has(c));
}

/**
 * The slab / full block / stairs of the same material as a reference ("oak_stairs" -> "oak_slab",
 * "oak_planks"). Palette mixes and gradients derive member by member into a synthetic palette
 * entry, so a mixed roof keeps the same texture on its slabs.
 */
export function deriveFamily(
  ctx: CompileContext,
  ref: string,
  kind: 'slab' | 'full' | 'stairs',
  depth = 0,
): string | undefined {
  const m = REF_RE.exec(ref);
  if (!m || depth > 8) return undefined;
  const key = (m[1] as string).trim();
  const entry = ctx.paletteDefs[key];
  if (entry === undefined) {
    const name = key.replace(/^minecraft:/, '').toLowerCase();
    return deriveName(ctx, ctx.catalog.resolveName(name) ?? name, kind);
  }
  if (typeof entry === 'string') return deriveFamily(ctx, entry, kind, depth + 1);
  const synthetic = `${key}~${kind}`;
  if (ctx.paletteDefs[synthetic]) return synthetic;
  if ('mix' in entry) {
    const mix: Record<string, number> = {};
    for (const [r, w] of Object.entries(entry.mix)) {
      const d = deriveFamily(ctx, r, kind, depth + 1);
      if (!d) return undefined;
      mix[d] = (mix[d] ?? 0) + w;
    }
    ctx.paletteDefs[synthetic] = {
      mix,
      ...(entry.scale ? { scale: entry.scale } : {}),
      ...(entry.seed !== undefined ? { seed: entry.seed } : {}),
    };
    return synthetic;
  }
  const blocks: string[] = [];
  for (const r of entry.gradient.blocks) {
    const d = deriveFamily(ctx, r, kind, depth + 1);
    if (!d) return undefined;
    blocks.push(d);
  }
  ctx.paletteDefs[synthetic] = { gradient: { ...entry.gradient, blocks } };
  return synthetic;
}
