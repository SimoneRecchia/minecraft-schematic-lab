/** Test helpers: tiny synthetic worlds written with the same NBT layout the game uses. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  byte,
  compound,
  double,
  int,
  list,
  long,
  str,
  writeNbt,
  type Tag,
} from '@minecraft-schematic-lab/formats';
import { packIndices, stateBits } from './chunk';
import { RegionFile } from './region';

type BlockFn = (x: number, y: number, z: number) => string;

function stateTag(state: string): Tag {
  const br = state.indexOf('[');
  if (br < 0) return compound({ Name: str(state) });
  const props: Record<string, Tag> = {};
  for (const pair of state.slice(br + 1, -1).split(',')) {
    const [k, v] = pair.split('=') as [string, string];
    props[k] = str(v);
  }
  return compound({ Name: str(state.slice(0, br)), Properties: compound(props) });
}

function section(cx: number, cz: number, sy: number, fn: BlockFn) {
  const palette: string[] = [];
  const blocks = new Uint16Array(4096);
  for (let i = 0; i < 4096; i++) {
    const s = fn(cx * 16 + (i & 15), sy * 16 + (i >> 8), cz * 16 + ((i >> 4) & 15));
    let p = palette.indexOf(s);
    if (p < 0) p = palette.push(s) - 1;
    blocks[i] = p;
  }
  return { palette, blocks };
}

/** A chunk in the 1.18+ layout (`dataVersion` ≥ 2844) or the 1.14–1.17 `Level` layout. */
export function encodeChunk(
  cx: number,
  cz: number,
  dataVersion: number,
  minSection: number,
  maxSection: number,
  fn: BlockFn,
  blockEntities: Tag[] = [],
): Buffer {
  const flat = dataVersion >= 2844;
  const spanning = dataVersion < 2529;
  const sections: Tag[] = [];
  for (let sy = minSection; sy <= maxSection; sy++) {
    const { palette, blocks } = section(cx, cz, sy, fn);
    const paletteTag = list('compound', palette.map(stateTag));
    const words = packIndices(blocks, stateBits(palette.length), flat ? false : spanning);
    if (flat) {
      sections.push(
        compound({
          Y: byte(sy),
          block_states: compound(
            palette.length === 1
              ? { palette: paletteTag }
              : { palette: paletteTag, data: { t: 'longArray', words } },
          ),
          biomes: compound({ palette: list('string', [str('minecraft:plains')]) }),
        }),
      );
    } else {
      sections.push(
        compound({ Y: byte(sy), Palette: paletteTag, BlockStates: { t: 'longArray', words } }),
      );
    }
  }
  const body: Record<string, Tag> = {
    xPos: int(cx),
    zPos: int(cz),
    Status: str(flat ? 'minecraft:full' : 'full'),
    isLightOn: byte(1),
    LastUpdate: long(100),
    Heightmaps: compound({}),
  };
  if (flat) {
    return writeNbt('', {
      DataVersion: int(dataVersion),
      ...body,
      yPos: int(minSection),
      sections: list('compound', sections),
      block_entities: list('compound', blockEntities),
      block_ticks: list('compound', []),
      fluid_ticks: list('compound', []),
    });
  }
  return writeNbt('', {
    DataVersion: int(dataVersion),
    Level: compound({
      ...body,
      Sections: list('compound', sections),
      TileEntities: list('compound', blockEntities),
    }),
  });
}

export interface TestWorldOptions {
  name: string;
  dataVersion: number;
  versionName: string;
  /** 26.1+ folder layout: dimensions/minecraft/overworld/region, players/data. */
  modern?: boolean;
  chunks: [number, number][];
  minSection: number;
  maxSection: number;
  fn: BlockFn;
  player?: [number, number, number];
}

export function makeWorld(savesDir: string, o: TestWorldOptions): string {
  const dir = join(savesDir, o.name);
  const regionDir = o.modern
    ? join(dir, 'dimensions', 'minecraft', 'overworld', 'region')
    : join(dir, 'region');
  mkdirSync(regionDir, { recursive: true });
  const player = compound({
    Pos: list(
      'double',
      (o.player ?? [0, 64, 0]).map((v) => double(v + 0.5)),
    ),
    Dimension: str('minecraft:overworld'),
  });
  const data: Record<string, Tag> = {
    LevelName: str(o.name),
    DataVersion: int(o.dataVersion),
    Version: compound({ Name: str(o.versionName), Id: int(o.dataVersion) }),
    LastPlayed: long(Date.now()),
    GameType: int(1),
    allowCommands: byte(1),
    SpawnX: int(0),
    SpawnY: int(64),
    SpawnZ: int(0),
  };
  if (o.modern) {
    mkdirSync(join(dir, 'players', 'data'), { recursive: true });
    writeFileSync(
      join(dir, 'players', 'data', '00000000-0000-0000-0000-000000000001.dat'),
      gzipSync(writeNbt('', player.t === 'compound' ? player.v : {})),
    );
  } else {
    data.Player = player;
  }
  writeFileSync(join(dir, 'level.dat'), gzipSync(writeNbt('', { Data: compound(data) })));
  const regions = new Map<string, RegionFile>();
  for (const [cx, cz] of o.chunks) {
    const key = `${cx >> 5},${cz >> 5}`;
    let r = regions.get(key);
    if (!r) regions.set(key, (r = new RegionFile(cx >> 5, cz >> 5)));
    r.write(cx, cz, encodeChunk(cx, cz, o.dataVersion, o.minSection, o.maxSection, o.fn));
  }
  for (const r of regions.values())
    writeFileSync(join(regionDir, `r.${r.rx}.${r.rz}.mca`), r.serialize().region);
  return dir;
}
