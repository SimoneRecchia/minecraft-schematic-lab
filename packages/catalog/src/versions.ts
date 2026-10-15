import { catalogData } from './data';

export interface VersionInfo {
  /** Release id, e.g. "1.21.4", "1.12.2", "26.1". */
  id: string;
  /** NBT DataVersion written into schematics (null for 1.8.x, which predates it). */
  dataVersion: number | null;
  /** minecraft-data dataset that provides the block list. */
  dataset: string;
  /** Pre-flattening (1.8–1.12): numeric block ids, exported as MCEdit .schematic. */
  legacy: boolean;
  /** "1.21", "1.8", "26.1" … */
  major: string;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function majorOf(id: string): string {
  return id.split('.').slice(0, 2).join('.');
}

const VERSIONS: VersionInfo[] = catalogData.versions.map((v) => ({
  id: v.id,
  dataVersion: v.dataVersion,
  dataset: v.dataset,
  legacy: catalogData.datasets[v.dataset]?.legacy ?? false,
  major: majorOf(v.id),
}));
const BY_ID = new Map(VERSIONS.map((v) => [v.id, v]));

/** Every supported Java release, newest first. */
export function listVersions(): VersionInfo[] {
  return VERSIONS;
}

export const LATEST_VERSION: VersionInfo = VERSIONS[0] as VersionInfo;

/**
 * Resolve user input to a supported release: exact ids ("1.20.1"), "latest", or a family written
 * as "1.20.x" (newest patch of that family). Returns undefined for unknown versions.
 */
export function resolveVersion(input: string): VersionInfo | undefined {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/^(java|je|v)\s*/, '');
  if (s === 'latest' || s === '') return LATEST_VERSION;
  const exact = BY_ID.get(s);
  if (exact) return exact;
  const family = s.replace(/\.(x|\*)$/, '');
  if (family !== s || /^\d+\.\d+$/.test(family)) {
    return VERSIONS.find((v) => v.major === family);
  }
  return undefined;
}

/**
 * The client jar whose assets (textures + block models) preview a target version. Pre-1.13
 * targets use 1.13.2: same classic textures, but flattened block names like our specs.
 */
export function assetVersionFor(version: VersionInfo): string {
  return version.legacy ? '1.13.2' : version.id;
}

/** Newest release the bundled block data covers. */
export const LATEST_DATA_RELEASE = LATEST_VERSION.dataset.replace(/^pc\//, '').replace(/~.*$/, '');

/**
 * True for releases newer than the bundled block data: their extra blocks are read from the
 * game's own files when the textures load.
 */
export function blockDataIsOlder(version: VersionInfo): boolean {
  return compareVersions(version.id, LATEST_DATA_RELEASE) > 0;
}

export function isAtLeast(version: VersionInfo, other: string): boolean {
  return compareVersions(version.id, other) >= 0;
}
