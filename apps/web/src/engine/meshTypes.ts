import type { BakedBlock } from '@minecraft-schematic-lab/shared';

export const CHUNK = 32;

/** Render layers, drawn in this order. */
export const LAYERS = ['opaque', 'cutout', 'translucent'] as const;

export interface MeshBuffers {
  positions: Float32Array;
  /** u, v, texture layer per vertex. */
  uvw: Float32Array;
  /** rgb (shade × ambient occlusion × tint) per vertex, 0–255. */
  colors: Uint8Array;
  indices: Uint32Array;
}

export interface ChunkMesh {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  layers: (MeshBuffers | null)[];
}

export type WorkerIn =
  | {
      type: 'init';
      generation: number;
      size: [number, number, number];
      data: Uint16Array;
      /** Baked model per palette index (null = air / unknown). */
      models: (BakedBlock | null)[];
      /** Block name id per palette index (same block, different states → same id). */
      nameIds: Int32Array;
    }
  | {
      type: 'mesh';
      generation: number;
      chunks: [number, number, number][];
      clipY: number | null;
      /** Live updates (redstone) mesh quietly, without progress reports. */
      live?: boolean;
    }
  | {
      type: 'patch';
      generation: number;
      /** Pairs of (cell index, palette index). */
      cells: Uint32Array;
      /** Palette entries added since the last message, starting at palette index `from`. */
      from: number;
      models: (BakedBlock | null)[];
      nameIds: Int32Array;
    };

export type WorkerOut =
  | { type: 'chunk'; generation: number; clipY: number | null; mesh: ChunkMesh; live?: boolean }
  | { type: 'done'; generation: number };
