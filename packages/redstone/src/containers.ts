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
  /** The rest of the item's NBT (components, tag…), kept as written. */
  extra?: Record<string, unknown>;
}

/** A container's slots, empty ones null. */
export type Slots = (ItemStack | null)[];

function slotNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) ? n : null;
}

/** A block entity's NBT {Items:[{Slot, id, Count|count, …}]} as `size` slots. */
export function itemsOf(data: Record<string, unknown> | undefined, size: number): Slots {
  const out: Slots = Array.from({ length: size }, () => null);
  const items = data?.Items;
  if (!Array.isArray(items)) return out;
  let next = 0;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const { Slot, id, count, Count, ...extra } = it as Record<string, unknown>;
    const raw = count ?? Count ?? 1;
    const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (typeof id !== 'string' || !id || !Number.isFinite(n) || n <= 0) continue;
    let slot = slotNumber(Slot);
    if (slot === null) slot = next;
    next = slot + 1;
    if (slot < 0 || slot >= size || out[slot]) continue;
    const stack: ItemStack = { id: id.includes(':') ? id : `minecraft:${id}`, count: n };
    if (Object.keys(extra).length) stack.extra = extra;
    out[slot] = stack;
  }
  return out;
}

/** Slots back as NBT Items, in the style the original data used (count or Count, 0b or 0). */
export function itemsToNbt(slots: Slots, original?: unknown): Record<string, unknown>[] {
  const first = Array.isArray(original)
    ? (original[0] as Record<string, unknown> | undefined)
    : undefined;
  const bigCount = first ? 'Count' in first && !('count' in first) : false;
  const typedSlot = first ? typeof first.Slot === 'string' : true;
  const out: Record<string, unknown>[] = [];
  slots.forEach((s, k) => {
    if (!s) return;
    const n = bigCount ? `${s.count}b` : s.count;
    out.push({
      Slot: typedSlot ? `${k}b` : k,
      id: s.id,
      ...(bigCount ? { Count: n } : { count: n }),
      ...(s.extra ?? {}),
    });
  });
  return out;
}

/** Two stacks merge when they are the same item with the same data. */
export function sameItem(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && JSON.stringify(a.extra ?? {}) === JSON.stringify(b.extra ?? {});
}

/**
 * AbstractContainerMenu.getRedstoneSignalFromContainer: each stack counts count/maxStack, the
 * sum is divided by the slot count, then floor(f × 14) + 1 when anything is inside. Java float
 * maths, so the thresholds land exactly where the game puts them.
 */
export function containerSignal(items: readonly (ItemStack | null)[], slots: number): number {
  if (slots <= 0) return 0;
  let f = 0;
  for (const it of items) {
    if (!it) continue;
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
