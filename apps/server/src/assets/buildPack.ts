import { createCanvas, loadImage } from '@napi-rs/canvas';
import { strFromU8, unzipSync } from 'fflate';
import type { AssetManifest } from '@minecraft-schematic-lab/shared';
import type { Progress } from './clientJar';

/** Everything the baker needs from the game's resources, plus the texture atlas. */
export interface PackData {
  manifest: AssetManifest;
  blockstates: Record<string, unknown>;
  models: Record<string, unknown>;
}

export const ATLAS_COLUMNS = 64;
const TILE = 16;
const PREFIX = 'assets/minecraft/';

function wanted(name: string): boolean {
  if (!name.startsWith(PREFIX)) return false;
  const rest = name.slice(PREFIX.length);
  return (
    (rest.startsWith('blockstates/') && rest.endsWith('.json')) ||
    (rest.startsWith('models/block/') && rest.endsWith('.json')) ||
    (rest.startsWith('textures/block/') && rest.endsWith('.png'))
  );
}

/** Pixel classes Minecraft's render layers follow: solid, cutout (alpha test), translucent. */
function alphaClass(data: Uint8ClampedArray): number {
  let cut = false;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i] as number;
    if (a > 0 && a < 255) return 2;
    if (a === 0) cut = true;
  }
  return cut ? 1 : 0;
}

function averageColor(data: Uint8ClampedArray): number {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] as number) < 128) continue;
    r += data[i] as number;
    g += data[i + 1] as number;
    b += data[i + 2] as number;
    n++;
  }
  if (n === 0) return 0x808080;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

/**
 * Read the block models, blockstates and block textures out of a client jar and pack the
 * textures (first animation frame, 16×16) into one atlas PNG.
 */
export async function buildPack(
  version: string,
  jar: Uint8Array,
  progress: Progress,
): Promise<{ data: PackData; atlas: Buffer }> {
  progress(`Reading Minecraft ${version} block models and textures…`);
  const files = unzipSync(jar, { filter: (f) => wanted(f.name) });
  const blockstates: Record<string, unknown> = {};
  const models: Record<string, unknown> = {};
  const textureFiles: [string, Uint8Array][] = [];
  for (const [path, bytes] of Object.entries(files)) {
    const rest = path.slice(PREFIX.length);
    if (rest.startsWith('blockstates/')) {
      blockstates[rest.slice(12, -5)] = JSON.parse(strFromU8(bytes));
    } else if (rest.startsWith('models/')) {
      models[rest.slice(7, -5)] = JSON.parse(strFromU8(bytes));
    } else {
      textureFiles.push([rest.slice(15, -4), bytes]);
    }
  }
  if (Object.keys(blockstates).length === 0) {
    throw new Error(`The Minecraft ${version} client has no flattened block models (needs 1.13+).`);
  }
  textureFiles.sort((a, b) => a[0].localeCompare(b[0]));

  const names = ['missing', ...textureFiles.map(([n]) => n)];
  const rows = Math.ceil(names.length / ATLAS_COLUMNS);
  const atlas = createCanvas(ATLAS_COLUMNS * TILE, rows * TILE);
  const actx = atlas.getContext('2d');
  actx.imageSmoothingEnabled = false;
  const alpha: number[] = [0];
  const avg: number[] = [0xff00ff];
  // Layer 0: the classic magenta/black "missing texture".
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      actx.fillStyle = x < 8 !== y < 8 ? '#f800f8' : '#000000';
      actx.fillRect(x, y, 1, 1);
    }
  }
  const tile = createCanvas(TILE, TILE);
  const tctx = tile.getContext('2d');
  tctx.imageSmoothingEnabled = false;
  for (let i = 0; i < textureFiles.length; i++) {
    const [, bytes] = textureFiles[i] as [string, Uint8Array];
    const layer = i + 1;
    try {
      const img = await loadImage(Buffer.from(bytes));
      // Animated textures are vertical strips: keep the first square frame.
      const frame = Math.min(img.width, img.height);
      tctx.clearRect(0, 0, TILE, TILE);
      tctx.drawImage(img, 0, 0, img.width, frame, 0, 0, TILE, TILE);
      const pixels = tctx.getImageData(0, 0, TILE, TILE);
      alpha.push(alphaClass(pixels.data));
      avg.push(averageColor(pixels.data));
      actx.putImageData(
        pixels,
        (layer % ATLAS_COLUMNS) * TILE,
        Math.floor(layer / ATLAS_COLUMNS) * TILE,
      );
    } catch {
      alpha.push(0);
      avg.push(0xff00ff);
    }
  }
  progress(`Packed ${names.length} textures.`);
  return {
    data: {
      manifest: { version, textures: names, alpha, avg, columns: ATLAS_COLUMNS },
      blockstates,
      models,
    },
    atlas: await atlas.encode('png'),
  };
}
