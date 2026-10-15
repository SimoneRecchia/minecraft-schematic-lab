import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetStatus, BakedBlock } from '@minecraft-schematic-lab/shared';
import { appDir } from '../paths';
import { buildPack, type PackData } from './buildPack';
import { obtainClientJar } from './clientJar';
import { ModelBaker } from './ModelBaker';

/** Bump when the cached pack layout changes so old caches are rebuilt. */
const PACK_FORMAT = 3;

export interface LoadedPack {
  data: PackData;
  atlas: Buffer;
  baker: ModelBaker;
}

/**
 * Official textures and block models per Minecraft version, extracted once from the client jar
 * (the player's own install when present, otherwise Mojang's servers) and cached on disk.
 */
export class AssetStore {
  private readonly packs = new Map<string, LoadedPack>();
  private readonly loading = new Map<string, Promise<LoadedPack>>();
  private readonly status = new Map<string, AssetStatus>();

  constructor(private readonly onStatus: (s: AssetStatus) => void = () => {}) {}

  getStatus(version: string): AssetStatus {
    if (this.packs.has(version)) return { version, state: 'ready' };
    return this.status.get(version) ?? { version, state: 'missing' };
  }

  peek(version: string): LoadedPack | undefined {
    return this.packs.get(version);
  }

  private setStatus(s: AssetStatus): void {
    this.status.set(s.version, s);
    this.onStatus(s);
  }

  ensure(version: string): Promise<LoadedPack> {
    const ready = this.packs.get(version);
    if (ready) return Promise.resolve(ready);
    let p = this.loading.get(version);
    if (!p) {
      p = this.load(version).finally(() => this.loading.delete(version));
      this.loading.set(version, p);
    }
    return p;
  }

  private async load(version: string): Promise<LoadedPack> {
    const dir = appDir('assets', version);
    const packFile = join(dir, 'pack.json');
    const atlasFile = join(dir, 'atlas.png');
    try {
      let data: PackData | null = null;
      let atlas: Buffer | null = null;
      if (existsSync(packFile) && existsSync(atlasFile)) {
        const parsed = JSON.parse(readFileSync(packFile, 'utf8')) as PackData & { format?: number };
        if (parsed.format === PACK_FORMAT) {
          data = parsed;
          atlas = readFileSync(atlasFile);
        }
      }
      if (!data || !atlas) {
        this.setStatus({
          version,
          state: 'loading',
          message: `Preparing Minecraft ${version} textures…`,
        });
        const progress = (message: string, fraction?: number) =>
          this.setStatus({
            version,
            state: 'loading',
            message,
            ...(fraction !== undefined ? { progress: fraction } : {}),
          });
        const jar = await obtainClientJar(version, progress);
        const built = await buildPack(version, jar, progress);
        data = built.data;
        atlas = built.atlas;
        writeFileSync(packFile, JSON.stringify({ format: PACK_FORMAT, ...data }));
        writeFileSync(atlasFile, atlas);
      }
      const pack: LoadedPack = { data, atlas, baker: new ModelBaker(data) };
      this.packs.set(version, pack);
      this.setStatus({ version, state: 'ready' });
      return pack;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ version, state: 'error', message });
      throw error;
    }
  }

  async bake(version: string, states: string[]): Promise<Record<string, BakedBlock>> {
    const pack = await this.ensure(version);
    const out: Record<string, BakedBlock> = {};
    for (const s of states) out[s] = pack.baker.bake(s);
    return out;
  }
}
