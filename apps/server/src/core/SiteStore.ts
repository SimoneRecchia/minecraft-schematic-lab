import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { SiteVolume } from '@minecraft-schematic-lab/world';
import type { SiteInfo, Vec3 } from '@minecraft-schematic-lab/shared';
import { appDir } from '../paths';

export type SiteSource =
  | {
      kind: 'world';
      /** Absolute path of the world folder it was read from. */
      worldPath: string;
      worldName: string;
      dimension: string;
      center: Vec3 | [number, number];
      radius: number;
    }
  | { kind: 'schematic'; filename: string };

export interface StoredSite extends SiteVolume {
  info: SiteInfo;
  source: SiteSource;
}

interface SiteFile {
  info: SiteInfo;
  source: SiteSource;
  version: string;
  dataVersion: number | null;
  worldMin: Vec3;
  size: Vec3;
  origin: Vec3;
  writable: boolean;
  warnings: string[];
  palette: string[];
  blockEntities: SiteVolume['blockEntities'];
}

const ID = /^site_[a-z0-9]{8,32}$/;

/**
 * Imported sites (pieces of the player's worlds or schematics to build on), one folder each:
 *   <home>/sites/<id>/site.json (everything but the blocks), blocks.bin (gzip, Uint16 LE, YZX)
 */
export class SiteStore {
  private readonly root = appDir('sites');
  private cache: { id: string; site: StoredSite } | null = null;

  save(volume: SiteVolume, source: SiteSource, name: string): StoredSite {
    const id = `site_${randomBytes(6).toString('hex')}`;
    const dir = join(this.root, id);
    mkdirSync(dir, { recursive: true });
    let blocks = 0;
    for (let i = 0; i < volume.data.length; i++) if (volume.data[i] !== 0) blocks++;
    const info: SiteInfo = {
      id,
      name,
      kind: source.kind,
      version: volume.version,
      size: volume.size,
      worldMin: volume.worldMin,
      origin: volume.origin,
      writable: volume.writable && source.kind === 'world',
      blocks,
      createdAt: Date.now(),
      ...(source.kind === 'world'
        ? { world: source.worldName, dimension: source.dimension }
        : { file: source.filename }),
    };
    const file: SiteFile = {
      info,
      source,
      version: volume.version,
      dataVersion: volume.dataVersion,
      worldMin: volume.worldMin,
      size: volume.size,
      origin: volume.origin,
      writable: info.writable,
      warnings: volume.warnings,
      palette: volume.palette,
      blockEntities: volume.blockEntities,
    };
    const data = volume.data;
    writeFileSync(
      join(dir, 'blocks.bin'),
      gzipSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { level: 6 }),
    );
    writeFileSync(join(dir, 'site.json.tmp'), JSON.stringify(file));
    renameSync(join(dir, 'site.json.tmp'), join(dir, 'site.json'));
    const site: StoredSite = { ...volume, writable: info.writable, info, source };
    this.cache = { id, site };
    return site;
  }

  get(id: string): StoredSite | null {
    if (!ID.test(id)) return null;
    if (this.cache?.id === id) return this.cache.site;
    const dir = join(this.root, id);
    if (!existsSync(join(dir, 'site.json'))) return null;
    const file = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')) as SiteFile;
    const raw = gunzipSync(readFileSync(join(dir, 'blocks.bin')));
    const data = new Uint16Array(raw.length / 2);
    for (let i = 0; i < data.length; i++) data[i] = raw.readUInt16LE(i * 2);
    const site: StoredSite = {
      version: file.version,
      dataVersion: file.dataVersion,
      worldMin: file.worldMin,
      size: file.size,
      palette: file.palette,
      data,
      blockEntities: file.blockEntities,
      origin: file.origin,
      writable: file.writable,
      warnings: file.warnings,
      info: file.info,
      source: file.source,
    };
    this.cache = { id, site };
    return site;
  }

  list(): SiteInfo[] {
    const out: SiteInfo[] = [];
    for (const id of existsSync(this.root) ? readdirSync(this.root) : []) {
      if (!ID.test(id)) continue;
      try {
        const file = JSON.parse(readFileSync(join(this.root, id, 'site.json'), 'utf8')) as SiteFile;
        out.push(file.info);
      } catch {
        // half-written or foreign folder
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
}
