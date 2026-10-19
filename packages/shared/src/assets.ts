// Baked block models exchanged between the server (which reads the game's own block models) and
// the browser viewer (which meshes them). Browser-safe, no dependencies.

/** Face directions in the order used for cullface/shading indices. */
export const FACE_DIRS = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
export type FaceDir = (typeof FACE_DIRS)[number];

/** Unit normal of each face direction. */
export const FACE_NORMALS: readonly [number, number, number][] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];

/** Minecraft's directional shading: up 1.0, down 0.5, north/south 0.8, east/west 0.6. */
export const FACE_SHADE = [0.5, 1, 0.8, 0.8, 0.6, 0.6] as const;

/**
 * One quad = QUAD_STRIDE numbers:
 *   0..11  4 vertices x,y,z in block units (TL, BL, BR, TR seen from the front)
 *   12..19 4 uv pairs in texture space (0..1, v down)
 *   20 texture layer, 21 cullface dir (-1 none), 22 shade dir (-1 = unshaded),
 *   23 tint RGB (-1 none), 24 render layer (0 opaque, 1 cutout, 2 translucent), 25 ambient occlusion (0/1)
 */
export const QUAD_STRIDE = 26;

export interface BakedVariant {
  /** Weight for random per-position variants (e.g. rotated stone, grass). */
  w: number;
  /** Flat quad data, QUAD_STRIDE numbers per quad. */
  q: number[];
}

export interface BakedBlock {
  v: BakedVariant[];
  /** Opaque full cube: hides the touching faces of neighbours. */
  full: boolean;
  /** Hides faces shared with the same block (glass panes of glass, water…). */
  self: boolean;
  /** Fluids are meshed specially (height depends on what is above). */
  fluid?: 'water' | 'lava';
  /** The liquid's `level` (0 source, 1–7 flowing lower and lower, 8+ falling). */
  fluidLevel?: number;
  /** Fluid texture layers [still, flow] and tint. */
  fluidTex?: [number, number];
  fluidTint?: number;
}

export interface AssetManifest {
  /** Client jar version the assets come from. */
  version: string;
  /** Texture layer names; index = layer in the atlas. Layer 0 is "missing". */
  textures: string[];
  /** Per layer: 0 opaque, 1 cutout, 2 translucent. */
  alpha: number[];
  /** Per layer: average color as 0xRRGGBB. */
  avg: number[];
  /** Atlas grid columns (each tile 16×16). */
  columns: number;
}

export interface AssetStatus {
  version: string;
  state: 'missing' | 'loading' | 'ready' | 'error';
  message?: string;
  progress?: number;
}
