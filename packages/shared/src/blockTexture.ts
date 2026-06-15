import { cleanName } from './blockColor';
import { TEXTURE_NAMES } from './textureData';

const NAMES = new Set(TEXTURE_NAMES);

// Irregular block id -> texture base name.
const ALIASES: Record<string, string> = {
  grass_block: 'grass_block_side',
  grass: 'grass_block_top',
  basalt: 'basalt_side',
  polished_basalt: 'polished_basalt_side',
  hay_block: 'hay_block_side',
  bone_block: 'bone_block_side',
  crafting_table: 'crafting_table_front',
};

/**
 * Resolve a block state to an available 16× texture name, or null if none is bundled.
 * Handles direct matches, partial-block suffixes (stairs/slabs/walls/fences reuse the base
 * material texture) and a few irregular names.
 */
export function textureNameFor(state: string): string | null {
  const name = cleanName(state);

  const candidates: string[] = [];
  if (ALIASES[name]) candidates.push(ALIASES[name]);
  candidates.push(name);

  const base = name.replace(/_(stairs|slab|wall|fence_gate|fence)$/, '');
  if (base !== name) {
    if (ALIASES[base]) candidates.push(ALIASES[base]);
    candidates.push(
      base, // e.g. cobblestone_wall -> cobblestone
      `${base}s`, // brick -> bricks
      base.replace(/_brick$/, '_bricks'), // stone_brick_stairs -> stone_bricks
      `${base}_planks`, // oak_stairs -> oak_planks
      `${base}_block`, // quartz_stairs -> quartz_block
    );
  }

  for (const c of candidates) {
    if (NAMES.has(c)) return c;
  }
  return null;
}
