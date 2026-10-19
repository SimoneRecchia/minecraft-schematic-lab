import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { basename, dirname, join } from 'node:path';
import { getCompound, readNbt, str, writeNbt } from '@minecraft-schematic-lab/formats';
import { applyChanges, decodeChunk, MIN_WRITE_DATA_VERSION, type BlockChange } from './chunk';
import { RegionFile } from './region';
import { regionDir } from './saves';

function safeFolderName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\p{Cc}/gu, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 80) || 'World'
  );
}

/** Write next to the target and rename, so a crash never leaves half a file. */
function writeAtomic(file: string, data: Buffer): void {
  const tmp = `${file}.vibeschem-tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/**
 * Copy a world folder next to the original under a new name (never overwriting anything) and
 * rename it in level.dat so the game lists it separately. The original is only read.
 */
export async function copyWorld(
  worldDir: string,
  newName: string,
): Promise<{ path: string; folder: string; name: string }> {
  const parent = dirname(worldDir);
  const base = safeFolderName(newName);
  let folder = base;
  for (let i = 2; existsSync(join(parent, folder)); i++) folder = `${base} (${i})`;
  const dest = join(parent, folder);
  await cp(worldDir, dest, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (src) => basename(src) !== 'session.lock' && !src.endsWith('.vibeschem-tmp'),
  });
  const levelFile = join(dest, 'level.dat');
  const raw = readFileSync(levelFile);
  const gz = raw[0] === 0x1f && raw[1] === 0x8b;
  const { name: rootName, root } = readNbt(gz ? gunzipSync(raw) : raw);
  const data = getCompound(root, 'Data');
  if (data) data.LevelName = str(newName);
  const bytes = writeNbt(rootName, root);
  writeAtomic(levelFile, gz ? gzipSync(bytes) : bytes);
  return { path: dest, folder, name: newName };
}

export interface WriteReport {
  chunks: number;
  regions: number;
  blocks: number;
}

/**
 * Write block changes into a world's region files. Every chunk is checked before anything is
 * written: the area must be fully generated and saved by Minecraft 1.14 or newer.
 */
export function writeBlocks(
  worldDir: string,
  dimension: string,
  changes: readonly BlockChange[],
): WriteReport {
  const dir = regionDir(worldDir, dimension);
  if (!dir) throw new Error(`This world has no saved ${dimension} chunks.`);
  const byRegion = new Map<string, Map<string, BlockChange[]>>();
  for (const c of changes) {
    const cx = c.x >> 4;
    const cz = c.z >> 4;
    const rkey = `${cx >> 5},${cz >> 5}`;
    let chunks = byRegion.get(rkey);
    if (!chunks) byRegion.set(rkey, (chunks = new Map()));
    const ckey = `${cx},${cz}`;
    let list = chunks.get(ckey);
    if (!list) chunks.set(ckey, (list = []));
    list.push(c);
  }

  const external = (cx: number, cz: number): Buffer | null => {
    const f = join(dir, `c.${cx}.${cz}.mcc`);
    return existsSync(f) ? readFileSync(f) : null;
  };
  // Pass 1: decode and validate everything.
  const plans: {
    file: string;
    region: RegionFile;
    chunks: { cx: number; cz: number; nbt: Buffer }[];
  }[] = [];
  for (const [rkey, chunks] of byRegion) {
    const [rx, rz] = rkey.split(',').map(Number) as [number, number];
    const file = join(dir, `r.${rx}.${rz}.mca`);
    if (!existsSync(file))
      throw new Error(`Part of the area was never generated (region ${rx}, ${rz}).`);
    const region = RegionFile.parse(readFileSync(file), rx, rz, external);
    const out: { cx: number; cz: number; nbt: Buffer }[] = [];
    for (const [ckey, list] of chunks) {
      const [cx, cz] = ckey.split(',').map(Number) as [number, number];
      const bytes = region.read(cx, cz);
      if (!bytes)
        throw new Error(`Chunk ${cx}, ${cz} was never generated: walk there in the game first.`);
      const chunk = decodeChunk(bytes);
      if (!chunk.complete)
        throw new Error(
          `Chunk ${cx}, ${cz} is not fully generated yet: walk there in the game first.`,
        );
      if (chunk.format === 'legacy' || chunk.dataVersion < MIN_WRITE_DATA_VERSION)
        throw new Error(
          `Chunk ${cx}, ${cz} was saved by Minecraft 1.13 or older; writing worlds needs 1.14+.`,
        );
      out.push({ cx, cz, nbt: applyChanges(chunk, list) });
    }
    plans.push({ file, region, chunks: out });
  }
  // Pass 2: write.
  let chunkCount = 0;
  for (const plan of plans) {
    for (const c of plan.chunks) plan.region.write(c.cx, c.cz, c.nbt);
    chunkCount += plan.chunks.length;
    const { region, external: mcc } = plan.region.serialize();
    for (const [name, data] of mcc) writeAtomic(join(dir, name), data);
    writeAtomic(plan.file, region);
  }
  // A leftover .mcc of a chunk that now fits in the region file is ignored by the game.
  return { chunks: chunkCount, regions: plans.length, blocks: changes.length };
}
