import type { WindowPatternOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import { AIR } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

type Axis = 'x' | 'z';

/**
 * Scan the axis perpendicular to the wall, at a fixed (along, y), for the outermost solid cell.
 * For north/south walls `axis` is 'x' (we vary the wall along X) and we scan Z; for east/west
 * walls `axis` is 'z' and we scan X. Returns the plane coordinate, or null if no wall is there.
 */
function findWallPlane(
  volume: BlockVolume,
  axis: Axis,
  along: number,
  y: number,
  outermost: boolean,
): number | null {
  const limit = axis === 'x' ? volume.z : volume.x;
  let found: number | null = null;
  for (let p = 0; p < limit; p++) {
    const state = axis === 'x' ? volume.getBlock(along, y, p) : volume.getBlock(p, y, along);
    if (state === AIR) continue;
    if (outermost) {
      found = p; // keep the largest solid coordinate
    } else if (found === null) {
      found = p; // keep the smallest solid coordinate
      break;
    }
  }
  return found;
}

export function windowPattern(
  volume: BlockVolume,
  op: WindowPatternOperation,
  ctx: CompileContext,
): void {
  const glass = ctx.resolveBlock(op.glassBlock);
  const frame = op.frameBlock ? ctx.resolveBlock(op.frameBlock) : null;
  const axis: Axis = op.side === 'north' || op.side === 'south' ? 'x' : 'z';
  const outermost = op.side === 'south' || op.side === 'east';

  const setOnWall = (along: number, y: number, plane: number, state: string): void => {
    if (axis === 'x') volume.setBlock(along, y, plane, state);
    else volume.setBlock(plane, y, along, state);
  };

  for (const start of op.positions) {
    const plane = findWallPlane(volume, axis, start, op.y, outermost);
    if (plane === null) {
      ctx.warn(
        `window_pattern (${op.side}) found no wall at position ${start}, y=${op.y}; skipped.`,
      );
      continue;
    }

    if (frame) {
      for (let dh = -1; dh <= op.height; dh++) {
        for (let dw = -1; dw <= op.width; dw++) {
          const onBorder = dh === -1 || dh === op.height || dw === -1 || dw === op.width;
          if (onBorder) setOnWall(start + dw, op.y + dh, plane, frame);
        }
      }
    }

    for (let dh = 0; dh < op.height; dh++) {
      for (let dw = 0; dw < op.width; dw++) {
        setOnWall(start + dw, op.y + dh, plane, glass);
      }
    }
  }
}
