import { validateBuildSpec } from '@minecraft-schematic-lab/build-spec';
import type { BuildOperation, BuildSpec } from '@minecraft-schematic-lab/build-spec';
import { BlockVolume } from './BlockVolume';
import { box } from './operations/box';
import { hollowBox } from './operations/hollowBox';
import { wallRect } from './operations/wallRect';
import { gableRoof } from './operations/gableRoof';
import { cylinder } from './operations/cylinder';
import { windowPattern } from './operations/windowPattern';
import { sphere } from './operations/sphere';
import { pyramid } from './operations/pyramid';
import { ramp } from './operations/ramp';
import { replace } from './operations/replace';
import { blockEntity } from './operations/blockEntity';

export interface BlockEntity {
  pos: [number, number, number];
  id: string;
  data: Record<string, unknown>;
}

export interface CompileContext {
  resolveBlock(key: string): string;
  warn(message: string): void;
  addBlockEntity(entity: BlockEntity): void;
}

export interface CompileResult {
  spec: BuildSpec;
  volume: BlockVolume;
  warnings: string[];
  blockCount: number;
  palette: string[];
  blockEntities: BlockEntity[];
}

export class BuildSpecError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid build spec: ${errors.join('; ')}`);
    this.name = 'BuildSpecError';
    this.errors = errors;
  }
}

/** namespace:path(optional [state=...]) — a plausible Minecraft block state id. */
export const BLOCK_STATE_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_/.]+(\[[a-z0-9_=,.:]*\])?$/;

export function compileBuildSpec(input: unknown): CompileResult {
  const validation = validateBuildSpec(input);
  if (!validation.success) {
    throw new BuildSpecError(validation.errors);
  }
  const spec = validation.data;

  const volume = new BlockVolume(spec.size.x, spec.size.y, spec.size.z);
  const warnings: string[] = [];
  const blockEntities: BlockEntity[] = [];
  const warnedStates = new Set<string>();

  const ctx: CompileContext = {
    resolveBlock(key: string): string {
      const mapped = spec.palette[key];
      const state = mapped ?? key;
      if (mapped === undefined && !BLOCK_STATE_PATTERN.test(key)) {
        warnings.push(
          `"${key}" is not a palette key or a valid block id; using it literally.`,
        );
      }
      if (!warnedStates.has(state) && !BLOCK_STATE_PATTERN.test(state)) {
        warnedStates.add(state);
        warnings.push(`"${state}" does not look like a valid Minecraft block id.`);
      }
      return state;
    },
    warn(message: string) {
      warnings.push(message);
    },
    addBlockEntity(entity: BlockEntity) {
      blockEntities.push(entity);
    },
  };

  for (const op of spec.operations) {
    dispatch(volume, op, ctx);
  }

  if (volume.outOfBoundsWrites > 0) {
    warnings.push(
      `${volume.outOfBoundsWrites} block(s) were placed outside the ${spec.size.x}x${spec.size.y}x${spec.size.z} bounds and were skipped.`,
    );
  }

  return {
    spec,
    volume,
    warnings,
    blockCount: volume.countBlocks(),
    palette: volume.getPalette(),
    blockEntities,
  };
}

function dispatch(volume: BlockVolume, op: BuildOperation, ctx: CompileContext): void {
  switch (op.type) {
    case 'box':
      return box(volume, op, ctx);
    case 'hollow_box':
      return hollowBox(volume, op, ctx);
    case 'wall_rect':
      return wallRect(volume, op, ctx);
    case 'gable_roof':
      return gableRoof(volume, op, ctx);
    case 'cylinder':
      return cylinder(volume, op, ctx);
    case 'window_pattern':
      return windowPattern(volume, op, ctx);
    case 'sphere':
      return sphere(volume, op, ctx);
    case 'pyramid':
      return pyramid(volume, op, ctx);
    case 'ramp':
      return ramp(volume, op, ctx);
    case 'replace':
      return replace(volume, op, ctx);
    case 'block_entity':
      return blockEntity(volume, op, ctx);
  }
}
