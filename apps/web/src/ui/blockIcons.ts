import {
  QUAD_STRIDE,
  colorFor,
  type AssetManifest,
  type BakedBlock,
} from '@minecraft-schematic-lab/shared';
import { api } from '../api';

const atlasCache = new Map<string, Promise<HTMLImageElement>>();
const iconCache = new Map<string, string>();

function atlas(version: string): Promise<HTMLImageElement> {
  let p = atlasCache.get(version);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = api.atlasUrl(version);
    });
    atlasCache.set(version, p);
  }
  return p;
}

function tile(
  img: HTMLImageElement,
  manifest: AssetManifest,
  layer: number,
  tint: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    img,
    (layer % manifest.columns) * 16,
    Math.floor(layer / manifest.columns) * 16,
    16,
    16,
    0,
    0,
    16,
    16,
  );
  if (tint >= 0) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `#${tint.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 16, 16);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(
      img,
      (layer % manifest.columns) * 16,
      Math.floor(layer / manifest.columns) * 16,
      16,
      16,
      0,
      0,
      16,
      16,
    );
  }
  return c;
}

function faceOf(model: BakedBlock, dir: number): [number, number] | null {
  const q = model.v[0]?.q ?? [];
  for (let i = 0; i < q.length; i += QUAD_STRIDE) {
    if (q[i + 22] === dir) return [q[i + 20] as number, q[i + 23] as number];
  }
  return null;
}

/** Inventory-style isometric icon for a block state, drawn from the real textures. */
export async function blockIcon(
  state: string,
  version: string | null,
  manifest: AssetManifest | null,
  model: BakedBlock | null,
): Promise<string> {
  const key = `${version}|${state}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  const draw = (
    src: CanvasImageSource | string,
    m: [number, number, number, number, number, number],
    shade: number,
  ) => {
    ctx.save();
    ctx.setTransform(...m);
    ctx.beginPath();
    ctx.rect(0, 0, 16, 16);
    ctx.clip();
    if (typeof src === 'string') {
      ctx.fillStyle = src;
      ctx.fillRect(0, 0, 16, 16);
    } else {
      ctx.drawImage(src, 0, 0);
    }
    if (shade < 1) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
      ctx.fillRect(0, 0, 16, 16);
    }
    ctx.restore();
  };
  const TOP: [number, number, number, number, number, number] = [1.75, 0.875, -1.75, 0.875, 32, 4];
  const LEFT: [number, number, number, number, number, number] = [1.75, 0.875, 0, 1.75, 4, 18];
  const RIGHT: [number, number, number, number, number, number] = [1.75, -0.875, 0, 1.75, 32, 32];
  if (model && manifest && version) {
    const img = await atlas(version);
    const up = faceOf(model, 1);
    const south = faceOf(model, 3) ?? faceOf(model, 2);
    const east = faceOf(model, 5) ?? faceOf(model, 4) ?? south;
    if (up && south && east) {
      draw(tile(img, manifest, south[0], south[1]), LEFT, 0.8);
      draw(tile(img, manifest, east[0], east[1]), RIGHT, 0.62);
      draw(tile(img, manifest, up[0], up[1]), TOP, 1);
    } else {
      const any = model.v[0]?.q ?? [];
      const layer = (any[20] as number | undefined) ?? model.fluidTex?.[0] ?? 0;
      const tint = (any[23] as number | undefined) ?? model.fluidTint ?? -1;
      ctx.drawImage(tile(img, manifest, layer, tint), 8, 8, 48, 48);
    }
  } else {
    const col = colorFor(state);
    draw(col, LEFT, 0.8);
    draw(col, RIGHT, 0.62);
    draw(col, TOP, 1);
  }
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}
