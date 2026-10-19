/** What a block does in the simulation; every other block is plain (SOLID) or AIR. */
export const K = {
  AIR: 0,
  SOLID: 1,
  WIRE: 2,
  TORCH: 3,
  WALL_TORCH: 4,
  REPEATER: 5,
  COMPARATOR: 6,
  LEVER: 7,
  BUTTON: 8,
  PLATE: 9,
  WEIGHTED_PLATE: 10,
  REDSTONE_BLOCK: 11,
  LAMP: 12,
  PISTON: 13,
  PISTON_HEAD: 14,
  MOVING_PISTON: 15,
  OBSERVER: 16,
  TARGET: 17,
  NOTE_BLOCK: 18,
  DOOR: 19,
  TRAPDOOR: 20,
  FENCE_GATE: 21,
  DISPENSER: 22,
  HOPPER: 23,
  COPPER_BULB: 24,
  TNT: 25,
  POWERED_RAIL: 26,
  RAIL: 27,
  DAYLIGHT: 28,
  TRIPWIRE_HOOK: 29,
  LECTERN: 30,
  TRAPPED_CHEST: 31,
  SCULK_SENSOR: 32,
  LIGHTNING_ROD: 33,
  CRAFTER: 34,
  BELL: 35,
} as const;
export type Kind = (typeof K)[keyof typeof K];

export function kindOf(name: string): Kind {
  switch (name) {
    case 'air':
    case 'cave_air':
    case 'void_air':
      return K.AIR;
    case 'redstone_wire':
      return K.WIRE;
    case 'redstone_torch':
      return K.TORCH;
    case 'redstone_wall_torch':
      return K.WALL_TORCH;
    case 'repeater':
      return K.REPEATER;
    case 'comparator':
      return K.COMPARATOR;
    case 'lever':
      return K.LEVER;
    case 'light_weighted_pressure_plate':
    case 'heavy_weighted_pressure_plate':
      return K.WEIGHTED_PLATE;
    case 'redstone_block':
      return K.REDSTONE_BLOCK;
    case 'redstone_lamp':
      return K.LAMP;
    case 'piston':
    case 'sticky_piston':
      return K.PISTON;
    case 'piston_head':
      return K.PISTON_HEAD;
    case 'moving_piston':
      return K.MOVING_PISTON;
    case 'observer':
      return K.OBSERVER;
    case 'target':
      return K.TARGET;
    case 'note_block':
      return K.NOTE_BLOCK;
    case 'dispenser':
    case 'dropper':
      return K.DISPENSER;
    case 'hopper':
      return K.HOPPER;
    case 'tnt':
      return K.TNT;
    case 'powered_rail':
    case 'activator_rail':
      return K.POWERED_RAIL;
    case 'rail':
    case 'detector_rail':
      return K.RAIL;
    case 'daylight_detector':
      return K.DAYLIGHT;
    case 'tripwire_hook':
      return K.TRIPWIRE_HOOK;
    case 'lectern':
      return K.LECTERN;
    case 'trapped_chest':
      return K.TRAPPED_CHEST;
    case 'sculk_sensor':
    case 'calibrated_sculk_sensor':
      return K.SCULK_SENSOR;
    case 'crafter':
      return K.CRAFTER;
    case 'bell':
      return K.BELL;
  }
  if (name.endsWith('_button')) return K.BUTTON;
  if (name.endsWith('_pressure_plate')) return K.PLATE;
  if (name.endsWith('_trapdoor')) return K.TRAPDOOR;
  if (name.endsWith('_door')) return K.DOOR;
  if (name.endsWith('_fence_gate')) return K.FENCE_GATE;
  if (name.endsWith('copper_bulb')) return K.COPPER_BULB;
  if (name.endsWith('lightning_rod')) return K.LIGHTNING_ROD;
  return K.SOLID;
}

/** Blocks that give off a signal (dust connects to them; comparators accept them on the side). */
export function isSignalSourceKind(kind: Kind, name: string): boolean {
  switch (kind) {
    case K.WIRE:
    case K.TORCH:
    case K.WALL_TORCH:
    case K.REPEATER:
    case K.COMPARATOR:
    case K.LEVER:
    case K.BUTTON:
    case K.PLATE:
    case K.WEIGHTED_PLATE:
    case K.REDSTONE_BLOCK:
    case K.OBSERVER:
    case K.TARGET:
    case K.DAYLIGHT:
    case K.TRIPWIRE_HOOK:
    case K.LECTERN:
    case K.TRAPPED_CHEST:
    case K.SCULK_SENSOR:
    case K.LIGHTNING_ROD:
      return true;
    case K.RAIL:
      return name === 'detector_rail';
    default:
      return false;
  }
}

/**
 * Full blocks that do not conduct redstone (power doesn't pass through them), although their
 * collision box is a full cube.
 */
const NOT_CONDUCTIVE =
  /(^|_)glass$|_leaves$|^ice$|^frosted_ice$|^glowstone$|^sea_lantern$|^beacon$|^redstone_block$|^observer$|^tnt$|^moving_piston$|^(sticky_)?piston$|^structure_void$|^light$|copper_bulb$|copper_grate$/;
/** Full cubes whose faces support nothing (their support shape is empty). */
const NO_SUPPORT = /_leaves$/;
/** Not full cubes, yet conductive. */
const CONDUCTIVE_ANYWAY = /^soul_sand$|^mud$/;

/** Top faces that hold dust, repeaters and comparators. */
const STURDY_TOP_ANYWAY = /^(sticky_)?piston$|^soul_sand$|^mud$|^dirt_path$|^farmland$|^observer$/;

/** Center of the top face holds a standing torch (fences, walls). */
const CENTER_TOP = /_fence$|_wall$|^iron_bars$|_pane$|^chain$|^iron_chain$|_chain$|^lantern$/;

export interface BlockTraits {
  name: string;
  kind: Kind;
  /** Redstone conductor (Block#isRedstoneConductor): a powered one powers what's around it. */
  conductor: boolean;
  /** Full sturdy top face: supports dust, repeaters, comparators, rails, plates. */
  sturdyTop: boolean;
  /** Sturdy side faces: wall torches, levers and buttons attach to it. */
  sturdySide: boolean;
  /** Supports a standing torch. */
  centerTop: boolean;
  signalSource: boolean;
}

export type FullCubeTest = (name: string) => boolean;

/** Traits of a block name; slabs and stairs depend on their state, see stateTraits. */
export function blockTraits(name: string, isFullCube: FullCubeTest): BlockTraits {
  const kind = kindOf(name);
  const full = kind !== K.AIR && isFullCube(name);
  const conductor =
    kind !== K.AIR &&
    kind !== K.PISTON &&
    kind !== K.REDSTONE_BLOCK &&
    kind !== K.OBSERVER &&
    ((full && !NOT_CONDUCTIVE.test(name)) || CONDUCTIVE_ANYWAY.test(name));
  const support = !NO_SUPPORT.test(name);
  const sturdyTop = support && (full || STURDY_TOP_ANYWAY.test(name));
  return {
    name,
    kind,
    conductor,
    sturdyTop,
    sturdySide: support && (full || kind === K.PISTON || kind === K.OBSERVER),
    centerTop: sturdyTop || CENTER_TOP.test(name),
    signalSource: isSignalSourceKind(kind, name),
  };
}

/** State-dependent overrides: double slabs are full; top slabs and upside-down stairs hold dust. */
export function stateTraits(
  base: BlockTraits,
  props: Readonly<Record<string, string>>,
): BlockTraits {
  const n = base.name;
  if (n.endsWith('_slab')) {
    if (props.type === 'double')
      return { ...base, conductor: true, sturdyTop: true, sturdySide: true, centerTop: true };
    if (props.type === 'top') return { ...base, sturdyTop: true, centerTop: true };
  } else if (n.endsWith('_stairs') && props.half === 'top') {
    return { ...base, sturdyTop: true, centerTop: true };
  } else if (base.kind === K.PISTON && props.extended === 'true') {
    return { ...base, sturdyTop: false, sturdySide: false, centerTop: false };
  } else if (n === 'snow' && props.layers === '8') {
    return { ...base, sturdyTop: true, centerTop: true };
  }
  return base;
}

/**
 * How a block reacts to being pushed: normal, destroy (pops off), block (immovable), push-only
 * (glazed terracotta: pushed, never pulled, doesn't stick to slime).
 */
export const PUSH = { NORMAL: 0, DESTROY: 1, BLOCK: 2, PUSH_ONLY: 3 } as const;
export type PushReaction = (typeof PUSH)[keyof typeof PUSH];

const IMMOVABLE =
  /^(obsidian|crying_obsidian|respawn_anchor|reinforced_deepslate|bedrock|barrier|end_portal_frame|end_portal|end_gateway|nether_portal|command_block|chain_command_block|repeating_command_block|structure_block|jigsaw|light|grindstone|piston_head|moving_piston|enchanting_table|ender_chest|lodestone|anvil|chipped_anvil|damaged_anvil|beacon|conduit|spawner|trial_spawner|vault|test_block|test_instance_block)$/;
/** Blocks with a block entity can't move (chests, furnaces, hoppers…), except those that pop. */
const BLOCK_ENTITY =
  /(^|_)(chest|furnace|smoker|hopper|dispenser|dropper|barrel|brewing_stand|jukebox|lectern|beehive|bee_nest|campfire|sign|hanging_sign|banner|bed|head|skull|daylight_detector|comparator|enchanting_table|beacon|conduit|bell|crafter|chiseled_bookshelf|decorated_pot|sculk_sensor|sculk_catalyst|sculk_shrieker|calibrated_sculk_sensor|creaking_heart|trial_spawner|vault|spawner|shelf|copper_golem_statue)$/;
const DESTROY_ON_PUSH =
  /^(redstone_wire|redstone_torch|redstone_wall_torch|torch|wall_torch|soul_torch|soul_wall_torch|copper_torch|copper_wall_torch|repeater|comparator|lever|tripwire|tripwire_hook|cobweb|cake|candle_cake|dragon_egg|flower_pot|ladder|vine|snow|lily_pad|scaffolding|pumpkin|carved_pumpkin|jack_o_lantern|melon|cocoa|sugar_cane|cactus|bamboo|bamboo_sapling|chorus_plant|chorus_flower|sea_pickle|turtle_egg|sniffer_egg|frogspawn|pointed_dripstone|big_dripleaf|big_dripleaf_stem|small_dripleaf|spore_blossom|glow_lichen|sculk_vein|resin_clump|lantern|soul_lantern|end_rod|fire|soul_fire|water|lava|bubble_column|light|moss_carpet|pale_moss_carpet|pale_hanging_moss|hanging_roots|leaf_litter|wildflowers|bush|firefly_bush|short_dry_grass|tall_dry_grass|cactus_flower|pink_petals|azalea|flowering_azalea|heavy_core|decorated_pot|pitcher_crop|pitcher_plant|torchflower|torchflower_crop|sweet_berry_bush|nether_wart|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|attached_melon_stem|attached_pumpkin_stem|kelp|kelp_plant|seagrass|tall_seagrass|cave_vines|cave_vines_plant|weeping_vines|weeping_vines_plant|twisting_vines|twisting_vines_plant|structure_void)$/;
const DESTROY_SUFFIX =
  /(_button|_pressure_plate|_door|_bed|_banner|_wall_banner|_carpet|_sapling|_flower|_tulip|_orchid|_mushroom|_fungus|_roots|_sprouts|_coral|_coral_fan|_coral_wall_fan|_head|_wall_head|_skull|_wall_skull|_candle|candle|_shulker_box|shulker_box|_sign|_wall_sign|_hanging_sign|_wall_hanging_sign|_pane_dummy|_grass|_fern|_bush|_propagule|_lantern|_amethyst_bud|amethyst_cluster)$/;
const FLOWERS =
  /^(dandelion|poppy|blue_orchid|allium|azure_bluet|cornflower|lily_of_the_valley|wither_rose|oxeye_daisy|sunflower|lilac|rose_bush|peony|open_eyeblossom|closed_eyeblossom|fern|large_fern|dead_bush|short_grass|grass|tall_grass|crimson_roots|warped_roots|nether_sprouts|brown_mushroom|red_mushroom|crimson_fungus|warped_fungus|mangrove_propagule)$/;

export function pushReactionOf(name: string): PushReaction {
  if (/_glazed_terracotta$/.test(name)) return PUSH.PUSH_ONLY;
  if (IMMOVABLE.test(name)) return PUSH.BLOCK;
  if (DESTROY_ON_PUSH.test(name) || DESTROY_SUFFIX.test(name) || FLOWERS.test(name))
    return PUSH.DESTROY;
  return PUSH.NORMAL;
}

/** Blocks a piston can't move because they carry a block entity (destroy-on-push ones still pop). */
export function hasBlockEntity(name: string): boolean {
  return BLOCK_ENTITY.test(name);
}

/** Buttons stay pressed 20 game ticks (stone) or 30 (wood and the rest). */
export function buttonTicks(name: string): number {
  return name === 'stone_button' || name === 'polished_blackstone_button' ? 20 : 30;
}

/** Weighted pressure plates: entity count that gives full power. */
export function plateMaxWeight(name: string): number {
  return name === 'heavy_weighted_pressure_plate' ? 150 : 15;
}
