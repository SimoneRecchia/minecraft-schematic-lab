import { createCanvas } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { colorFor } from '@minecraft-schematic-lab/shared';
import type { BlockVolume } from '@minecraft-schematic-lab/block-compiler';

interface Cube {
  x: number;
  y: number;
  z: number;
  color: string;
}

function fillPolygon(ctx: SKRSContext2D, pts: [number, number][], fill: string): void {
  ctx.beginPath();
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Render the volume as an isometric PNG so an agent (or human) can see the build. */
export function renderIsometric(volume: BlockVolume, maxSize = 900): Buffer {
  const cubes: Cube[] = [];
  for (const [state, positions] of Object.entries(volume.toInstanceGroups())) {
    const color = colorFor(state);
    for (const [x, y, z] of positions) cubes.push({ x, y, z, color });
  }

  const span = volume.x + volume.z;
  let tile = Math.min(
    Math.floor((2 * maxSize) / Math.max(1, volume.x + volume.z)),
    Math.floor(maxSize / Math.max(1, span / 4 + volume.y / 2)),
    28,
  );
  tile = Math.max(2, tile);

  const hw = tile / 2;
  const hh = tile / 4;
  const vh = tile / 2;
  const margin = tile;

  const anchor = (c: { x: number; y: number; z: number }) => ({
    cx: (c.x - c.z) * hw,
    cy: (c.x + c.z) * hh - c.y * vh,
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cubes) {
    const { cx, cy } = anchor(c);
    minX = Math.min(minX, cx - hw);
    maxX = Math.max(maxX, cx + hw);
    minY = Math.min(minY, cy - hh);
    maxY = Math.max(maxY, cy + hh + vh);
  }
  if (cubes.length === 0) {
    minX = 0;
    minY = 0;
    maxX = tile;
    maxY = tile;
  }

  const width = Math.ceil(maxX - minX) + margin * 2;
  const height = Math.ceil(maxY - minY) + margin * 2;
  const offsetX = -minX + margin;
  const offsetY = -minY + margin;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e1116';
  ctx.fillRect(0, 0, width, height);

  // Painter's algorithm: draw far/low blocks first.
  cubes.sort((a, b) => a.x + a.z - a.y - (b.x + b.z - b.y));

  for (const c of cubes) {
    const { cx, cy } = anchor(c);
    const sx = cx + offsetX;
    const sy = cy + offsetY;

    const top: [number, number][] = [
      [sx, sy - hh],
      [sx + hw, sy],
      [sx, sy + hh],
      [sx - hw, sy],
    ];
    const left: [number, number][] = [
      [sx - hw, sy],
      [sx, sy + hh],
      [sx, sy + hh + vh],
      [sx - hw, sy + vh],
    ];
    const right: [number, number][] = [
      [sx + hw, sy],
      [sx, sy + hh],
      [sx, sy + hh + vh],
      [sx + hw, sy + vh],
    ];

    fillPolygon(ctx, top, c.color);
    fillPolygon(ctx, left, c.color);
    fillPolygon(ctx, left, 'rgba(0,0,0,0.32)');
    fillPolygon(ctx, right, c.color);
    fillPolygon(ctx, right, 'rgba(0,0,0,0.18)');
  }

  return canvas.toBuffer('image/png');
}
