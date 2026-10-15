import { getCatalog, type VersionInfo } from '@minecraft-schematic-lab/catalog';
import { materialList, materialListCsv } from './materials';
import {
  writeLitematic,
  writeMcEdit,
  writeSpongeV2,
  writeSpongeV3,
  writeStructure,
  type ExportInput,
} from './writers';

export * from './writers';
export * from './materials';
export { writeNbt, jsonToTag } from './nbt';

export type ExportFormat = 'schem' | 'schem3' | 'schematic' | 'litematic' | 'nbt' | 'materials';

export interface FormatInfo {
  id: ExportFormat;
  extension: string;
  available: boolean;
  /** Best default for this version. */
  recommended: boolean;
  /** Why it's unavailable for this version. */
  reason?: string;
}

export const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  schem: '.schem',
  schem3: '.schem',
  schematic: '.schematic',
  litematic: '.litematic',
  nbt: '.nbt',
  materials: '.csv',
};

/** Which formats make sense for a target version. */
export function formatsFor(version: VersionInfo): FormatInfo[] {
  const legacy = version.legacy;
  const dv = version.dataVersion ?? 0;
  const info = (
    id: ExportFormat,
    available: boolean,
    recommended: boolean,
    reason?: string,
  ): FormatInfo => ({
    id,
    extension: FORMAT_EXTENSIONS[id],
    available,
    recommended: available && recommended,
    ...(available ? {} : { reason }),
  });
  return [
    info('schem', !legacy, !legacy, 'Sponge .schem needs Minecraft 1.13+; use .schematic.'),
    info(
      'schem3',
      !legacy && dv >= 3700,
      false,
      'Sponge v3 needs WorldEdit 7.3+ (Minecraft 1.20.4+).',
    ),
    info(
      'schematic',
      legacy,
      legacy,
      'The legacy .schematic format is only for Minecraft 1.8–1.12.',
    ),
    info('litematic', !legacy, false, 'Litematica exports here target 1.13+.'),
    info('nbt', !legacy, false, 'Structure files with modern block states need 1.13+.'),
    info('materials', true, false),
  ];
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  mime: string;
  warnings: string[];
}

export function safeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^A-Za-z0-9-_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'build';
}

export function exportBuild(format: ExportFormat, input: ExportInput): ExportResult {
  const fmt = formatsFor(input.version).find((f) => f.id === format);
  if (!fmt) throw new Error(`Unknown export format "${format}".`);
  if (!fmt.available) throw new Error(fmt.reason ?? `Format ${format} is not available.`);
  const base = safeFilename(input.name);
  const filename = `${base}${fmt.extension}`;
  switch (format) {
    case 'schem':
      return { ...writeSpongeV2(input), filename, mime: 'application/octet-stream' };
    case 'schem3':
      return { ...writeSpongeV3(input), filename, mime: 'application/octet-stream' };
    case 'schematic':
      return { ...writeMcEdit(input), filename, mime: 'application/octet-stream' };
    case 'litematic':
      return { ...writeLitematic(input), filename, mime: 'application/octet-stream' };
    case 'nbt':
      return { ...writeStructure(input), filename, mime: 'application/octet-stream' };
    case 'materials': {
      const cat = getCatalog(input.version);
      const csv = materialListCsv(materialList(input.volume), (item) => cat.displayName(item));
      return {
        buffer: Buffer.from(csv, 'utf8'),
        filename: `${base}_materials.csv`,
        mime: 'text/csv',
        warnings: [],
      };
    }
  }
}
