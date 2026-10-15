// Types shared by the server API and the browser viewer.

export type Vec3 = [number, number, number];

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  minecraftVersion: string;
  /** Number of saved versions. */
  versions: number;
  blockCount: number;
}

export interface VersionSummary {
  n: number;
  label: string;
  createdAt: number;
  blockCount: number;
  size: Vec3;
}

export interface MaterialCount {
  state: string;
  name: string;
  count: number;
}

/** What the viewer needs to show the current build (the voxel data comes separately). */
export interface BuildHeader {
  buildId: string;
  projectId: string;
  n: number;
  name: string;
  description?: string;
  minecraftVersion: string;
  /** Client-jar version whose textures/models preview this build. */
  assetVersion: string;
  size: Vec3;
  /** Spec coordinates of local (0,0,0). */
  origin: Vec3;
  /** Local paste anchor. */
  anchor: Vec3;
  palette: string[];
  blockCount: number;
  warnings: string[];
  compileMs: number;
  createdAt: number;
}

export interface FeedbackItem {
  id: string;
  createdAt: number;
  status: 'open' | 'resolved';
  kind: 'note' | 'version';
  text: string;
  /** Spec coordinates of the block the note is pinned to. */
  pos?: Vec3;
  /** Spec-coordinate region the note covers. */
  region?: { from: Vec3; to: Vec3 };
  block?: string;
  /** Operation that placed the block (provenance label). */
  source?: string;
  /** Build version the note was made on. */
  n?: number;
  /** Requested target version (kind "version"). */
  targetVersion?: string;
  reply?: string;
  resolvedAt?: number;
}

export interface CameraState {
  position: Vec3;
  target: Vec3;
  fov: number;
  ortho?: boolean;
}

export type ViewName =
  | 'iso'
  | 'iso_nw'
  | 'iso_ne'
  | 'iso_sw'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'user';

export interface CaptureRequest {
  requestId: string;
  buildId: string;
  views: ViewName[];
  /** Spec-coordinate region to frame (default: whole build). */
  focus?: { from: Vec3; to: Vec3 };
  /** Hide blocks above this spec y (section view). */
  cutY?: number;
  /** Pixel size of each view tile. */
  size: number;
  /** Draw feedback pins in the image. */
  pins: boolean;
}

export interface VersionOption {
  id: string;
  major: string;
  legacy: boolean;
  dataVersion: number | null;
}

export interface ExportFormatInfo {
  id: string;
  extension: string;
  available: boolean;
  recommended: boolean;
  reason?: string;
}

export interface ExportTarget {
  id: 'worldedit' | 'litematica' | 'downloads';
  label: string;
  path: string;
  exists: boolean;
}

export interface InspectResult {
  pos: Vec3;
  state: string;
  source: string | null;
}

/** Server -> viewer events over SSE. */
export type ServerEvent =
  | { type: 'hello'; clientId: string; buildId: string | null }
  | { type: 'build'; buildId: string; projectId: string; n: number }
  | { type: 'compiling'; label: string }
  | { type: 'build-error'; errors: string[] }
  | { type: 'feedback'; items: FeedbackItem[] }
  | { type: 'projects' }
  | { type: 'assets'; version: string; state: string; message?: string; progress?: number }
  | { type: 'capture'; request: CaptureRequest }
  | { type: 'focus'; from: Vec3; to: Vec3; message?: string };
