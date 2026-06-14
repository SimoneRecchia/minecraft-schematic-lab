import type { BuildSpec } from '@minecraft-schematic-lab/build-spec';

export interface Vec3Size {
  x: number;
  y: number;
  z: number;
}

/** A single placed block position: [x, y, z]. */
export type BlockInstance = [number, number, number];

export interface PreviewData {
  size: Vec3Size;
  /** Block state id -> list of positions. */
  instances: Record<string, BlockInstance[]>;
}

export interface BuildStats {
  blockCount: number;
  palette: string[];
  size: Vec3Size;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface BuildResult {
  sessionId: string;
  buildId: string | null;
  valid: boolean;
  errors: string[];
  warnings: string[];
  blockCount: number;
  palette: string[];
  previewData: PreviewData;
}

export type ProjectMode = 'memory' | 'local' | 'git';

export interface ProjectGitStatus {
  branch: string | null;
  branches: string[];
  remote: string | null;
}

export interface ProjectStatus {
  mode: ProjectMode;
  path: string | null;
  git: ProjectGitStatus | null;
}

export interface CurrentBuildResponse {
  sessionId: string;
  buildId: string | null;
  spec: BuildSpec | null;
  stats: BuildStats;
  warnings: string[];
  previewUrl: string;
  project: ProjectStatus;
}

export interface SessionSummary {
  sessionId: string;
  name: string;
  buildId: string | null;
  blockCount: number;
  isCurrent: boolean;
}

export interface ApplyPatchResponse {
  spec: BuildSpec;
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: BuildStats;
  previewUrl: string;
}

export interface ExportInfo {
  filename: string;
  size: number;
  downloadUrl: string;
}

export interface InitLocalResult {
  mode: ProjectMode;
  path: string;
}

export interface InitGitResult {
  mode: ProjectMode;
  path: string;
  branch: string | null;
}

export interface SaveVersionResult {
  committed: boolean;
  commit: string | null;
  message: string;
}

export interface BranchInfo {
  current: string | null;
  branches: string[];
}

export interface PushResult {
  ok: boolean;
  output: string;
}
