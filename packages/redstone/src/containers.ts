/** Comparator readings of containers and of blocks whose state carries a fill level. */

const STACK_16 =
  /^(ender_pearl|snowball|egg|blue_egg|brown_egg|bucket|armor_stand|honey_bottle|written_book|.*_sign|.*_hanging_sign|.*_banner)$/;
const STACK_1 =
  /^(.*_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots|horse_armor|boat|chest_boat|bed|shulker_box|bundle)|.*_bucket|potion|splash_potion|lingering_potion|bow|crossbow|trident|mace|shield|elytra|totem_of_undying|saddle|minecart|.*_minecart|music_disc_.*|enchanted_book|cake|carrot_on_a_stick|warped_fungus_on_a_stick|fishing_rod|flint_and_steel|shears|brush|spyglass|goat_horn|knowledge_book|debug_stick|writable_book|suspicious_stew|mushroom_stew|rabbit_stew|beetroot_soup|wolf_armor|shulker_box)$/;

export function maxStackSize(itemId: string): number {
  const id = itemId.replace(/^minecraft:/, '');
  if (STACK_1.test(id)) return 1;
  if (STACK_16.test(id)) return 16;
  return 64;
}

const SLOTS: [RegExp, number][] = [
  [/^(chest|trapped_chest|barrel|.*shulker_box)$/, 27],
  [/^hopper$/, 5],
  [/^(dispenser|dropper|crafter)$/, 9],
  [/^(furnace|blast_furnace|smoker)$/, 3],
  [/^brewing_stand$/, 5],
  [/^decorated_pot$/, 1],
];

/** Inventory size, or 0 when the block isn't a container. */
export function containerSlots(name: string): number {
  for (const [re, n] of SLOTS) if (re.test(name)) return n;
  return 0;
}

export interface ItemStack {
  id: string;
  count: number;
}

/** Items of a block entity's NBT ({Items:[{Slot, id, Count|count}]}). */
export function itemsOf(data: Record<string, unknown> | undefined): ItemStack[] {
  const items = data?.Items;
  if (!Array.isArray(items)) return [];
  const out: ItemStack[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const raw = r.count ?? r.Count ?? 1;
    const count = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (id && Number.isFinite(count) && count > 0) out.push({ id, count });
  }
  return out;
}

/**
 * AbstractContainerMenu.getRedstoneSignalFromContainer: each stack counts count/maxStack, the
 * sum is divided by the slot count, then floor(f × 14) + 1 when anything is inside. Java float
 * maths, so the thresholds land exactly where the game puts them.
 */
export function containerSignal(items: readonly ItemStack[], slots: number): number {
  if (slots <= 0 || items.length === 0) return 0;
  let f = 0;
  for (const it of items) {
    const max = Math.min(64, maxStackSize(it.id));
    f = Math.fround(f + Math.fround(Math.min(it.count, max) / max));
  }
  f = Math.fround(f / slots);
  if (f <= 0) return 0;
  return Math.floor(Math.fround(f * 14)) + 1;
}

/** Readings that come from the block state alone (cake, cauldrons, composter…). */
export function stateSignal(name: string, props: Readonly<Record<string, string>>): number | null {
  switch (name) {
    case 'cake':
      return (7 - Number(props.bites ?? 0)) * 2;
    case 'candle_cake':
      return 14;
    case 'water_cauldron':
    case 'powder_snow_cauldron':
      return Number(props.level ?? 0);
    case 'lava_cauldron':
      return 3;
    case 'cauldron':
      return props.level !== undefined ? Number(props.level) : 0;
    case 'composter':
      return Number(props.level ?? 0);
    case 'end_portal_frame':
      return props.eye === 'true' ? 15 : 0;
    case 'respawn_anchor':
      return Math.floor((Number(props.charges ?? 0) / 4) * 15);
    case 'beehive':
    case 'bee_nest':
      return Number(props.honey_level ?? 0);
    case 'jukebox':
      return props.has_record === 'true' ? 1 : 0;
    case 'lectern':
      return props.has_book === 'true' ? 1 : 0;
    case 'chiseled_bookshelf': {
      let n = 0;
      for (let i = 0; i < 6; i++) if (props[`slot_${i}_occupied`] === 'true') n = i + 1;
      return n;
    }
  }
  if (name.endsWith('copper_bulb')) return props.lit === 'true' ? 15 : 0;
  return null;
}

/** Blocks a comparator reads (Block#hasAnalogOutputSignal). */
export function hasAnalogOutput(name: string): boolean {
  return containerSlots(name) > 0 || stateSignal(name, {}) !== null;
}
