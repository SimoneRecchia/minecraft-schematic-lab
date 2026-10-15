import type { BlockVolume } from '@minecraft-schematic-lab/block-compiler';
import { blockNameOf, propsOf } from '@minecraft-schematic-lab/catalog';

export interface MaterialItem {
  /** Item id, e.g. "oak_planks". */
  item: string;
  count: number;
  stackSize: number;
  stacks: number;
  remainder: number;
  /** Shulker boxes (27 stacks) needed. */
  shulkers: number;
}

const NOT_ITEMS =
  /^(air|cave_air|void_air|piston_head|moving_piston|fire|soul_fire|nether_portal|end_portal|end_gateway|bubble_column|frosted_ice)$/;

/** The inventory item a placed block state costs, and how many (doors count once, double slabs twice…). */
function itemFor(state: string): [string, number] | null {
  const name = blockNameOf(state);
  if (NOT_ITEMS.test(name)) return null;
  const p = propsOf(state);
  if (p.half === 'upper' && !name.endsWith('_stairs') && !name.endsWith('_trapdoor')) return null;
  if (p.part === 'head') return null;
  if (name === 'water')
    return p.level === '0' || p.level === undefined ? ['water_bucket', 1] : null;
  if (name === 'lava') return p.level === '0' || p.level === undefined ? ['lava_bucket', 1] : null;
  if (name === 'redstone_wire') return ['redstone', 1];
  if (name === 'tripwire') return ['string', 1];
  if (name.startsWith('potted_')) return [name.slice(7), 1];
  let item = name
    .replace(/_wall_hanging_sign$/, '_hanging_sign')
    .replace(/_wall_(sign|banner|torch|head|skull|fan)$/, '_$1')
    .replace(/^wall_torch$/, 'torch');
  if (item === 'tall_seagrass') item = 'seagrass';
  let count = 1;
  if (p.type === 'double' && name.endsWith('_slab')) count = 2;
  if (p.candles) count = Number(p.candles);
  if (p.pickles) count = Number(p.pickles);
  if (p.eggs) count = Number(p.eggs);
  if (name === 'snow' && p.layers) count = Number(p.layers);
  return [item, count];
}

function stackSizeOf(item: string): number {
  if (/(_bed|^cake)$/.test(item) || item.endsWith('_bucket')) return 1;
  if (/(_sign|_hanging_sign|_banner)$/.test(item) || item === 'egg' || item === 'snowball')
    return 16;
  return 64;
}

/** Everything a survival player has to gather, most-used first. */
export function materialList(volume: BlockVolume): MaterialItem[] {
  const totals = new Map<string, number>();
  for (const [state, n] of volume.counts()) {
    const it = itemFor(state);
    if (!it) continue;
    totals.set(it[0], (totals.get(it[0]) ?? 0) + it[1] * n);
  }
  return [...totals.entries()]
    .map(([item, count]) => {
      const stackSize = stackSizeOf(item);
      return {
        item,
        count,
        stackSize,
        stacks: Math.floor(count / stackSize),
        remainder: count % stackSize,
        shulkers: Math.ceil(count / (stackSize * 27)),
      };
    })
    .sort((a, b) => b.count - a.count);
}

export function materialListCsv(
  items: MaterialItem[],
  displayName: (item: string) => string,
): string {
  const lines = ['Item,Id,Count,Stacks,Remainder,Shulker boxes'];
  for (const m of items) {
    lines.push(
      `"${displayName(m.item)}",minecraft:${m.item},${m.count},${m.stacks},${m.remainder},${m.shulkers}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
