import { catalogData } from './data';

/**
 * What a block is to the landscape: `ground` is what you stand and build on (terrain, and any
 * other full block), `tree` is trunks, leaves and giant mushrooms, `liquid` water, lava and lake
 * ice, `detail` every other non-full block (plants, snow layers, torches, fences…).
 */
export type TerrainClass = 'air' | 'liquid' | 'tree' | 'detail' | 'ground';

const FULL = new Set(catalogData.fullCubes);
const AIR = new Set(['air', 'cave_air', 'void_air', 'structure_void', 'light']);
const LIQUID = new Set(['water', 'lava', 'bubble_column', 'ice', 'frosted_ice']);
const TREE =
  /(_log|_wood|_stem|_hyphae|_leaves|^mushroom_stem|_mushroom_block|^mangrove_roots|^bee_nest)$/;
/** Natural blocks a little lower than a full cube that still count as the ground. */
const LOW_GROUND = new Set([
  'dirt_path',
  'grass_path',
  'farmland',
  'soul_sand',
  'mud',
  'powder_snow',
  'honey_block',
]);

export function terrainClass(name: string): TerrainClass {
  if (AIR.has(name)) return 'air';
  if (LIQUID.has(name)) return 'liquid';
  if (TREE.test(name)) return 'tree';
  if (FULL.has(name) || LOW_GROUND.has(name)) return 'ground';
  return 'detail';
}

/** Plants the game lets you place a block into (grass, flowers, snow layers…). */
const REPLACEABLE =
  /^(short_grass|grass|tall_grass|fern|large_fern|dead_bush|bush|firefly_bush|short_dry_grass|tall_dry_grass|snow|vine|glow_lichen|seagrass|tall_seagrass|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|torchflower|.*_tulip|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers|leaf_litter|moss_carpet|.*_sapling|brown_mushroom|red_mushroom|sweet_berry_bush|nether_sprouts|crimson_roots|warped_roots|hanging_roots)$/;

export function isReplaceablePlant(name: string): boolean {
  return REPLACEABLE.test(name);
}
