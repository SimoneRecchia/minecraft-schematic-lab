import { z } from 'zod';

export const vec3 = z.tuple([z.number().int(), z.number().int(), z.number().int()]);

export const boxOpSchema = z.object({
  type: z.literal('box'),
  from: vec3,
  to: vec3,
  block: z.string().min(1),
});

export const hollowBoxOpSchema = z.object({
  type: z.literal('hollow_box'),
  from: vec3,
  to: vec3,
  block: z.string().min(1),
  thickness: z.number().int().positive().optional(),
});

export const wallRectOpSchema = z.object({
  type: z.literal('wall_rect'),
  from: vec3,
  to: vec3,
  block: z.string().min(1),
  hollow: z.boolean().optional(),
});

export const gableRoofOpSchema = z.object({
  type: z.literal('gable_roof'),
  from: vec3,
  to: vec3,
  axis: z.enum(['x', 'z']),
  block: z.string().min(1),
  overhang: z.number().int().nonnegative().optional(),
});

export const cylinderOpSchema = z.object({
  type: z.literal('cylinder'),
  center: vec3,
  radius: z.number().positive(),
  height: z.number().int().positive(),
  block: z.string().min(1),
  hollow: z.boolean().optional(),
});

export const windowPatternOpSchema = z.object({
  type: z.literal('window_pattern'),
  side: z.enum(['north', 'south', 'east', 'west']),
  y: z.number().int(),
  positions: z.array(z.number().int()),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  glassBlock: z.string().min(1),
  frameBlock: z.string().min(1).optional(),
});

export const sphereOpSchema = z.object({
  type: z.literal('sphere'),
  center: vec3,
  radius: z.number().positive(),
  block: z.string().min(1),
  hollow: z.boolean().optional(),
});

export const pyramidOpSchema = z.object({
  type: z.literal('pyramid'),
  from: vec3,
  to: vec3,
  block: z.string().min(1),
  hollow: z.boolean().optional(),
});

export const rampOpSchema = z.object({
  type: z.literal('ramp'),
  from: vec3,
  to: vec3,
  axis: z.enum(['x', 'z']),
  block: z.string().min(1),
});

export const replaceOpSchema = z.object({
  type: z.literal('replace'),
  from: vec3,
  to: vec3,
  target: z.string().min(1),
  block: z.string().min(1),
});

export const blockEntityOpSchema = z.object({
  type: z.literal('block_entity'),
  pos: vec3,
  block: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const buildOperationSchema = z.discriminatedUnion('type', [
  boxOpSchema,
  hollowBoxOpSchema,
  wallRectOpSchema,
  gableRoofOpSchema,
  cylinderOpSchema,
  windowPatternOpSchema,
  sphereOpSchema,
  pyramidOpSchema,
  rampOpSchema,
  replaceOpSchema,
  blockEntityOpSchema,
]);

export const buildSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  minecraftVersion: z.string().min(1),
  size: z.object({
    x: z.number().int().positive(),
    y: z.number().int().positive(),
    z: z.number().int().positive(),
  }),
  origin: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      z: z.number().int(),
    })
    .optional(),
  palette: z.record(z.string(), z.string()),
  operations: z.array(buildOperationSchema),
  metadata: z
    .object({
      prompt: z.string().optional(),
      style: z.string().optional(),
      notes: z.array(z.string()).optional(),
    })
    .optional(),
});
