import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import {
  getCompound,
  getList,
  getNumber,
  getString,
  readNbt,
  type Compound,
} from '@minecraft-schematic-lab/formats';

export interface SavesFolder {
  path: string;
  /** "Minecraft Launcher", "Prism Launcher: Fabric 1.21", … */
  launcher: string;
}

export interface PlayerPosition {
  pos: [number, number, number];
  dimension: string;
}

export interface WorldSummary {
  /** Stable short id derived from the folder path. */
  id: string;
  path: string;
  folder: string;
  name: string;
  launcher: string;
  version: string | null;
  dataVersion: number | null;
  /** Milliseconds since the epoch. */
  lastPlayed: number | null;
  gameMode: 'survival' | 'creative' | 'adventure' | 'spectator' | null;
  hardcore: boolean;
  cheats: boolean;
  player: PlayerPosition | null;
  spawn: [number, number, number] | null;
  /** Dimensions with region files ("minecraft:overworld", …). */
  dimensions: string[];
  hasIcon: boolean;
}

export const OVERWORLD = 'minecraft:overworld';
const LEGACY_DIMENSIONS: Record<string, string> = {
  'minecraft:overworld': '',
  'minecraft:the_nether': 'DIM-1',
  'minecraft:the_end': 'DIM1',
};
const DIMENSION_IDS: Record<number, string> = {
  0: OVERWORLD,
  [-1]: 'minecraft:the_nether',
  1: 'minecraft:the_end',
};

export function worldId(path: string): string {
  return createHash('sha1').update(resolve(path)).digest('hex').slice(0, 12);
}

function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(path, d.name));
  } catch {
    return [];
  }
}

/** Every saves folder of the launchers we know on this computer, plus MSL_SAVES entries. */
export function findSavesFolders(minecraftDir?: string): SavesFolder[] {
  const home = homedir();
  const appData =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : join(home, 'AppData', 'Roaming'));
  const dataHome = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  const support =
    process.platform === 'darwin' ? join(home, 'Library', 'Application Support') : null;
  const out: SavesFolder[] = [];
  const add = (path: string, launcher: string) => {
    if (existsSync(path) && !out.some((s) => resolve(s.path) === resolve(path)))
      out.push({ path, launcher });
  };
  for (const extra of (process.env.MSL_SAVES ?? '').split(delimiter).filter(Boolean))
    add(extra, 'Custom');
  if (minecraftDir) add(join(minecraftDir, 'saves'), 'Minecraft Launcher');
  add(join(home, '.minecraft', 'saves'), 'Minecraft Launcher');
  add(
    join(home, '.var', 'app', 'com.mojang.Minecraft', '.minecraft', 'saves'),
    'Minecraft Launcher',
  );

  const instanceRoots: [string, string][] = [];
  for (const base of [appData, dataHome, support].filter((p): p is string => !!p)) {
    instanceRoots.push([join(base, 'PrismLauncher', 'instances'), 'Prism Launcher']);
    instanceRoots.push([join(base, 'MultiMC', 'instances'), 'MultiMC']);
    instanceRoots.push([join(base, 'ModrinthApp', 'profiles'), 'Modrinth']);
    instanceRoots.push([join(base, 'com.modrinth.theseus', 'profiles'), 'Modrinth']);
  }
  instanceRoots.push([join(home, 'curseforge', 'minecraft', 'Instances'), 'CurseForge']);
  instanceRoots.push([
    join(home, 'Documents', 'curseforge', 'minecraft', 'Instances'),
    'CurseForge',
  ]);
  for (const [root, launcher] of instanceRoots) {
    for (const inst of dirs(root)) {
      const name = basename(inst);
      for (const sub of ['.minecraft', 'minecraft', ''])
        add(join(inst, sub, 'saves'), `${launcher}: ${name}`);
    }
  }
  return out;
}

function readLevelDat(worldDir: string): Compound | null {
  for (const file of ['level.dat', 'level.dat_old']) {
    try {
      const root = readNbt(readFileSync(join(worldDir, file))).root;
      return getCompound(root, 'Data') ?? null;
    } catch {
      // try the backup
    }
  }
  return null;
}

function dimensionName(c: Compound | undefined, key: string): string {
  const t = c?.[key];
  if (t?.t === 'string') return t.v.includes(':') ? t.v : `minecraft:${t.v}`;
  const n = getNumber(c, key);
  return n === undefined ? OVERWORLD : (DIMENSION_IDS[n] ?? OVERWORLD);
}

function playerOf(c: Compound | undefined): PlayerPosition | null {
  const pos = getList(c, 'Pos').map((t) => (t.t === 'double' || t.t === 'float' ? t.v : 0));
  if (pos.length < 3) return null;
  return {
    pos: [Math.floor(pos[0] as number), Math.floor(pos[1] as number), Math.floor(pos[2] as number)],
    dimension: dimensionName(c, 'Dimension'),
  };
}

/** The singleplayer player: level.dat (≤1.21) or the newest player file (26.1+ players/). */
function findPlayer(worldDir: string, data: Compound): PlayerPosition | null {
  const inLevel = playerOf(getCompound(data, 'Player'));
  if (inLevel) return inLevel;
  let newest: { file: string; mtime: number } | null = null;
  for (const dir of ['players/data', 'players', 'playerdata']) {
    const full = join(worldDir, dir);
    let names: string[];
    try {
      names = readdirSync(full);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.dat')) continue;
      try {
        const mtime = statSync(join(full, n)).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { file: join(full, n), mtime };
      } catch {
        // unreadable entry
      }
    }
  }
  if (!newest) return null;
  try {
    return playerOf(readNbt(readFileSync(newest.file)).root);
  } catch {
    return null;
  }
}

function hasRegions(dir: string): boolean {
  try {
    return readdirSync(dir).some((n) => n.endsWith('.mca') || n.endsWith('.mcr'));
  } catch {
    return false;
  }
}

/** Region folder candidates for a dimension: 26.1+ `dimensions/<ns>/<path>/region`, then legacy. */
export function regionDirs(worldDir: string, dimension: string): string[] {
  const [ns, path] = dimension.includes(':') ? dimension.split(':', 2) : ['minecraft', dimension];
  const out = [join(worldDir, 'dimensions', ns as string, path as string, 'region')];
  const legacy = LEGACY_DIMENSIONS[dimension];
  if (legacy !== undefined) out.push(join(worldDir, legacy, 'region'));
  return out;
}

export function regionDir(worldDir: string, dimension: string): string | null {
  return regionDirs(worldDir, dimension).find(hasRegions) ?? null;
}

export function listDimensions(worldDir: string): string[] {
  const found = new Set<string>();
  for (const dim of Object.keys(LEGACY_DIMENSIONS)) if (regionDir(worldDir, dim)) found.add(dim);
  for (const nsDir of dirs(join(worldDir, 'dimensions')))
    for (const dimDir of dirs(nsDir))
      if (hasRegions(join(dimDir, 'region'))) found.add(`${basename(nsDir)}:${basename(dimDir)}`);
  return [...found];
}

const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'] as const;

/** Read a world folder's level.dat; null when it isn't a world. */
export function readWorld(worldDir: string, launcher = 'Folder'): WorldSummary | null {
  const data = readLevelDat(worldDir);
  if (!data) return null;
  const version = getString(getCompound(data, 'Version'), 'Name') ?? null;
  const spawnPos = getCompound(data, 'spawn')?.pos;
  let spawn: [number, number, number] | null = null;
  if (spawnPos?.t === 'intArray' && spawnPos.v.length >= 3)
    spawn = [spawnPos.v[0] as number, spawnPos.v[1] as number, spawnPos.v[2] as number];
  else {
    const sx = getNumber(data, 'SpawnX');
    const sy = getNumber(data, 'SpawnY');
    const sz = getNumber(data, 'SpawnZ');
    if (sx !== undefined && sy !== undefined && sz !== undefined) spawn = [sx, sy, sz];
  }
  const mode = getNumber(data, 'GameType');
  return {
    id: worldId(worldDir),
    path: resolve(worldDir),
    folder: basename(worldDir),
    name: getString(data, 'LevelName') ?? basename(worldDir),
    launcher,
    version,
    dataVersion: getNumber(data, 'DataVersion') ?? null,
    lastPlayed: getNumber(data, 'LastPlayed') ?? null,
    gameMode: mode !== undefined ? (GAME_MODES[mode] ?? null) : null,
    hardcore: getNumber(data, 'hardcore') === 1,
    cheats: getNumber(data, 'allowCommands') === 1,
    player: findPlayer(worldDir, data),
    spawn,
    dimensions: listDimensions(worldDir),
    hasIcon: existsSync(join(worldDir, 'icon.png')),
  };
}

/** Worlds in every saves folder, most recently played first. */
export function listWorlds(minecraftDir?: string): WorldSummary[] {
  const out: WorldSummary[] = [];
  for (const saves of findSavesFolders(minecraftDir)) {
    for (const dir of dirs(saves.path)) {
      if (!existsSync(join(dir, 'level.dat'))) continue;
      const w = readWorld(dir, saves.launcher);
      if (w) out.push(w);
    }
  }
  return out.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
}
