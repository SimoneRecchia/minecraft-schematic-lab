import { z } from 'zod';

/** Integer block position [x, y, z]. +X east, +Y up, +Z south. */
export const vec3 = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
/** Position that may sit between blocks (x.5), for centers of even-sized shapes. */
export const vec3f = z.tuple([z.number(), z.number(), z.number()]);
export const vec2 = z.tuple([z.number().int(), z.number().int()]);

/** A block: palette key, or block state like "oak_stairs[facing=north]"; either may carry [props]. */
export const blockRef = z.string().min(1);

const axis = z.enum(['x', 'y', 'z']);
const horizontalAxis = z.enum(['x', 'z']);
const direction = z.enum(['north', 'south', 'east', 'west']);
const rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

/** Where an operation may write: only into air, only over existing blocks, or only over these. */
const mask = z.union([z.enum(['air', 'solid']), z.array(blockRef).min(1)]);

const common = {
  /** Stable name so later edits can target this operation. */
  id: z.string().min(1).optional(),
  note: z.string().optional(),
  mask: mask.optional(),
};

export const boxOp = z
  .object({
    type: z.literal('box'),
    ...common,
    from: vec3,
    to: vec3,
    block: blockRef,
    /** Only the 6-sided shell. */
    hollow: z.boolean().optional(),
    /** Only the 4 vertical sides (no floor/ceiling). */
    walls: z.boolean().optional(),
    thickness: z.number().int().positive().optional(),
    /** With hollow/walls: also fill the inside with this (e.g. "air" to carve it out). */
    inner: blockRef.optional(),
  })
  .strict();

export const lineOp = z
  .object({
    type: z.literal('line'),
    ...common,
    from: vec3.optional(),
    to: vec3.optional(),
    /** Polyline through these points (instead of from/to). */
    points: z.array(vec3).min(2).optional(),
    block: blockRef,
    /** Brush radius; 0 = single-block line. */
    radius: z.number().nonnegative().optional(),
  })
  .strict();

export const cylinderOp = z
  .object({
    type: z.literal('cylinder'),
    ...common,
    /** Center of the base disc. */
    center: vec3f,
    radius: z.number().positive(),
    /** Ellipse: second radius (z for vertical cylinders). */
    radius2: z.number().positive().optional(),
    /** Radius at the top end (frustum); 0 makes a cone. */
    radiusTop: z.number().nonnegative().optional(),
    height: z.number().int().positive(),
    axis: axis.optional(),
    block: blockRef,
    hollow: z.boolean().optional(),
    thickness: z.number().positive().optional(),
  })
  .strict();

export const coneOp = z
  .object({
    type: z.literal('cone'),
    ...common,
    center: vec3f,
    radius: z.number().positive(),
    height: z.number().int().positive(),
    axis: axis.optional(),
    block: blockRef,
    hollow: z.boolean().optional(),
  })
  .strict();

export const sphereOp = z
  .object({
    type: z.literal('sphere'),
    ...common,
    center: vec3f,
    radius: z.number().positive().optional(),
    /** Ellipsoid radii [rx, ry, rz] (instead of radius). */
    radii: z
      .tuple([z.number().positive(), z.number().positive(), z.number().positive()])
      .optional(),
    block: blockRef,
    hollow: z.boolean().optional(),
    thickness: z.number().positive().optional(),
    /** Keep only one half: "top" makes a dome. */
    half: z.enum(['top', 'bottom', 'north', 'south', 'east', 'west']).optional(),
  })
  .strict();

export const domeOp = z
  .object({
    type: z.literal('dome'),
    ...common,
    /** Center of the dome's base circle. */
    center: vec3f,
    radius: z.number().positive(),
    /** Vertical radius (defaults to radius). */
    height: z.number().positive().optional(),
    block: blockRef,
    hollow: z.boolean().optional(),
    thickness: z.number().positive().optional(),
  })
  .strict();

export const polygonOp = z
  .object({
    type: z.literal('polygon'),
    ...common,
    /** Footprint corners [x, z] in order. */
    points: z.array(vec2).min(3),
    y: z.number().int(),
    height: z.number().int().positive(),
    block: blockRef,
    /** Only the outline walls. */
    hollow: z.boolean().optional(),
    thickness: z.number().int().positive().optional(),
  })
  .strict();

export const roofOp = z
  .object({
    type: z.literal('roof'),
    ...common,
    shape: z.enum(['gable', 'hip', 'shed', 'flat', 'cone']),
    /** Wall footprint: from/to x,z are the outer wall faces; from.y is the first layer above the walls. */
    from: vec3.optional(),
    to: vec3.optional(),
    /** cone: center [x, y, z] (y = first layer) and radius of the wall circle. */
    center: vec3f.optional(),
    radius: z.number().positive().optional(),
    /** Stairs block (or palette key) for the slopes. A full block makes a stepped roof. */
    block: blockRef,
    /** gable: direction the ridge runs (default: the longer side). */
    axis: horizontalAxis.optional(),
    /** shed: the side the roof rises toward. */
    rise: direction.optional(),
    /** Rise per horizontal block: 0.5 shallow, 1 classic 45°, 2 steep. */
    pitch: z.number().positive().max(4).optional(),
    /** Rise per row from the eave inward, e.g. [2,2,1,1,0.5] for a curved/gambrel roof. */
    profile: z.array(z.number().positive().max(4)).min(1).optional(),
    /** Blocks the roof extends past the walls (default 1). */
    overhang: z.number().int().nonnegative().optional(),
    /** Slab used for half steps and the ridge (default: derived from the stairs). */
    slab: blockRef.optional(),
    /** Full block used to close steep steps and under the ridge (default: derived). */
    full: blockRef.optional(),
    /** Fill the triangular gable ends above the walls with this. */
    gable: blockRef.optional(),
    /** Fill the whole space under the roof with this. */
    fill: blockRef.optional(),
    /** Trim under the eaves (upside-down stairs are oriented automatically). */
    eaves: blockRef.optional(),
    /** Cap the ridge with this (slab/stairs/full). */
    ridge: blockRef.optional(),
  })
  .strict();

export const archOp = z
  .object({
    type: z.literal('arch'),
    ...common,
    /** Bounding box of the opening; the longer horizontal side is the span, the other the depth. */
    from: vec3,
    to: vec3,
    block: blockRef,
    style: z.enum(['round', 'pointed', 'segmental', 'flat']).optional(),
    /** Rise of the curve above from.y (default: half the span for round). */
    rise: z.number().positive().optional(),
    /** Ring thickness. */
    width: z.number().int().positive().optional(),
    /** Carve the opening (air) under the arch. */
    cut: z.boolean().optional(),
    /** Fill above the arch ring up to to.y (spandrels). */
    fill: blockRef.optional(),
  })
  .strict();

export const blocksOp = z
  .object({
    type: z.literal('blocks'),
    ...common,
    block: blockRef,
    at: z.array(vec3).min(1),
    /** Block entity data (chest items, sign text, …) for every placed block. */
    nbt: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const layersOp = z
  .object({
    type: z.literal('layers'),
    ...common,
    origin: vec3,
    /**
     * xz: layers stack upward (rows = z, chars = x), like a floor plan.
     * xy: layers stack south (rows top->bottom = y, chars = x), like a front elevation.
     * zy: layers stack east (rows top->bottom = y, chars = z), like a side elevation.
     */
    plane: z.enum(['xz', 'xy', 'zy']).optional(),
    /** Single character -> block. " " and "." are skipped unless mapped. */
    legend: z.record(z.string().length(1), blockRef),
    layers: z.array(z.array(z.string())).min(1),
  })
  .strict();

export const terrainOp = z
  .object({
    type: z.literal('terrain'),
    ...common,
    /** x/z extent; from.y is the base level. */
    from: vec3,
    to: vec3,
    shape: z.enum(['hills', 'flat', 'island', 'mountain', 'plateau']).optional(),
    /** Mean surface height above from.y. */
    height: z.number().nonnegative().optional(),
    /** Noise amplitude in blocks. */
    amplitude: z.number().nonnegative().optional(),
    /** Feature size in blocks. */
    scale: z.number().positive().optional(),
    surface: blockRef.optional(),
    subsurface: blockRef.optional(),
    depth: z.number().int().nonnegative().optional(),
    core: blockRef.optional(),
    /** Fill below this y with water where the ground is lower. */
    waterLevel: z.number().int().optional(),
    water: blockRef.optional(),
    /** Fade heights to the base level near the edges. */
    edgeFalloff: z.boolean().optional(),
    seed: z.number().int().optional(),
  })
  .strict();

export const treeOp = z
  .object({
    type: z.literal('tree'),
    ...common,
    /** Base of the trunk (the block above the ground). */
    at: vec3,
    kind: z.enum([
      'oak',
      'big_oak',
      'birch',
      'spruce',
      'pine',
      'dark_oak',
      'jungle',
      'acacia',
      'cherry',
      'willow',
      'palm',
      'dead',
      'bush',
      'fantasy',
    ]),
    height: z.number().int().positive().optional(),
    /** Canopy radius. */
    radius: z.number().positive().optional(),
    log: blockRef.optional(),
    leaves: blockRef.optional(),
    seed: z.number().int().optional(),
  })
  .strict();

export const scatterOp = z
  .object({
    type: z.literal('scatter'),
    ...common,
    from: vec3,
    to: vec3,
    /** Place on top of these blocks (default: any solid block). */
    on: z.array(blockRef).optional(),
    /** Block to place (palette mixes work), or… */
    block: blockRef.optional(),
    /** …a component to place (randomly rotated), or a tree kind. */
    component: z.string().optional(),
    tree: treeOp.shape.kind.optional(),
    /** Probability per surface block (0–1). */
    density: z.number().min(0).max(1),
    /** Minimum distance between placements. */
    spacing: z.number().nonnegative().optional(),
    seed: z.number().int().optional(),
  })
  .strict();

export const replaceOp = z
  .object({
    type: z.literal('replace'),
    ...common,
    /** Region (default: the whole build). */
    from: vec3.optional(),
    to: vec3.optional(),
    /** Blocks to replace; a bare name matches every state of that block. */
    target: z.union([blockRef, z.array(blockRef).min(1)]),
    block: blockRef,
    /** Probability per matching block (0–1), for weathering. */
    chance: z.number().min(0).max(1).optional(),
    seed: z.number().int().optional(),
  })
  .strict();

export const scriptOp = z
  .object({
    type: z.literal('script'),
    ...common,
    /** JavaScript body. API: set, get, op, box, line, sphere, …, rand, noise, args. */
    code: z.string().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const transformFields = {
  rotate: rotation.optional(),
  mirror: horizontalAxis.optional(),
  /** Copies: count total, each shifted by offset from the previous. */
  repeat: z
    .object({ count: z.number().int().positive().max(512), offset: vec3 })
    .strict()
    .optional(),
  /** Also emit a mirrored copy across x = value and/or z = value (may be x.5). */
  symmetry: z.object({ x: z.number().optional(), z: z.number().optional() }).strict().optional(),
};

export interface GroupOperationInput {
  type: 'group';
  id?: string;
  note?: string;
  mask?: z.infer<typeof mask>;
  operations: OperationInput[];
  offset?: [number, number, number];
  rotate?: 0 | 90 | 180 | 270;
  mirror?: 'x' | 'z';
  repeat?: { count: number; offset: [number, number, number] };
  symmetry?: { x?: number; z?: number };
}

export interface PlaceOperationInput {
  type: 'place';
  id?: string;
  note?: string;
  mask?: z.infer<typeof mask>;
  component: string;
  at: [number, number, number];
  rotate?: 0 | 90 | 180 | 270;
  mirror?: 'x' | 'z';
  repeat?: { count: number; offset: [number, number, number] };
  symmetry?: { x?: number; z?: number };
}

type LeafOperationInput =
  | z.infer<typeof boxOp>
  | z.infer<typeof lineOp>
  | z.infer<typeof cylinderOp>
  | z.infer<typeof coneOp>
  | z.infer<typeof sphereOp>
  | z.infer<typeof domeOp>
  | z.infer<typeof polygonOp>
  | z.infer<typeof roofOp>
  | z.infer<typeof archOp>
  | z.infer<typeof blocksOp>
  | z.infer<typeof layersOp>
  | z.infer<typeof terrainOp>
  | z.infer<typeof treeOp>
  | z.infer<typeof scatterOp>
  | z.infer<typeof replaceOp>
  | z.infer<typeof scriptOp>;

export type OperationInput = LeafOperationInput | GroupOperationInput | PlaceOperationInput;

export const groupOp: z.ZodType<GroupOperationInput> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      ...common,
      operations: z.array(operationSchema),
      offset: vec3.optional(),
      ...transformFields,
    })
    .strict(),
);

export const placeOp = z
  .object({
    type: z.literal('place'),
    ...common,
    component: z.string().min(1),
    at: vec3,
    ...transformFields,
  })
  .strict();

const LEAF_SCHEMAS = {
  box: boxOp,
  line: lineOp,
  cylinder: cylinderOp,
  cone: coneOp,
  sphere: sphereOp,
  dome: domeOp,
  polygon: polygonOp,
  roof: roofOp,
  arch: archOp,
  blocks: blocksOp,
  layers: layersOp,
  terrain: terrainOp,
  tree: treeOp,
  scatter: scatterOp,
  replace: replaceOp,
  script: scriptOp,
  place: placeOp,
} as const;

export const OPERATION_TYPES = [...Object.keys(LEAF_SCHEMAS), 'group'] as const;

/**
 * Dispatch on `type` first so a bad field yields one precise error for that operation type,
 * instead of a union error listing every alternative.
 */
export const operationSchema: z.ZodType<OperationInput> = z.lazy(
  () =>
    z
      .object({ type: z.string() })
      .passthrough()
      .superRefine((value, ctx) => {
        const schema =
          value.type === 'group'
            ? groupOp
            : (LEAF_SCHEMAS as Record<string, z.ZodTypeAny>)[value.type];
        if (!schema) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['type'],
            message: `Unknown operation type "${value.type}". Use one of: ${OPERATION_TYPES.join(', ')}.`,
          });
          return;
        }
        const parsed = schema.safeParse(value);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) ctx.addIssue(issue);
        }
      }) as unknown as z.ZodType<OperationInput>,
);

export const paletteEntrySchema = z.union([
  blockRef,
  z
    .object({
      /** Weighted random mix: { "stone_bricks": 6, "cracked_stone_bricks": 2 }. */
      mix: z.record(blockRef, z.number().positive()),
      /** Clump size in blocks (1 = per-block noise, 4 = patches). */
      scale: z.number().positive().optional(),
      seed: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      gradient: z
        .object({
          axis,
          from: z.number(),
          to: z.number(),
          /** Blocks from the `from` end to the `to` end. */
          blocks: z.array(blockRef).min(2),
          /** 0–1: how much the bands dither into each other. */
          jitter: z.number().min(0).max(1).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export const componentSchema = z
  .object({
    description: z.string().optional(),
    operations: z.array(operationSchema),
  })
  .strict();

export const buildSpecSchema = z
  .object({
    $schema: z.string().optional(),
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    /** Target Minecraft Java version, e.g. "1.21.4", "1.20.1", "1.12.2", "26.1". */
    minecraftVersion: z.string().min(1),
    /** Optional hard bounds: blocks outside 0..size-1 are dropped (with a warning). */
    size: z
      .object({
        x: z.number().int().positive(),
        y: z.number().int().positive(),
        z: z.number().int().positive(),
      })
      .strict()
      .optional(),
    /** Point that lands at the player's feet on //paste (default: bottom center). */
    anchor: vec3.optional(),
    seed: z.number().int().optional(),
    palette: z.record(z.string().min(1), paletteEntrySchema).optional(),
    components: z.record(z.string().min(1), componentSchema).optional(),
    operations: z.array(operationSchema),
    metadata: z
      .object({
        prompt: z.string().optional(),
        style: z.string().optional(),
        notes: z.array(z.string()).optional(),
        author: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .strict();
