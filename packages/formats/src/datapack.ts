import { blockNameOf, terrainClass, type VersionInfo } from '@minecraft-schematic-lab/catalog';
import { jsonToSnbt } from './snbt';
import { writeZip } from './zip';

/** One block the build changes in the world. */
export interface WorldChange {
  /** World position. */
  pos: [number, number, number];
  state: string;
  nbt?: Record<string, unknown>;
  /** What was there before (for undo). */
  before: string;
  beforeNbt?: Record<string, unknown>;
}

export interface DatapackInput {
  name: string;
  version: VersionInfo;
  /**
   * world: positions are world coordinates in `dimension` (a build on a site; undo restores what
   * was there). here: positions are offsets from where the player stands when running …/build
   * (any build, like //paste; undo removes it).
   */
  place: { kind: 'world'; dimension: string; center: [number, number, number] } | { kind: 'here' };
  changes: readonly WorldChange[];
  /** Function id under vibeschem: ("castle_v3"); derived from the name when absent. */
  id?: string;
}

export interface DatapackOutput {
  /** Files of the pack, by path inside it. */
  files: Map<string, Buffer>;
  zip: Buffer;
  /** Folder name for <world>/datapacks/. */
  folder: string;
  /** "vibeschem:castle_v3" — run …/build, …/undo, …/tp. */
  functionId: string;
  commands: number;
  ticks: number;
  warnings: string[];
}

/** Data pack format per release (DataVersion, major, minor), from Mojang's version manifests. */
const PACK_FORMATS: [number, number, number][] = [
  [1519, 4, 0],
  [2225, 5, 0],
  [2578, 6, 0],
  [2724, 7, 0],
  [2860, 8, 0],
  [2975, 9, 0],
  [3105, 10, 0],
  [3337, 12, 0],
  [3463, 15, 0],
  [3578, 18, 0],
  [3698, 26, 0],
  [3837, 41, 0],
  [3953, 48, 0],
  [4080, 57, 0],
  [4189, 61, 0],
  [4325, 71, 0],
  [4435, 80, 0],
  [4438, 81, 0],
  [4554, 88, 0],
  [4671, 94, 1],
  [4786, 101, 1],
  [4903, 107, 1],
  [5023, 121, 0],
];

export function packFormatFor(dataVersion: number): { major: number; minor: number } {
  let best = PACK_FORMATS[0] as [number, number, number];
  for (const row of PACK_FORMATS) if (row[0] <= dataVersion) best = row;
  return { major: best[1], minor: best[2] };
}

export function datapacksAvailable(version: VersionInfo): boolean {
  return !version.legacy && (version.dataVersion ?? 0) >= 1519;
}

const MAX_FILL = 32768;
/** Blocks changed per game tick, so a big build doesn't freeze the game. */
const BLOCKS_PER_TICK = 65536;
const COMMANDS_PER_TICK = 2000;

type Pass = 'remove' | 'solid' | 'detail' | 'liquid';

function passOf(state: string): Pass {
  const c = terrainClass(blockNameOf(state));
  if (c === 'air') return 'remove';
  if (c === 'liquid') return 'liquid';
  if (c === 'detail') return 'detail';
  return 'solid';
}

interface Cell {
  x: number;
  y: number;
  z: number;
  state: string;
  nbt?: Record<string, unknown>;
}

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  state: string;
  nbt?: Record<string, unknown>;
}

/** Greedy cuboids of equal state (cells with NBT stay single), at most 32768 blocks each. */
function boxes(cells: Cell[]): Box[] {
  if (!cells.length) return [];
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const c of cells) {
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    z0 = Math.min(z0, c.z);
    x1 = Math.max(x1, c.x);
    z1 = Math.max(z1, c.z);
  }
  const sx = x1 - x0 + 3;
  const sz = z1 - z0 + 3;
  const key = (x: number, y: number, z: number) =>
    x - x0 + 1 + sx * (z - z0 + 1 + sz * (y - y0 + 1));
  const map = new Map<number, Cell>();
  for (const c of cells) map.set(key(c.x, c.y, c.z), c);
  const done = new Set<number>();
  const sorted = [...cells].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  const same = (x: number, y: number, z: number, state: string) => {
    const k = key(x, y, z);
    const c = map.get(k);
    return !!c && !c.nbt && c.state === state && !done.has(k);
  };
  const out: Box[] = [];
  for (const c of sorted) {
    const k = key(c.x, c.y, c.z);
    if (done.has(k)) continue;
    if (c.nbt) {
      done.add(k);
      out.push({
        x0: c.x,
        y0: c.y,
        z0: c.z,
        x1: c.x,
        y1: c.y,
        z1: c.z,
        state: c.state,
        nbt: c.nbt,
      });
      continue;
    }
    let bx = c.x;
    while (bx - c.x + 1 < MAX_FILL && same(bx + 1, c.y, c.z, c.state)) bx++;
    const w = bx - c.x + 1;
    let bz = c.z;
    rows: while ((bz - c.z + 2) * w <= MAX_FILL) {
      for (let x = c.x; x <= bx; x++) if (!same(x, c.y, bz + 1, c.state)) break rows;
      bz++;
    }
    const area = w * (bz - c.z + 1);
    let by = c.y;
    layers: while ((by - c.y + 2) * area <= MAX_FILL) {
      for (let z = c.z; z <= bz; z++)
        for (let x = c.x; x <= bx; x++) if (!same(x, by + 1, z, c.state)) break layers;
      by++;
    }
    for (let y = c.y; y <= by; y++)
      for (let z = c.z; z <= bz; z++) for (let x = c.x; x <= bx; x++) done.add(key(x, y, z));
    out.push({ x0: c.x, y0: c.y, z0: c.z, x1: bx, y1: by, z1: bz, state: c.state });
  }
  return out;
}

type Coord = (v: number) => string;
const absolute: Coord = (v) => String(v);
const relative: Coord = (v) => (v === 0 ? '~' : `~${v}`);

function command(b: Box, c: Coord): string {
  const state = b.nbt ? `${b.state}${jsonToSnbt(b.nbt)}` : b.state;
  if (b.x0 === b.x1 && b.y0 === b.y1 && b.z0 === b.z1)
    return `setblock ${c(b.x0)} ${c(b.y0)} ${c(b.z0)} ${state}`;
  return `fill ${c(b.x0)} ${c(b.y0)} ${c(b.z0)} ${c(b.x1)} ${c(b.y1)} ${c(b.z1)} ${state}`;
}

/**
 * Commands that turn the "from" blocks into the "to" blocks, in an order the game is happy
 * with: remove from the top down (nothing falls), then solid blocks from the bottom up, then
 * blocks that hang on others (torches, doors, plants…), then water and lava.
 */
function orderedCommands(cells: Cell[], coord: Coord): { cmd: string; blocks: number }[] {
  const byPass: Record<Pass, Cell[]> = { remove: [], solid: [], detail: [], liquid: [] };
  for (const c of cells) byPass[passOf(c.state)].push(c);
  const out: { cmd: string; blocks: number }[] = [];
  const emit = (list: Box[]) => {
    for (const b of list)
      out.push({
        cmd: command(b, coord),
        blocks: (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) * (b.z1 - b.z0 + 1),
      });
  };
  emit(boxes(byPass.remove).sort((a, b) => b.y1 - a.y1));
  emit(boxes(byPass.solid).sort((a, b) => a.y0 - b.y0));
  emit(boxes(byPass.detail).sort((a, b) => a.y0 - b.y0));
  emit(boxes(byPass.liquid).sort((a, b) => a.y0 - b.y0));
  return out;
}

function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'build'
  );
}

/** Chunk rectangles of at most 16×16 chunks (forceload's limit is 256 per command). */
function forceloadRects(
  changes: readonly WorldChange[],
  relativeToPlayer: boolean,
): [number, number, number, number][] {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const c of changes) {
    x0 = Math.min(x0, c.pos[0]);
    x1 = Math.max(x1, c.pos[0]);
    z0 = Math.min(z0, c.pos[2]);
    z1 = Math.max(z1, c.pos[2]);
  }
  const out: [number, number, number, number][] = [];
  if (relativeToPlayer) {
    // Offsets don't line up with chunks: 240 blocks touch at most 16 chunks.
    for (let x = x0; x <= x1; x += 240)
      for (let z = z0; z <= z1; z += 240)
        out.push([x, z, Math.min(x + 239, x1), Math.min(z + 239, z1)]);
    return out;
  }
  for (let cx = x0 >> 4; cx <= x1 >> 4; cx += 16)
    for (let cz = z0 >> 4; cz <= z1 >> 4; cz += 16)
      out.push([
        cx * 16,
        cz * 16,
        Math.min(cx + 15, x1 >> 4) * 16 + 15,
        Math.min(cz + 15, z1 >> 4) * 16 + 15,
      ]);
  return out;
}

/** Any build as a data pack placed where the player stands (offsets from its anchor). */
export function datapackChangesFromVolume(
  volume: {
    sizeX: number;
    sizeY: number;
    sizeZ: number;
    palette: readonly string[];
    data: Uint16Array;
    blockEntities: readonly { pos: [number, number, number]; data: Record<string, unknown> }[];
  },
  anchor: [number, number, number],
): WorldChange[] {
  const nbt = new Map(
    volume.blockEntities.map((be) => [`${be.pos[0]},${be.pos[1]},${be.pos[2]}`, be.data]),
  );
  const out: WorldChange[] = [];
  let i = 0;
  for (let y = 0; y < volume.sizeY; y++)
    for (let z = 0; z < volume.sizeZ; z++)
      for (let x = 0; x < volume.sizeX; x++, i++) {
        const id = volume.data[i] as number;
        if (id === 0) continue;
        const data = nbt.get(`${x},${y},${z}`);
        out.push({
          pos: [x - anchor[0], y - anchor[1], z - anchor[2]],
          state: volume.palette[id] as string,
          ...(data ? { nbt: data } : {}),
          before: 'minecraft:air',
        });
      }
  return out;
}

/**
 * A vanilla data pack that builds (and undoes) the changes with /fill and /setblock, spread over
 * game ticks. Install it in the world's datapacks folder, /reload, then /function <id>/build.
 */
export function writeDatapack(input: DatapackInput): DatapackOutput {
  const { version } = input;
  if (!datapacksAvailable(version))
    throw new Error('Data packs need Minecraft 1.13 or newer; use a .schematic with WorldEdit.');
  const dv = version.dataVersion ?? 0;
  const pack = packFormatFor(dv);
  const singular = dv >= 3953; // 1.21 renamed data pack folders (functions -> function)
  // /forceload and /schedule arrived in 1.14; 1.13 runs every part in the same tick.
  const forceload = dv >= 1952;
  const next = (fn: string, ticks: number) =>
    forceload ? `schedule function ${fn} ${ticks}t` : `function ${fn}`;
  const id = (input.id ? slug(input.id) : slug(input.name)) || 'build';
  const ns = 'vibeschem';
  const fnDir = `data/${ns}/${singular ? 'function' : 'functions'}/${id}`;
  const fnId = `${ns}:${id}`;
  const here = input.place.kind === 'here';
  const tag = `vibeschem_${id}`;
  // A marker entity remembers where the player stood: scheduled functions run at world spawn.
  const markerType = dv >= 2724 ? 'minecraft:marker' : 'minecraft:armor_stand';
  const marker = `@e[type=${markerType},tag=${tag},limit=1]`;
  const prefix =
    input.place.kind === 'here'
      ? `execute at ${marker} run `
      : input.place.dimension === 'minecraft:overworld'
        ? ''
        : `execute in ${input.place.dimension} run `;
  const coord = here ? relative : absolute;
  const warnings: string[] = [];
  const files = new Map<string, Buffer>();
  const put = (path: string, lines: string[]) =>
    files.set(path, Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
  const say = (text: string, color = 'gold') =>
    `tellraw @a ${JSON.stringify({ text: `[VibeSchem] ${text}`, color })}`;
  const rects = forceloadRects(input.changes, input.place.kind === 'here');
  let totalCommands = 0;
  let totalTicks = 0;

  const program = (kind: 'build' | 'undo') => {
    const cells: Cell[] = input.changes.map((c) =>
      kind === 'build'
        ? {
            x: c.pos[0],
            y: c.pos[1],
            z: c.pos[2],
            state: c.state,
            ...(c.nbt ? { nbt: c.nbt } : {}),
          }
        : {
            x: c.pos[0],
            y: c.pos[1],
            z: c.pos[2],
            state: c.before,
            ...(c.beforeNbt ? { nbt: c.beforeNbt } : {}),
          },
    );
    const cmds = orderedCommands(cells, coord);
    // Split into one function per tick.
    const parts: string[][] = [];
    let cur: string[] = [];
    let blocks = 0;
    for (const c of cmds) {
      if (cur.length && (blocks + c.blocks > BLOCKS_PER_TICK || cur.length >= COMMANDS_PER_TICK)) {
        parts.push(cur);
        cur = [];
        blocks = 0;
      }
      cur.push(prefix + c.cmd);
      blocks += c.blocks;
    }
    if (cur.length) parts.push(cur);
    const label = kind === 'build' ? input.name : `${input.name} (undo)`;
    const start = [
      `# ${kind === 'build' ? 'Builds' : 'Undoes'} "${input.name}" — made with VibeSchem`,
    ];
    if (here && kind === 'build') {
      start.push(
        `kill @e[type=${markerType},tag=${tag}]`,
        `execute align xyz positioned ~0.5 ~ ~0.5 run summon ${markerType} ~ ~ ~ ${
          markerType === 'minecraft:marker'
            ? `{Tags:["${tag}"]}`
            : `{Tags:["${tag}"],Marker:1b,Invisible:1b,NoGravity:1b,Invulnerable:1b}`
        }`,
      );
    }
    if (here && kind === 'undo')
      start.push(
        `execute unless entity ${marker} run ${say('Nothing to undo: build it first with /function ' + fnId + '/build.', 'red')}`,
      );
    start.push(
      say(`${kind === 'build' ? 'Building' : 'Undoing'} ${label}: ${input.changes.length} blocks…`),
    );
    if (forceload)
      for (const [ax, az, bx, bz] of rects)
        start.push(`${prefix}forceload add ${coord(ax)} ${coord(az)} ${coord(bx)} ${coord(bz)}`);
    start.push(next(`${fnId}/${kind}_1`, 5));
    put(`${fnDir}/${kind}.mcfunction`, start);
    parts.forEach((lines, i) => {
      const n = i + 1;
      const body = [...lines];
      if (n < parts.length) {
        if (parts.length > 4 && n % Math.max(1, Math.floor(parts.length / 10)) === 0)
          body.push(
            `title @a actionbar ${JSON.stringify({ text: `VibeSchem ${Math.round((n / parts.length) * 100)}%`, color: 'gold' })}`,
          );
        body.push(next(`${fnId}/${kind}_${n + 1}`, 1));
      } else {
        if (forceload)
          for (const [ax, az, bx, bz] of rects)
            body.push(
              `${prefix}forceload remove ${coord(ax)} ${coord(az)} ${coord(bx)} ${coord(bz)}`,
            );
        body.push(say(kind === 'build' ? `Done: ${label}.` : `Undone: ${input.name}.`, 'green'));
        if (here && kind === 'undo') body.push(`kill @e[type=${markerType},tag=${tag}]`);
      }
      put(`${fnDir}/${kind}_${n}.mcfunction`, body);
    });
    if (!parts.length) put(`${fnDir}/${kind}_1.mcfunction`, [say('Nothing to change.', 'gray')]);
    totalCommands += cmds.length;
    totalTicks = Math.max(totalTicks, parts.length);
  };
  program('build');
  program('undo');
  if (input.place.kind === 'world') {
    const [cx, cy, cz] = input.place.center;
    put(`${fnDir}/tp.mcfunction`, [`${prefix}tp @s ${cx} ${cy} ${cz}`]);
  }

  const description = `VibeSchem: ${input.name} — /function ${fnId}/build (undo: /function ${fnId}/undo)`;
  const meta: Record<string, unknown> = { description };
  if (pack.major >= 82) {
    meta.min_format = [pack.major, pack.minor];
    meta.max_format = [pack.major, pack.minor];
  } else {
    meta.pack_format = pack.major;
  }
  files.set('pack.mcmeta', Buffer.from(`${JSON.stringify({ pack: meta }, null, 2)}\n`, 'utf8'));
  files.set(
    'README.txt',
    Buffer.from(
      [
        `"${input.name}" as a vanilla data pack (no mods needed), made with VibeSchem.`,
        '',
        `1. Put this folder (or the .zip) in your world's "datapacks" folder.`,
        `2. In the world (cheats on, or Open to LAN > Allow Cheats) type: /reload`,
        here
          ? `3. Stand where it should go (that spot is the paste point) and type: /function ${fnId}/build`
          : `3. Stand near the build area and type: /function ${fnId}/build`,
        here
          ? `   Remove it again: /function ${fnId}/undo`
          : `   Undo it any time (puts back what was there): /function ${fnId}/undo`,
        ...(here ? [] : [`   Go there: /function ${fnId}/tp`]),
        '',
        `${input.changes.length} blocks, ${totalCommands} commands over ${totalTicks} ticks.`,
        'Back up your world first if it matters to you.',
        '',
      ].join('\n'),
      'utf8',
    ),
  );
  if (!forceload) {
    warnings.push(
      'Minecraft 1.13 has no /forceload: stand in the middle of the area so every chunk is loaded.',
    );
    if (totalCommands > 60000)
      warnings.push(
        'Over 60000 commands in one tick: raise the maxCommandChainLength game rule first.',
      );
  } else if (rects.length > 8)
    warnings.push('The area spans many chunks: the pack force-loads them while it builds.');
  return {
    files,
    zip: writeZip(files),
    folder: `vibeschem_${id}`,
    functionId: fnId,
    commands: totalCommands,
    ticks: totalTicks,
    warnings,
  };
}
