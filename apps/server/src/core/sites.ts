import type { CompileResult, CompileSite } from '@minecraft-schematic-lab/block-compiler';
import { blockNameOf, terrainClass } from '@minecraft-schematic-lab/catalog';
import type { WorldChange } from '@minecraft-schematic-lab/formats';
import type { Vec3 } from '@minecraft-schematic-lab/shared';
import { columnHeights } from '@minecraft-schematic-lab/world';
import type { StoredSite } from './SiteStore';

/** Spec position of the site's first cell: world = spec + origin. */
export function specMin(site: StoredSite): Vec3 {
  return [
    site.worldMin[0] - site.origin[0],
    site.worldMin[1] - site.origin[1],
    site.worldMin[2] - site.origin[2],
  ];
}

export function toCompileSite(site: StoredSite): CompileSite {
  return {
    version: site.version,
    min: specMin(site),
    size: site.size,
    palette: site.palette,
    data: site.data,
    blockEntities: site.blockEntities,
  };
}

const NATURAL =
  /^(stone|granite|diorite|andesite|deepslate|tuff|calcite|dripstone_block|pointed_dripstone|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|grass_block|mud|clay|gravel|sand|red_sand|sandstone|red_sandstone|terracotta|.+_terracotta|snow|snow_block|powder_snow|ice|packed_ice|blue_ice|water|lava|bedrock|obsidian|magma_block|netherrack|soul_sand|soul_soil|basalt|blackstone|end_stone|moss_block|moss_carpet|.+_ore|raw_.+_block|amethyst_block|budding_amethyst|.+amethyst_bud|amethyst_cluster|.+_log|.+_wood|.+_leaves|.+_stem|.+_hyphae|.+_mushroom_block|mushroom_stem|vine|.+_vines|.+_vines_plant|cave_vines.*|glow_lichen|short_grass|grass|tall_grass|fern|large_fern|dead_bush|bush|firefly_bush|.+_dry_grass|.+_sapling|.+_tulip|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|torchflower|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers|leaf_litter|sugar_cane|kelp|kelp_plant|seagrass|tall_seagrass|lily_pad|cactus|pumpkin|melon|sweet_berry_bush|bamboo|cocoa|brown_mushroom|red_mushroom|bee_nest|mangrove_roots|muddy_mangrove_roots|hanging_roots|spore_blossom|azalea|flowering_azalea|big_dripleaf.*|small_dripleaf|sculk.*|cobweb|bubble_column|crimson_.+|warped_.+|nether_.+|.+coral.*|sea_pickle|infested_.+|suspicious_.+|packed_mud|cave_air|void_air|air)$/;

interface Grid {
  sx: number;
  sz: number;
  ground: Int16Array;
  water: Int16Array;
  tree: Uint8Array;
}

/** A readable picture of the terrain for planning: heights, water, trees, flat spots, builds. */
export function terrainReport(
  site: StoredSite,
  view: { palette: readonly string[]; data: Uint16Array },
  opts: { step?: number; from?: Vec3; to?: Vec3 } = {},
): string {
  const [sx, sy, sz] = site.size;
  const min = specMin(site);
  const h = columnHeights(view.palette, view.data, site.size);
  const classes = view.palette.map((s) => terrainClass(blockNameOf(s)));
  const tree = new Uint8Array(sx * sz);
  const tops = new Map<string, number>();
  const unnatural = new Map<string, number>();
  let ux0 = Infinity;
  let ux1 = -Infinity;
  let uz0 = Infinity;
  let uz1 = -Infinity;
  let trees = 0;
  const treeKinds = new Set<string>();
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const col = x + sx * z;
      const g = h.ground[col] as number;
      const t = h.top[col] as number;
      if (t > g) {
        for (let y = g + 1; y <= t; y++)
          if (classes[view.data[x + sx * (z + sz * y)] as number] === 'tree') {
            tree[col] = 1;
            break;
          }
      }
      if (g >= 0) {
        const name = blockNameOf(
          view.palette[view.data[x + sx * (z + sz * g)] as number] as string,
        );
        const above =
          g + 1 < sy
            ? (view.palette[view.data[x + sx * (z + sz * (g + 1))] as number] as string)
            : '';
        const key = (h.water[col] as number) > g ? 'water' : name;
        tops.set(key, (tops.get(key) ?? 0) + 1);
        const aboveName = above ? blockNameOf(above) : '';
        if (/_(log|stem)$/.test(aboveName)) {
          trees++;
          treeKinds.add(aboveName);
        }
      }
    }
  for (let i = 0; i < view.data.length; i++) {
    const id = view.data[i] as number;
    if (id === 0) continue;
    const name = blockNameOf(view.palette[id] as string);
    if (NATURAL.test(name)) continue;
    unnatural.set(name, (unnatural.get(name) ?? 0) + 1);
    const x = i % sx;
    const z = Math.floor(i / sx) % sz;
    ux0 = Math.min(ux0, x);
    ux1 = Math.max(ux1, x);
    uz0 = Math.min(uz0, z);
    uz1 = Math.max(uz1, z);
  }

  const groundSpec = (col: number) => (h.ground[col] as number) + min[1];
  const grounds: number[] = [];
  let waterCols = 0;
  for (let col = 0; col < sx * sz; col++) {
    if ((h.ground[col] as number) >= 0) grounds.push(groundSpec(col));
    if ((h.water[col] as number) > (h.ground[col] as number)) waterCols++;
  }
  const sorted = [...grounds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const centerCol = -min[0] + sx * -min[2];
  const columns = sx * sz;
  const pct = (n: number) => `${Math.round((n / columns) * 100)}%`;
  const lines: string[] = [];
  const src =
    site.source.kind === 'world'
      ? `world "${site.source.worldName}" (${site.source.dimension})`
      : `schematic ${site.source.filename}`;
  lines.push(
    `Site ${site.info.id} "${site.info.name}" · ${src} · Minecraft ${site.version}${site.writable ? '' : ' · read-only (exports only)'}`,
  );
  lines.push(
    `Coordinates: BuildSpec (0,0,0) = world (${site.origin.join(', ')}); world = spec + (${site.origin.join(', ')}). y = 0 is the block above the ground at the centre.`,
  );
  lines.push(
    `Area (spec): x ${min[0]}..${min[0] + sx - 1}, y ${min[1]}..${min[1] + sy - 1}, z ${min[2]}..${min[2] + sz - 1} (${sx}×${sy}×${sz}). Blocks outside it can't be built.`,
  );
  if (sorted.length)
    lines.push(
      `Ground (spec y of the top ground block): lowest ${sorted[0]}, highest ${sorted[sorted.length - 1]}, median ${median}; at the centre ${(h.ground[centerCol] as number) >= 0 ? groundSpec(centerCol) : 'none'}.`,
    );
  const topList = [...tops.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([n, c]) => `${n} ${pct(c)}`)
    .join(', ');
  lines.push(
    `Surface: ${topList || '—'}${waterCols ? ` · water over ${pct(waterCols)} of the area` : ''}.`,
  );
  lines.push(
    `Trees: ${trees}${treeKinds.size ? ` (${[...treeKinds].slice(0, 5).join(', ')})` : ''}.`,
  );
  if (unnatural.size) {
    const list = [...unnatural.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([n, c]) => `${n} ×${c}`)
      .join(', ');
    lines.push(
      `Not natural (existing builds, paths, villages?): ${list} — within x ${ux0 + min[0]}..${ux1 + min[0]}, z ${uz0 + min[2]}..${uz1 + min[2]}.`,
    );
  }

  const grid: Grid = { sx, sz, ground: h.ground, water: h.water, tree };
  const spots = flatSpots(grid);
  if (spots.length)
    lines.push(
      `Flattest open spots (height varies ≤1, no water or trees): ${spots
        .map(
          (s) => `${s.w}×${s.w} centred at (${s.x + min[0]}, ${s.y + min[1] + 1}, ${s.z + min[2]})`,
        )
        .join('; ')}.`,
    );

  // Height map.
  let x0 = 0;
  let x1 = sx - 1;
  let z0 = 0;
  let z1 = sz - 1;
  if (opts.from && opts.to) {
    x0 = Math.max(0, Math.min(opts.from[0], opts.to[0]) - min[0]);
    x1 = Math.min(sx - 1, Math.max(opts.from[0], opts.to[0]) - min[0]);
    z0 = Math.max(0, Math.min(opts.from[2], opts.to[2]) - min[2]);
    z1 = Math.min(sz - 1, Math.max(opts.from[2], opts.to[2]) - min[2]);
  }
  const span = Math.max(x1 - x0 + 1, z1 - z0 + 1);
  const step = Math.max(1, opts.step ?? Math.ceil(span / 24));
  const header = ['       x'];
  for (let x = x0; x <= x1; x += step) header.push(String(x + min[0]).padStart(5));
  lines.push('');
  lines.push(
    `Height map: spec y of the ground every ${step} block(s); rows z north→south, columns x west→east; ~ water above, T tree.`,
  );
  lines.push(header.join(''));
  for (let z = z0; z <= z1; z += step) {
    let row = `z${String(z + min[2]).padStart(5)}  `;
    for (let x = x0; x <= x1; x += step) {
      const col = x + sx * z;
      const g = h.ground[col] as number;
      const mark = (h.water[col] as number) > g ? '~' : tree[col] ? 'T' : ' ';
      row += (g >= 0 ? `${g + min[1]}${mark}` : `?${mark}`).padStart(5);
    }
    lines.push(row);
  }
  if (site.warnings.length) lines.push('', `Notes: ${site.warnings.join(' ')}`);
  return lines.join('\n');
}

/** Square windows where the ground varies at most one block, largest first, not overlapping. */
function flatSpots(g: Grid): { x: number; y: number; z: number; w: number }[] {
  const out: { x: number; y: number; z: number; w: number }[] = [];
  const overlaps = (x: number, z: number, w: number) =>
    out.some((o) => Math.abs(o.x - x) * 2 < o.w + w && Math.abs(o.z - z) * 2 < o.w + w);
  for (const w of [31, 21, 15, 9]) {
    if (w > g.sx || w > g.sz) continue;
    const half = Math.floor(w / 2);
    const stride = Math.max(1, Math.floor(w / 4));
    let best: { x: number; z: number; y: number; score: number } | null = null;
    for (let cz = half; cz < g.sz - half; cz += stride)
      for (let cx = half; cx < g.sx - half; cx += stride) {
        if (overlaps(cx, cz, w)) continue;
        let lo = Infinity;
        let hi = -Infinity;
        let ok = true;
        for (let z = cz - half; z <= cz + half && ok; z++)
          for (let x = cx - half; x <= cx + half; x++) {
            const col = x + g.sx * z;
            const y = g.ground[col] as number;
            if (y < 0 || (g.water[col] as number) > y || g.tree[col]) {
              ok = false;
              break;
            }
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
        if (!ok || hi - lo > 1) continue;
        const d = Math.hypot(cx - g.sx / 2, cz - g.sz / 2);
        if (!best || d < best.score) best = { x: cx, z: cz, y: hi, score: d };
      }
    if (best) out.push({ x: best.x, y: best.y, z: best.z, w });
    if (out.length >= 3) break;
  }
  return out;
}

/** The changed cells as world blocks, with what was there before (for undo). */
export function siteChanges(result: CompileResult, site: StoredSite): WorldChange[] {
  const v = result.volume;
  const changed = result.site?.changed;
  if (!changed) return [];
  const beAfter = new Map(v.blockEntities.map((be) => [v.index(...be.pos), be.data]));
  const beBefore = new Map(
    site.blockEntities.map((be) => [
      be.pos[0] + site.size[0] * (be.pos[2] + site.size[2] * be.pos[1]),
      be.data,
    ]),
  );
  const out: WorldChange[] = [];
  let i = 0;
  for (let y = 0; y < v.sizeY; y++)
    for (let z = 0; z < v.sizeZ; z++)
      for (let x = 0; x < v.sizeX; x++, i++) {
        if (!changed[i]) continue;
        const after = beAfter.get(i);
        const before = beBefore.get(i);
        out.push({
          pos: [site.worldMin[0] + x, site.worldMin[1] + y, site.worldMin[2] + z],
          state: v.palette[v.data[i] as number] as string,
          ...(after ? { nbt: after } : {}),
          before: site.palette[site.data[i] as number] as string,
          ...(before ? { beforeNbt: before } : {}),
        });
      }
  return out;
}

/** Local bounds of the changed cells, or null when nothing changed. */
export function changedBounds(result: CompileResult): { lo: Vec3; hi: Vec3 } | null {
  const v = result.volume;
  const changed = result.site?.changed;
  if (!changed) return null;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  let i = 0;
  for (let y = 0; y < v.sizeY; y++)
    for (let z = 0; z < v.sizeZ; z++)
      for (let x = 0; x < v.sizeX; x++, i++) {
        if (!changed[i]) continue;
        if (x < lo[0]) lo[0] = x;
        if (y < lo[1]) lo[1] = y;
        if (z < lo[2]) lo[2] = z;
        if (x > hi[0]) hi[0] = x;
        if (y > hi[1]) hi[1] = y;
        if (z > hi[2]) hi[2] = z;
      }
  return lo[0] === Infinity ? null : { lo, hi };
}
