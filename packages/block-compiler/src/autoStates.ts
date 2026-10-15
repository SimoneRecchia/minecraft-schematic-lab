import type { BlockCatalog } from '@minecraft-schematic-lab/catalog';
import { stringifyState } from '@minecraft-schematic-lab/catalog';
import type { BlockVolume } from './BlockVolume';
import {
  FLAG_COMPLETE,
  FLAG_CONNECT,
  FLAG_STAIR_SHAPE,
  type InternalPalette,
  type PaletteEntry,
} from './palette';
import type { SparseVolume } from './SparseVolume';
import { DIR_VEC, type Direction } from './transform';

const SIDES: Direction[] = ['north', 'east', 'south', 'west'];
const OPPOSITE: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};
const CW: Record<Direction, Direction> = {
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north',
};
const CCW: Record<Direction, Direction> = {
  north: 'west',
  west: 'south',
  south: 'east',
  east: 'north',
};

/**
 * Add the missing halves of two-block blocks (doors, tall flowers, beds) so a single placement
 * is enough. Runs on the sparse volume, so the partner may extend the bounds.
 */
export function completeMultiBlocks(volume: SparseVolume, palette: InternalPalette): void {
  const todo: [number, number, number, number, number][] = [];
  volume.forEach((x, y, z, id, prov) => {
    if (palette.get(id).flags & FLAG_COMPLETE) todo.push([x, y, z, id, prov]);
  });
  for (const [x, y, z, id, prov] of todo) {
    const e = palette.get(id);
    // A door or bed claims its second cell (placing a door implies the doorway); plants only grow
    // into empty space.
    const claims = e.name.endsWith('_door') || e.name.endsWith('_bed');
    if (e.props.half === 'lower') {
      const above = volume.get(x, y + 1, z);
      if (above !== 0 && (!claims || palette.get(above).name === e.name)) continue;
      volume.set(x, y + 1, z, palette.addRaw(e.name, { ...e.props, half: 'upper' }, 0), prov);
    } else if (e.props.part === 'foot') {
      const v = DIR_VEC[e.props.facing as Direction];
      if (!v) continue;
      const head = volume.get(x + v[0], y, z + v[1]);
      if (head !== 0 && palette.get(head).name === e.name) continue;
      volume.set(
        x + v[0],
        y,
        z + v[1],
        palette.addRaw(e.name, { ...e.props, part: 'head' }, 0),
        prov,
      );
    }
  }
}

const CONNECT_EXCEPTIONS = /leaves$|^barrier$|pumpkin$|^jack_o_lantern$|^melon$|shulker_box$/;
const WALL_POST_OVERRIDE =
  /torch$|lantern$|_sign$|banner$|pressure_plate$|^end_rod$|lightning_rod$|_head$|_skull$|candle$/;

type Kind = 'fence' | 'nether_fence' | 'wall' | 'pane' | 'gate' | 'other';

function kindOf(name: string): Kind {
  if (name.endsWith('_fence_gate')) return 'gate';
  if (name === 'nether_brick_fence') return 'nether_fence';
  if (name.endsWith('_fence')) return 'fence';
  if (name.endsWith('_wall')) return 'wall';
  if (name.endsWith('_pane') || name.endsWith('_bars') || name === 'iron_bars') return 'pane';
  return 'other';
}

/**
 * The block updates the game would do on placement but WorldEdit does not on paste: fence, wall,
 * pane and bar connections, wall posts, stair corner shapes, gates in walls, snowy grass.
 */
export function applyAutoStates(
  vol: BlockVolume,
  entries: readonly PaletteEntry[],
  catalog: BlockCatalog,
): void {
  const { sizeX, sizeY, sizeZ } = vol;
  const original = vol.data.slice();
  const entryAt = (x: number, y: number, z: number): PaletteEntry | null => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) return null;
    const id = original[x + sizeX * (z + sizeZ * y)] as number;
    return id === 0 ? null : (entries[id] ?? null);
  };
  const kinds = entries.map((e) => kindOf(e.name));
  const full = entries.map((e) => catalog.isFullCube(e.name) && !CONNECT_EXCEPTIONS.test(e.name));
  const kindAt = (x: number, y: number, z: number): Kind | null => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) return null;
    const id = original[x + sizeX * (z + sizeZ * y)] as number;
    return id === 0 ? null : (kinds[id] ?? null);
  };
  const fullAt = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) return false;
    return full[original[x + sizeX * (z + sizeZ * y)] as number] ?? false;
  };
  const gateConnects = (gate: PaletteEntry, toward: Direction): boolean => {
    const f = gate.props.facing as Direction | undefined;
    if (!f) return false;
    // A gate facing north spans east-west and connects on its east/west sides.
    return toward === CW[f] || toward === CCW[f];
  };

  const cache = new Map<string, number>();
  const write = (i: number, e: PaletteEntry, props: Record<string, string>): void => {
    const state = stringifyState(e.name, props);
    if (state === e.state) return;
    let id = cache.get(state);
    if (id === undefined) {
      id = vol.idFor(state);
      cache.set(state, id);
    }
    vol.data[i] = id;
  };

  let i = 0;
  for (let y = 0; y < sizeY; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++, i++) {
        const id = original[i] as number;
        if (id === 0) continue;
        const e = entries[id] as PaletteEntry;
        const kind = kinds[id] as Kind;

        if (e.flags & FLAG_CONNECT) {
          const props = { ...e.props };
          const conn: Record<Direction, boolean> = {
            north: false,
            east: false,
            south: false,
            west: false,
          };
          for (const side of SIDES) {
            const [dx, dz] = DIR_VEC[side];
            const nk = kindAt(x + dx, y, z + dz);
            const ne = entryAt(x + dx, y, z + dz);
            let c = false;
            if (nk && ne) {
              if (kind === 'fence' || kind === 'nether_fence') {
                c =
                  nk === kind ||
                  (nk === 'gate' && gateConnects(ne, OPPOSITE[side])) ||
                  fullAt(x + dx, y, z + dz);
              } else if (kind === 'wall') {
                c =
                  nk === 'wall' ||
                  nk === 'pane' ||
                  (nk === 'gate' && gateConnects(ne, OPPOSITE[side])) ||
                  fullAt(x + dx, y, z + dz);
              } else if (kind === 'pane') {
                c = nk === 'pane' || nk === 'wall' || fullAt(x + dx, y, z + dz);
              }
            }
            conn[side] = c;
          }
          if (kind === 'wall') {
            const above = entryAt(x, y + 1, z);
            const aboveFull = fullAt(x, y + 1, z) || kindAt(x, y + 1, z) === 'wall';
            const enumSides = (catalog.propValues(e.name, 'north') ?? []).includes('low');
            for (const side of SIDES) {
              props[side] = enumSides
                ? conn[side]
                  ? aboveFull
                    ? 'tall'
                    : 'low'
                  : 'none'
                : String(conn[side]);
            }
            const straight =
              (conn.north && conn.south && !conn.east && !conn.west) ||
              (conn.east && conn.west && !conn.north && !conn.south);
            const forced = above
              ? WALL_POST_OVERRIDE.test(above.name) ||
                (kindAt(x, y + 1, z) === 'wall' && above.props.up === 'true')
              : false;
            if ('up' in props) props.up = String(!straight || forced);
          } else {
            for (const side of SIDES) props[side] = String(conn[side]);
          }
          write(i, e, props);
          continue;
        }

        if (kind === 'gate' && 'in_wall' in e.props) {
          const f = e.props.facing as Direction;
          const [ax, az] = DIR_VEC[CW[f] ?? 'east'];
          const inWall =
            kindAt(x + ax, y, z + az) === 'wall' || kindAt(x - ax, y, z - az) === 'wall';
          write(i, e, { ...e.props, in_wall: String(inWall) });
          continue;
        }

        if (e.flags & FLAG_STAIR_SHAPE) {
          const shape = stairShape(e, x, y, z, entryAt);
          write(i, e, { ...e.props, shape });
          continue;
        }

        if ('snowy' in e.props) {
          const above = entryAt(x, y + 1, z);
          const snowy =
            !!above &&
            (above.name === 'snow' || above.name === 'snow_block' || above.name === 'powder_snow');
          write(i, e, { ...e.props, snowy: String(snowy) });
        }
      }
    }
  }
}

function isStairs(e: PaletteEntry | null): e is PaletteEntry {
  return !!e && e.name.endsWith('_stairs');
}

/** Minecraft's StairBlock.getStairsShape. */
function stairShape(
  e: PaletteEntry,
  x: number,
  y: number,
  z: number,
  entryAt: (x: number, y: number, z: number) => PaletteEntry | null,
): string {
  const facing = e.props.facing as Direction;
  const half = e.props.half;
  const rel = (d: Direction): PaletteEntry | null => {
    const [dx, dz] = DIR_VEC[d];
    return entryAt(x + dx, y, z + dz);
  };
  const axisOf = (d: Direction): 'x' | 'z' => (d === 'east' || d === 'west' ? 'x' : 'z');
  const canTakeShape = (face: Direction): boolean => {
    const n = rel(face);
    return !isStairs(n) || n.props.facing !== facing || n.props.half !== half;
  };
  const behind = rel(facing);
  if (isStairs(behind) && behind.props.half === half) {
    const d1 = behind.props.facing as Direction;
    if (axisOf(d1) !== axisOf(facing) && canTakeShape(OPPOSITE[d1])) {
      return d1 === CCW[facing] ? 'outer_left' : 'outer_right';
    }
  }
  const front = rel(OPPOSITE[facing]);
  if (isStairs(front) && front.props.half === half) {
    const d2 = front.props.facing as Direction;
    if (axisOf(d2) !== axisOf(facing) && canTakeShape(d2)) {
      return d2 === CCW[facing] ? 'inner_left' : 'inner_right';
    }
  }
  return 'straight';
}
