import * as THREE from 'three';
import { colorFor, isTransparent, textureNameFor } from '@minecraft-schematic-lab/shared';

export { colorFor, isTransparent };

// Real 16x block textures are served from the web root (apps/web/public/textures/block).
const TEXTURE_BASE = '/textures/block';
const cache = new Map<string, THREE.Texture | null>();
let loader: THREE.TextureLoader | null = null;

/**
 * Load the bundled pixel texture for a block state (crisp, no mipmaps), memoized.
 * Returns null when no texture is bundled — callers fall back to a flat color.
 */
export function textureFor(state: string): THREE.Texture | null {
  const cached = cache.get(state);
  if (cached !== undefined) return cached;

  const name = textureNameFor(state);
  let texture: THREE.Texture | null = null;
  if (name && typeof document !== 'undefined') {
    loader ??= new THREE.TextureLoader();
    texture = loader.load(`${TEXTURE_BASE}/${name}.png`);
    // Crisp, pixelated Minecraft look at every zoom. Nearest mipmaps keep the texels sharp
    // while taming shimmer on large builds (trilinear blurred textures away into flat color).
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  cache.set(state, texture);
  return texture;
}
