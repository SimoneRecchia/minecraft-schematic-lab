/**
 * Collision shapes, reduced to what falling blocks and fluids ask of them: the top of the shape
 * over the middle of the cell (where a falling block's 0.98-wide box lands), which faces it
 * covers completely (fluids pass where neither block covers the shared face), and whether the
 * game counts it as solid (BlockStateBase.isSolid: the bounds average at least 0.73 of a block,
 * or a full block high).
 */
import { clockwise, counterClockwise, dirOf, DOWN, OPPOSITE, UP } from './dirs';

export interface Shape {
  /** Height of the collision box top over the cell (0: no collision; fences reach 1.5). */
  top: number;
  /** Bit d set: the face toward direction d is fully covered. 63 = a full cube. */
  faces: number;
  solid: boolean;
}

const ALL_FACES = 63;
const bit = (d: number) => 1 << d;
const NONE: Shape = { top: 0, faces: 0, solid: false };
const FULL: Shape = { top: 1, faces: ALL_FACES, solid: true };

const NO_COLLISION =
  /^(air|cave_air|void_air|water|lava|bubble_column|fire|soul_fire|redstone_wire|torch|wall_torch|soul_torch|soul_wall_torch|copper_torch|copper_wall_torch|redstone_torch|redstone_wall_torch|lever|rail|powered_rail|detector_rail|activator_rail|tripwire|tripwire_hook|light|structure_void|nether_portal|end_portal|end_gateway|cobweb|sugar_cane|kelp|kelp_plant|seagrass|tall_seagrass|vine|glow_lichen|sculk_vein|resin_clump|short_grass|grass|tall_grass|fern|large_fern|dead_bush|bush|firefly_bush|short_dry_grass|tall_dry_grass|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|sunflower|lilac|rose_bush|peony|pitcher_plant|open_eyeblossom|closed_eyeblossom|pink_petals|wildflowers|leaf_litter|cactus_flower|brown_mushroom|red_mushroom|crimson_fungus|warped_fungus|crimson_roots|warped_roots|nether_sprouts|hanging_roots|spore_blossom|small_dripleaf|big_dripleaf_stem|cave_vines|cave_vines_plant|weeping_vines|weeping_vines_plant|twisting_vines|twisting_vines_plant|sweet_berry_bush|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|attached_melon_stem|attached_pumpkin_stem|nether_wart|torchflower_crop|pitcher_crop|frogspawn|pale_hanging_moss|mangrove_propagule|bamboo_sapling|moving_piston)$|(_button|_pressure_plate|_sign|_wall_sign|_hanging_sign|_wall_hanging_sign|_banner|_wall_banner|_sapling|_tulip|_coral|_coral_fan|_coral_wall_fan)$/;

/**
 * No collision, yet solid to the game (forceSolidOn; solid materials before 1.20): liquids don't
 * wash them away.
 */
const FORCE_SOLID = /(_pressure_plate|_sign|_banner)$|^moving_piston$/;

/** Blocks whose shape covers the whole cell footprint (the "wide" ones count as solid lower). */
function wide(top: number, faces = bit(DOWN)): Shape {
  return { top, faces, solid: top >= 0.1875 };
}

function narrow(top: number): Shape {
  return { top, faces: 0, solid: top >= 1 };
}

/** Closed door panel on the side opposite its facing; open, beside the hinge. */
function doorFace(props: Readonly<Record<string, string>>): number {
  const f = dirOf(props.facing);
  if (f < 0) return 0;
  if (props.open !== 'true') return bit(OPPOSITE[f] as number);
  return bit(props.hinge === 'right' ? clockwise(f) : counterClockwise(f));
}

export function shapeOf(
  name: string,
  props: Readonly<Record<string, string>>,
  fullCube: boolean,
): Shape {
  if (name === 'snow') {
    const layers = Number(props.layers ?? 1);
    return layers <= 1 ? NONE : wide(((layers - 1) * 2) / 16);
  }
  if (FORCE_SOLID.test(name)) return { top: 0, faces: 0, solid: true };
  if (NO_COLLISION.test(name)) return NONE;
  if (name.endsWith('_slab')) {
    if (props.type === 'double') return FULL;
    return props.type === 'top' ? wide(1, bit(UP)) : wide(0.5);
  }
  if (name.endsWith('_stairs')) {
    const f = dirOf(props.facing);
    const back = f >= 0 ? bit(f) : 0;
    return wide(1, (props.half === 'top' ? bit(UP) : bit(DOWN)) | back);
  }
  if (name.endsWith('_trapdoor')) {
    if (props.open === 'true') {
      const f = dirOf(props.facing);
      return { top: 1, faces: f >= 0 ? bit(OPPOSITE[f] as number) : 0, solid: true };
    }
    return props.half === 'top' ? wide(1, bit(UP)) : wide(3 / 16);
  }
  if (name.endsWith('_door')) return { top: 1, faces: doorFace(props), solid: true };
  if (name.endsWith('_fence_gate')) return props.open === 'true' ? NONE : narrow(1.5);
  if (/_fence$|_wall$/.test(name)) return narrow(1.5);
  if (/_carpet$/.test(name)) return wide(1 / 16);
  if (name === 'piston' || name === 'sticky_piston') {
    if (props.extended !== 'true') return FULL;
    const f = dirOf(props.facing);
    return { top: f === UP ? 0.75 : 1, faces: ALL_FACES & ~bit(f), solid: true };
  }
  if (name === 'piston_head') {
    const f = dirOf(props.facing);
    return { top: 1, faces: f >= 0 ? bit(f) : 0, solid: true };
  }
  if (name === 'ladder') {
    const f = dirOf(props.facing);
    return { top: 1, faces: f >= 0 ? bit(OPPOSITE[f] as number) : 0, solid: true };
  }
  if (fullCube) return FULL;
  switch (name) {
    case 'repeater':
    case 'comparator':
      return wide(2 / 16);
    case 'daylight_detector':
      return wide(6 / 16);
    case 'soul_sand':
    case 'mud':
      return wide(14 / 16);
    case 'farmland':
    case 'dirt_path':
    case 'grass_path':
      return wide(15 / 16);
    case 'honey_block':
    case 'cactus':
      return { top: 15 / 16, faces: 0, solid: true };
    case 'chest':
    case 'trapped_chest':
    case 'ender_chest':
      return { top: 14 / 16, faces: 0, solid: true };
    case 'lectern':
      return wide(15 / 16);
    case 'enchanting_table':
      return wide(12 / 16);
    case 'end_portal_frame':
      return wide(13 / 16);
    case 'stonecutter':
      return wide(9 / 16);
    case 'campfire':
    case 'soul_campfire':
      return wide(7 / 16);
    case 'cake':
    case 'candle_cake':
      return { top: 0.5, faces: 0, solid: true };
    case 'lily_pad':
      return wide(1.5 / 16);
    case 'flower_pot':
      return narrow(6 / 16);
    case 'heavy_core':
      return narrow(0.5);
    case 'conduit':
      return narrow(11 / 16);
    case 'lantern':
    case 'soul_lantern':
    case 'copper_lantern':
      return narrow(props.hanging === 'true' ? 10 / 16 : 9 / 16);
    case 'sea_pickle':
    case 'turtle_egg':
      return narrow(7 / 16);
    case 'scaffolding':
      // A falling block is above it, so it gets the stable shape with its top plate.
      return { top: 1, faces: bit(UP), solid: true };
    case 'pointed_dripstone':
      return narrow(props.thickness === 'tip' && props.vertical_direction === 'up' ? 11 / 16 : 1);
    case 'end_rod':
    case 'lightning_rod':
      return narrow(props.facing === 'up' || props.facing === 'down' ? 1 : 10 / 16);
    case 'chain':
    case 'iron_chain':
      return narrow(props.axis === 'y' || props.axis === undefined ? 1 : 9.5 / 16);
  }
  if (/^potted_/.test(name)) return narrow(6 / 16);
  if (/(^|_)candle$/.test(name)) return narrow(6 / 16);
  if (/_wall_(head|skull)$/.test(name)) return narrow(0.75);
  if (/_(head|skull)$/.test(name)) return narrow(0.5);
  if (/_bed$/.test(name)) return { top: 9 / 16, faces: 0, solid: true };
  if (/copper_lantern$/.test(name)) return narrow(9 / 16);
  if (/_amethyst_bud$|^amethyst_cluster$/.test(name)) return narrow(7 / 16);
  if (/_chain$/.test(name)) return narrow(props.axis === 'y' ? 1 : 9.5 / 16);
  if (/_lightning_rod$/.test(name))
    return narrow(props.facing === 'up' || props.facing === 'down' ? 1 : 10 / 16);
  // Everything else with collision (anvils, cauldrons, hoppers, fences' kin, panes…): a block
  // that a falling block lands on top of, no full faces.
  return { top: 1, faces: 0, solid: true };
}

/** BlockState.canBeReplaced() (the `replaceable` property, Material.isReplaceable before 1.20). */
const REPLACEABLE =
  /^(air|cave_air|void_air|water|lava|bubble_column|fire|soul_fire|light|structure_void|short_grass|grass|tall_grass|fern|large_fern|dead_bush|bush|short_dry_grass|tall_dry_grass|vine|glow_lichen|sculk_vein|resin_clump|seagrass|tall_seagrass|crimson_roots|warped_roots|nether_sprouts|hanging_roots|snow|leaf_litter)$/;

export function isReplaceable(name: string): boolean {
  return REPLACEABLE.test(name);
}

/** Java fluid types (Fluids.*): a source and its flowing form are different types. */
export const FL = { EMPTY: 0, WATER: 1, FLOWING_WATER: 2, LAVA: 3, FLOWING_LAVA: 4 } as const;

export interface FluidInfo {
  /** One of FL. */
  type: number;
  /** 1–8 (8 for sources and falling fluid), 0 when empty. */
  amount: number;
  falling: boolean;
}

const EMPTY_FLUID: FluidInfo = { type: FL.EMPTY, amount: 0, falling: false };
const WATER_SOURCE: FluidInfo = { type: FL.WATER, amount: 8, falling: false };

/** Blocks that always hold water (kelp, seagrass, bubble columns). */
const ALWAYS_WATER = /^(kelp|kelp_plant|seagrass|tall_seagrass|bubble_column)$/;

/** BlockState.getFluidState: liquids by `level`, waterlogged blocks and underwater plants. */
export function fluidOf(name: string, props: Readonly<Record<string, string>>): FluidInfo {
  if (name === 'water' || name === 'lava') {
    const level = Number(props.level ?? 0);
    const water = name === 'water';
    if (level === 0) return water ? WATER_SOURCE : { type: FL.LAVA, amount: 8, falling: false };
    const type = water ? FL.FLOWING_WATER : FL.FLOWING_LAVA;
    return level >= 8
      ? { type, amount: 8, falling: true }
      : { type, amount: 8 - level, falling: false };
  }
  if (props.waterlogged === 'true' || ALWAYS_WATER.test(name)) return WATER_SOURCE;
  return EMPTY_FLUID;
}

export function isWaterType(type: number): boolean {
  return type === FL.WATER || type === FL.FLOWING_WATER;
}

export function isLavaType(type: number): boolean {
  return type === FL.LAVA || type === FL.FLOWING_LAVA;
}

/** FlowingFluid.getLegacyLevel: the `level` of the liquid block for a fluid state. */
export function legacyLevel(f: FluidInfo): number {
  if (f.type === FL.WATER || f.type === FL.LAVA) return 0;
  return 8 - Math.min(f.amount, 8) + (f.falling ? 8 : 0);
}

/** What a falling block does: kinds of FallingBlock in the game. */
export const FALL = { NONE: 0, BLOCK: 1, CONCRETE_POWDER: 2, BRUSHABLE: 3 } as const;

export function fallingOf(name: string): number {
  if (/^(sand|red_sand|gravel|anvil|chipped_anvil|damaged_anvil|dragon_egg)$/.test(name))
    return FALL.BLOCK;
  if (name.endsWith('_concrete_powder')) return FALL.CONCRETE_POWDER;
  if (name === 'suspicious_sand' || name === 'suspicious_gravel') return FALL.BRUSHABLE;
  return FALL.NONE;
}

/** FlowingFluid.canHoldFluid exclusions: these never give way to a fluid. */
export const HOLDS_NO_FLUID =
  /(_door|_sign|_wall_sign|_hanging_sign|_wall_hanging_sign)$|^(ladder|sugar_cane|bubble_column|nether_portal|end_portal|end_gateway|structure_void|kelp|kelp_plant|seagrass|tall_seagrass)$/;
