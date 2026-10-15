import raw from '../data/catalog.json';

/** [propertyName, allowedValues, defaultValueIndex] */
export type PropSpec = [string, string[], number];

export interface CatalogVersionEntry {
  id: string;
  dataVersion: number | null;
  dataset: string;
}

export interface CatalogData {
  source: string;
  generatedAt: string;
  /** Newest first. */
  versions: CatalogVersionEntry[];
  names: string[];
  /** blocks: flat [nameIndex, sigIndex, nameIndex, sigIndex, ...] */
  datasets: Record<string, { legacy: boolean; blocks: number[] }>;
  sigs: PropSpec[][];
  displayNames: Record<string, string>;
  fullCubes: string[];
  /** "id:meta" -> 1.13 block state, the vanilla flattening table. */
  legacyBlocks: Record<string, string>;
}

export const catalogData = raw as unknown as CatalogData;
