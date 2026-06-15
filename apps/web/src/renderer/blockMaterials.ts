import * as THREE from 'three';
import { colorFor, isTransparent } from '@minecraft-schematic-lab/shared';

export { colorFor, isTransparent };

type Category =
  | 'planks'
  | 'log'
  | 'brick'
  | 'cobble'
  | 'stone'
  | 'sand'
  | 'grass'
  | 'leaves'
  | 'concrete'
  | 'plain';

const cache = new Map<string, THREE.CanvasTexture | null>();

function categoryOf(state: string): Category {
  const s = state.toLowerCase();
  if (/concrete|wool|terracotta|glazed|carpet|stained_glass/.test(s)) return 'concrete';
  if (/plank/.test(s)) return 'planks';
  if (/log|stem|stripped|wood/.test(s)) return 'log';
  if (/brick/.test(s)) return 'brick';
  if (/cobble|gravel/.test(s)) return 'cobble';
  if (/sand/.test(s)) return 'sand';
  if (/grass|moss/.test(s)) return 'grass';
  if (/leaves|vine|fern/.test(s)) return 'leaves';
  if (/stone|andesite|diorite|granite|deepslate|blackstone|basalt/.test(s)) return 'stone';
  return 'plain';
}

// Cheap deterministic noise so a given block always textures the same way.
function makeRng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function hash(state: string): number {
  let h = 0;
  for (let i = 0; i < state.length; i++) h = (h * 31 + state.charCodeAt(i)) | 0;
  return h;
}

function draw(ctx: CanvasRenderingContext2D, cat: Category, size: number, seed: number): void {
  const rng = makeRng(seed);
  const dark = 'rgba(0,0,0,0.18)';
  const darker = 'rgba(0,0,0,0.30)';
  const light = 'rgba(255,255,255,0.10)';
  const speckle = (alpha: string, n: number) => {
    ctx.fillStyle = alpha;
    for (let i = 0; i < n; i++) {
      ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
    }
  };
  switch (cat) {
    case 'planks':
      ctx.fillStyle = darker;
      for (let y = 3; y < size; y += 4) ctx.fillRect(0, y, size, 1);
      speckle(dark, 10);
      break;
    case 'log':
      ctx.fillStyle = darker;
      for (let x = 3; x < size; x += 4) ctx.fillRect(x, 0, 1, size);
      speckle(dark, 8);
      break;
    case 'brick':
      ctx.fillStyle = darker;
      for (let y = 0; y < size; y += 4) ctx.fillRect(0, y, size, 1);
      for (let y = 0; y < size; y += 8) {
        for (let x = 0; x < size; x += 8) ctx.fillRect(x, y, 1, 4);
      }
      for (let y = 4; y < size; y += 8) {
        for (let x = 4; x < size; x += 8) ctx.fillRect(x, y, 1, 4);
      }
      break;
    case 'cobble':
      speckle(darker, 26);
      speckle(light, 14);
      break;
    case 'stone':
      speckle(dark, 14);
      speckle(light, 8);
      break;
    case 'sand':
      speckle(light, 22);
      speckle(dark, 6);
      break;
    case 'grass':
      speckle('rgba(0,0,0,0.12)', 16);
      speckle('rgba(255,255,255,0.12)', 10);
      break;
    case 'leaves':
      speckle(darker, 24);
      speckle(light, 18);
      break;
    case 'concrete':
      // Concrete/wool read as flat solid color — just a whisper of grain for depth.
      speckle('rgba(0,0,0,0.05)', 4);
      break;
    default:
      speckle(dark, 8);
      speckle(light, 5);
  }
}

function makeTexture(state: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = colorFor(state);
  ctx.fillRect(0, 0, size, size);
  draw(ctx, categoryOf(state), size, hash(state));
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A small procedural texture for a block state, memoized. Glass returns null (drawn as plain color). */
export function textureFor(state: string): THREE.CanvasTexture | null {
  const cached = cache.get(state);
  if (cached !== undefined) return cached;
  const texture = isTransparent(state) ? null : makeTexture(state);
  cache.set(state, texture);
  return texture;
}
