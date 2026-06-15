import { createCanvas } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { blockShape, colorFor, isTransparent } from '@minecraft-schematic-lab/shared';
import type { BlockVolume } from '@minecraft-schematic-lab/block-compiler';

interface Cube {
  x: number;
  y: number;
  z: number;
  color: string;
  state: string;
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

const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Render the volume as an isometric PNG so an agent (or human) can see the build. */
export function renderIsometric(volume: BlockVolume, maxSize = 900): Buffer {
  const cubes: Cube[] = [];
  // Occupancy by coverage class, used to cull faces hidden behind a neighbour.
  const fullSet = new Set<string>(); // full-height, full-footprint (full / stairs)
  const slabSet = new Set<string>(); // bottom-half coverage (slab)
  for (const [state, positions] of Object.entries(volume.toInstanceGroups())) {
    const color = colorFor(state);
    const shape = blockShape(state);
    for (const [x, y, z] of positions) {
      cubes.push({ x, y, z, color, state });
      if (shape === 'full' || shape === 'stairs') fullSet.add(keyOf(x, y, z));
      else if (shape === 'slab') slabSet.add(keyOf(x, y, z));
    }
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

  // Painter's algorithm: draw far/low blocks first. Tie-break by depth (x+z) then height so a
  // nearer/taller block (e.g. a wall) always paints over a farther one on the same diagonal.
  cubes.sort(
    (a, b) =>
      a.x + a.z - a.y - (b.x + b.z - b.y) || a.x + a.z - (b.x + b.z) || a.y - b.y,
  );

  for (const c of cubes) {
    const { cx, cy } = anchor(c);
    const sx = cx + offsetX;
    const sy = cy + offsetY;
    const shape = blockShape(c.state);

    // Per-shape geometry: slabs are half-height (on the floor), thin blocks are narrow posts.
    let s = 1;
    let topOff = 0;
    let h = vh;
    if (shape === 'slab') {
      topOff = vh * 0.5;
      h = vh * 0.5;
    } else if (shape === 'thin') {
      s = 0.42;
      topOff = hh * (1 - s);
    }
    const hwS = hw * s;
    const hhS = hh * s;
    const top = sy + topOff;

    // Cull faces hidden behind a neighbour, respecting each shape's coverage.
    const aboveKey = keyOf(c.x, c.y + 1, c.z);
    const zKey = keyOf(c.x, c.y, c.z + 1);
    const xKey = keyOf(c.x + 1, c.y, c.z);
    let drawTop = true;
    let drawLeft = true;
    let drawRight = true;
    if (shape === 'slab') {
      // Bottom-half sides are covered by a full or slab neighbour; the top is always exposed.
      drawLeft = !(fullSet.has(zKey) || slabSet.has(zKey));
      drawRight = !(fullSet.has(xKey) || slabSet.has(xKey));
    } else if (shape !== 'thin') {
      // full / stairs / glass: a slab leaves the upper half of a side visible, so only a
      // full-height neighbour culls the sides; either covers the top.
      drawTop = !(fullSet.has(aboveKey) || slabSet.has(aboveKey));
      drawLeft = !fullSet.has(zKey);
      drawRight = !fullSet.has(xKey);
    }

    const alpha = isTransparent(c.state) ? 0.55 : 1;
    if (alpha !== 1) ctx.globalAlpha = alpha;

    const topFace: [number, number][] = [
      [sx, top - hhS],
      [sx + hwS, top],
      [sx, top + hhS],
      [sx - hwS, top],
    ];
    const leftFace: [number, number][] = [
      [sx - hwS, top],
      [sx, top + hhS],
      [sx, top + hhS + h],
      [sx - hwS, top + h],
    ];
    const rightFace: [number, number][] = [
      [sx + hwS, top],
      [sx, top + hhS],
      [sx, top + hhS + h],
      [sx + hwS, top + h],
    ];

    if (drawTop) fillPolygon(ctx, topFace, c.color);
    if (drawLeft) {
      fillPolygon(ctx, leftFace, c.color);
      fillPolygon(ctx, leftFace, 'rgba(0,0,0,0.32)');
    }
    if (drawRight) {
      fillPolygon(ctx, rightFace, c.color);
      fillPolygon(ctx, rightFace, 'rgba(0,0,0,0.18)');
    }

    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  return canvas.toBuffer('image/png');
}
