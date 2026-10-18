/**
 * Directions in Minecraft's own order (Direction.values(): down, up, north, south, west, east).
 * +X east, +Y up, +Z south.
 */
export const DOWN = 0;
export const UP = 1;
export const NORTH = 2;
export const SOUTH = 3;
export const WEST = 4;
export const EAST = 5;

export const DIR_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
export type DirName = (typeof DIR_NAMES)[number];

export const DX = [0, 0, 0, 0, -1, 1] as const;
export const DY = [-1, 1, 0, 0, 0, 0] as const;
export const DZ = [0, 0, -1, 1, 0, 0] as const;
export const OPPOSITE = [UP, DOWN, SOUTH, NORTH, EAST, WEST] as const;

/** Direction.values(). */
export const ALL = [DOWN, UP, NORTH, SOUTH, WEST, EAST] as const;
/** Neighbour updates (NeighborUpdater.UPDATE_ORDER). */
export const UPDATE_ORDER = [WEST, EAST, DOWN, UP, NORTH, SOUTH] as const;
/** Shape updates (BlockBehaviour.UPDATE_SHAPE_ORDER). */
export const SHAPE_ORDER = [WEST, EAST, NORTH, SOUTH, DOWN, UP] as const;
/** Direction.Plane.HORIZONTAL. */
export const HORIZONTAL = [NORTH, EAST, SOUTH, WEST] as const;

export function dirOf(name: string | undefined): number {
  switch (name) {
    case 'down':
      return DOWN;
    case 'up':
      return UP;
    case 'north':
      return NORTH;
    case 'south':
      return SOUTH;
    case 'west':
      return WEST;
    case 'east':
      return EAST;
    default:
      return -1;
  }
}

export function isHorizontal(d: number): boolean {
  return d >= NORTH;
}

export function axisOf(d: number): number {
  return d < 2 ? 1 : d < 4 ? 2 : 0;
}

/** Rotate a horizontal direction clockwise seen from above (north → east → south → west). */
export function clockwise(d: number): number {
  switch (d) {
    case NORTH:
      return EAST;
    case EAST:
      return SOUTH;
    case SOUTH:
      return WEST;
    case WEST:
      return NORTH;
    default:
      return d;
  }
}

export function counterClockwise(d: number): number {
  switch (d) {
    case NORTH:
      return WEST;
    case WEST:
      return SOUTH;
    case SOUTH:
      return EAST;
    case EAST:
      return NORTH;
    default:
      return d;
  }
}

/** Direction.get3DDataValue (the piston block event parameter). */
export function dataValue(d: number): number {
  return d;
}
