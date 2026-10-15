import { createCanvas } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { BlockVolume } from '@minecraft-schematic-lab/block-compiler';
import { blockShape, colorFor } from '@minecraft-schematic-lab/shared';

export type ColorSource = (state: string) => { top: string; side: string };

function fillPolygon(ctx: SKRSContext2D, pts: [number, number][], fill: string): void {
  ctx.beginPath();
  ctx.moveTo((pts[0] as [number, number])[0], (pts[0] as [number, number])[1]);
  for (let i = 1; i < pts.length; i++)
    ctx.lineTo((pts[i] as [number, number])[0], (pts[i] as [number, number])[1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

function shadeHex(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

export const defaultColors: ColorSource = (state) => {
  const c = colorFor(state);
  const hex = c.startsWith('#') ? c : '#888888';
  return { top: hex, side: hex };
};

/**
 * Flat-shaded isometric PNG of the build. Used when no browser viewer is available to render
 * the real textured view.
 */
export function renderIsometric(
  volume: BlockVolume,
  colors: ColorSource = defaultColors,
  maxSize = 1100,
): Buffer {
  const { sizeX: X, sizeY: Y, sizeZ: Z } = volume;
  const span = X + Z;
  let tile = Math.min(
    Math.floor((2 * maxSize) / Math.max(1, span)),
    Math.floor(maxSize / Math.max(1, span / 4 + Y / 2)),
    28,
  );
  tile = Math.max(2, tile);
  const hw = tile / 2;
  const hh = tile / 4;
  const vh = tile / 2;
  const width = Math.ceil(span * hw) + tile * 2;
  const height = Math.ceil(span * hh + Y * vh) + tile * 2;
  const offsetX = Z * hw + tile;
  const offsetY = Y * vh + tile;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, width, height);

  const solid = (x: number, y: number, z: number): boolean => {
    if (x >= X || y >= Y || z >= Z) return false;
    const s = volume.palette[volume.getId(x, y, z)] ?? '';
    return s !== 'minecraft:air' && blockShape(s) === 'full';
  };
  const colorCache = new Map<number, { top: string; left: string; right: string }>();
  // Painter's order: back (low x+z) to front, bottom to top.
  for (let d = 0; d < X + Z - 1; d++) {
    for (let y = 0; y < Y; y++) {
      for (let x = Math.max(0, d - Z + 1); x <= Math.min(X - 1, d); x++) {
        const z = d - x;
        const id = volume.getId(x, y, z);
        if (id === 0) continue;
        if (solid(x + 1, y, z) && solid(x, y, z + 1) && solid(x, y + 1, z)) continue;
        let c = colorCache.get(id);
        if (!c) {
          const base = colors(volume.palette[id] as string);
          c = { top: base.top, left: shadeHex(base.side, 0.8), right: shadeHex(base.side, 0.62) };
          colorCache.set(id, c);
        }
        const sx = (x - z) * hw + offsetX;
        const sy = (x + z) * hh - y * vh + offsetY;
        if (!solid(x, y + 1, z))
          fillPolygon(
            ctx,
            [
              [sx, sy - hh],
              [sx + hw, sy],
              [sx, sy + hh],
              [sx - hw, sy],
            ],
            c.top,
          );
        if (!solid(x, y, z + 1))
          fillPolygon(
            ctx,
            [
              [sx - hw, sy],
              [sx, sy + hh],
              [sx, sy + hh + vh],
              [sx - hw, sy + vh],
            ],
            c.left,
          );
        if (!solid(x + 1, y, z))
          fillPolygon(
            ctx,
            [
              [sx + hw, sy],
              [sx, sy + hh],
              [sx, sy + hh + vh],
              [sx + hw, sy + vh],
            ],
            c.right,
          );
      }
    }
  }
  return canvas.toBuffer('image/png');
}
