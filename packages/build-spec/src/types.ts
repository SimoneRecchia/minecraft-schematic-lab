import type { z } from 'zod';
import type {
  circuitIoSchema,
  circuitSchema,
  circuitTestSchema,
  archOp,
  blocksOp,
  boxOp,
  buildSpecSchema,
  componentSchema,
  coneOp,
  cylinderOp,
  domeOp,
  flattenOp,
  foundationOp,
  pathOp,
  GroupOperationInput,
  layersOp,
  lineOp,
  OperationInput,
  paletteEntrySchema,
  PlaceOperationInput,
  polygonOp,
  replaceOp,
  roofOp,
  scatterOp,
  scriptOp,
  sphereOp,
  terrainOp,
  treeOp,
} from './schema';

export type Vec3 = [number, number, number];

export type BuildSpec = z.infer<typeof buildSpecSchema>;
export type BuildOperation = OperationInput;
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;
export type Component = z.infer<typeof componentSchema>;

export type BoxOperation = z.infer<typeof boxOp>;
export type LineOperation = z.infer<typeof lineOp>;
export type CylinderOperation = z.infer<typeof cylinderOp>;
export type ConeOperation = z.infer<typeof coneOp>;
export type SphereOperation = z.infer<typeof sphereOp>;
export type DomeOperation = z.infer<typeof domeOp>;
export type PolygonOperation = z.infer<typeof polygonOp>;
export type RoofOperation = z.infer<typeof roofOp>;
export type ArchOperation = z.infer<typeof archOp>;
export type BlocksOperation = z.infer<typeof blocksOp>;
export type LayersOperation = z.infer<typeof layersOp>;
export type TerrainOperation = z.infer<typeof terrainOp>;
export type TreeOperation = z.infer<typeof treeOp>;
export type ScatterOperation = z.infer<typeof scatterOp>;
export type ReplaceOperation = z.infer<typeof replaceOp>;
export type ScriptOperation = z.infer<typeof scriptOp>;
export type FlattenOperation = z.infer<typeof flattenOp>;
export type FoundationOperation = z.infer<typeof foundationOp>;
export type PathOperation = z.infer<typeof pathOp>;
export type GroupOperation = GroupOperationInput;
export type PlaceOperation = PlaceOperationInput;

export type CircuitDefinition = z.infer<typeof circuitSchema>;
export type CircuitTest = z.infer<typeof circuitTestSchema>;
export type CircuitIo = z.infer<typeof circuitIoSchema>;

export type OperationType = BuildOperation['type'];
export type OperationOfType<T extends OperationType> = Extract<BuildOperation, { type: T }>;
export type TreeKind = TreeOperation['kind'];
