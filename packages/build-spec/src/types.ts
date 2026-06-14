import type { z } from 'zod';
import type {
  blockEntityOpSchema,
  boxOpSchema,
  buildOperationSchema,
  buildSpecSchema,
  cylinderOpSchema,
  gableRoofOpSchema,
  hollowBoxOpSchema,
  pyramidOpSchema,
  rampOpSchema,
  replaceOpSchema,
  sphereOpSchema,
  wallRectOpSchema,
  windowPatternOpSchema,
} from './schema';

export type Vec3 = [number, number, number];

export type BuildSpec = z.infer<typeof buildSpecSchema>;
export type BuildOperation = z.infer<typeof buildOperationSchema>;

export type BoxOperation = z.infer<typeof boxOpSchema>;
export type HollowBoxOperation = z.infer<typeof hollowBoxOpSchema>;
export type WallRectOperation = z.infer<typeof wallRectOpSchema>;
export type GableRoofOperation = z.infer<typeof gableRoofOpSchema>;
export type CylinderOperation = z.infer<typeof cylinderOpSchema>;
export type WindowPatternOperation = z.infer<typeof windowPatternOpSchema>;
export type SphereOperation = z.infer<typeof sphereOpSchema>;
export type PyramidOperation = z.infer<typeof pyramidOpSchema>;
export type RampOperation = z.infer<typeof rampOpSchema>;
export type ReplaceOperation = z.infer<typeof replaceOpSchema>;
export type BlockEntityOperation = z.infer<typeof blockEntityOpSchema>;

export type OperationType = BuildOperation['type'];
export type OperationOfType<T extends OperationType> = Extract<BuildOperation, { type: T }>;
