import type { BlockVolume, BlockEntity } from '@minecraft-schematic-lab/block-compiler';
import type { BuildSpec } from '@minecraft-schematic-lab/build-spec';
import type { ProjectMode } from '@minecraft-schematic-lab/shared';
import type { SchematicVersion } from '../schematic/schematicTypes';

export interface SessionProjectGit {
  branch: string | null;
  branches: string[];
  remote: string | null;
}

export interface SessionProject {
  mode: ProjectMode;
  path: string | null;
  git: SessionProjectGit | null;
}

export interface Session {
  id: string;
  buildId: string | null;
  spec: BuildSpec | null;
  volume: BlockVolume | null;
  warnings: string[];
  blockCount: number;
  palette: string[];
  blockEntities: BlockEntity[];
  schematicCache: Map<SchematicVersion, Buffer>;
  project: SessionProject;
  createdAt: number;
  updatedAt: number;
}
