import * as THREE from 'three';
import type { AssetManifest } from '@minecraft-schematic-lab/shared';

const TILE = 16;

/**
 * Mip chain computed on the CPU with alpha-weighted averaging, so cutout textures (leaves, glass)
 * don't get dark fringes or fade out at a distance the way plain GPU mipmaps do.
 */
function buildMips(
  base: Uint8Array<ArrayBuffer>,
  layers: number,
): { data: Uint8Array<ArrayBuffer>; width: number; height: number }[] {
  const mips = [{ data: base, width: TILE, height: TILE }];
  let size = TILE;
  let src = base;
  while (size > 1) {
    const next = size >> 1;
    const out = new Uint8Array(next * next * 4 * layers);
    for (let l = 0; l < layers; l++) {
      const so = l * size * size * 4;
      const oo = l * next * next * 4;
      for (let y = 0; y < next; y++) {
        for (let x = 0; x < next; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          let wsum = 0;
          let amax = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const i = so + ((y * 2 + dy) * size + (x * 2 + dx)) * 4;
              const al = src[i + 3] as number;
              r += (src[i] as number) * al;
              g += (src[i + 1] as number) * al;
              b += (src[i + 2] as number) * al;
              a += al;
              wsum += al;
              if (al > amax) amax = al;
            }
          }
          const o = oo + (y * next + x) * 4;
          if (wsum > 0) {
            out[o] = r / wsum;
            out[o + 1] = g / wsum;
            out[o + 2] = b / wsum;
          }
          // Keep cutout coverage: a texel stays visible if most of its children were.
          out[o + 3] = Math.max(a / 4, amax > 200 && a / 4 > 96 ? 255 : 0);
        }
      }
    }
    mips.push({ data: out, width: next, height: next });
    src = out;
    size = next;
  }
  return mips;
}

/** Slice the server's atlas PNG into a 2D texture array (one 16×16 layer per texture). */
export async function loadTextureArray(
  atlasUrl: string,
  manifest: AssetManifest,
): Promise<THREE.DataArrayTexture> {
  const img = new Image();
  img.src = atlasUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
  const layers = manifest.textures.length;
  const data = new Uint8Array(TILE * TILE * 4 * layers);
  for (let l = 0; l < layers; l++) {
    const ax = (l % manifest.columns) * TILE;
    const ay = Math.floor(l / manifest.columns) * TILE;
    for (let y = 0; y < TILE; y++) {
      const src = ((ay + y) * img.width + ax) * 4;
      data.set(pixels.subarray(src, src + TILE * 4), (l * TILE * TILE + y * TILE) * 4);
    }
  }
  return makeArrayTexture(data, layers);
}

function makeArrayTexture(data: Uint8Array<ArrayBuffer>, layers: number): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, TILE, TILE, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = false;
  const mips = buildMips(data, layers);
  // Setting mipmaps makes three allocate every level; uploadMipLevels fills levels 1..n.
  tex.mipmaps = mips as unknown as THREE.DataArrayTexture['mipmaps'];
  tex.userData.mips = mips;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** One plain white layer, for the colour-only fallback when game textures are unavailable. */
export function whiteTextureArray(): THREE.DataArrayTexture {
  return makeArrayTexture(new Uint8Array(TILE * TILE * 4).fill(255), 1);
}

/**
 * three.js only uploads level 0 of a DataArrayTexture; upload our CPU mip chain into the levels
 * it allocated, otherwise distant faces sample empty (black) levels.
 */
export function uploadMipLevels(renderer: THREE.WebGLRenderer, tex: THREE.DataArrayTexture): void {
  const mips = tex.userData.mips as
    | { data: Uint8Array<ArrayBuffer>; width: number; height: number }[]
    | undefined;
  if (!mips) return;
  renderer.initTexture(tex);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const handle = (renderer.properties.get(tex) as { __webglTexture?: WebGLTexture }).__webglTexture;
  if (!handle) return;
  renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  for (let level = 1; level < mips.length; level++) {
    const m = mips[level] as { data: Uint8Array<ArrayBuffer>; width: number; height: number };
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      level,
      0,
      0,
      0,
      m.width,
      m.height,
      tex.image.depth,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      m.data,
    );
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
}
