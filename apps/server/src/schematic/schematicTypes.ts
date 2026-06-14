export type SchematicVersion = 2 | 3;

/** Minecraft version (major.minor) -> NBT DataVersion. Approximate; used as a hint for WorldEdit. */
export const DATA_VERSIONS: Record<string, number> = {
  '1.21': 3953,
  '1.20': 3463,
  '1.19': 3105,
  '1.18': 2860,
  '1.17': 2724,
  '1.16': 2566,
  '1.15': 2230,
  '1.14': 1952,
};

const DEFAULT_DATA_VERSION = 3953;

/**
 * Resolve a Minecraft version string to a DataVersion. Matches exactly, then by boundary-aware
 * prefix (so "1.21.10" maps via "1.21" but never accidentally via "1.21.1").
 */
export function dataVersionFor(version: string): number {
  const exact = DATA_VERSIONS[version];
  if (exact !== undefined) return exact;
  for (const [key, value] of Object.entries(DATA_VERSIONS)) {
    if (version === key || version.startsWith(`${key}.`)) return value;
  }
  return DEFAULT_DATA_VERSION;
}
