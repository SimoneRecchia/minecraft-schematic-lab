import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDir, minecraftDir } from '../paths';

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

export type Progress = (message: string, fraction?: number) => void;

/** A client jar already on disk: the player's launcher install, or one we downloaded before. */
export function findLocalJar(version: string): string | null {
  const candidates = [
    join(appDir('jars'), `${version}.jar`),
    join(minecraftDir(), 'versions', version, `${version}.jar`),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Download the official client jar for `version` from Mojang (only the textures and block models
 * are used, locally; nothing is redistributed). Verified against Mojang's SHA-1.
 */
export async function downloadClientJar(version: string, progress: Progress): Promise<string> {
  progress(`Fetching the Minecraft ${version} version list…`);
  const manifest = await fetchJson<{ versions: { id: string; url: string }[] }>(MANIFEST);
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) throw new Error(`Mojang does not list a version "${version}".`);
  const meta = await fetchJson<{
    downloads: { client: { url: string; sha1: string; size: number } };
  }>(entry.url);
  const { url, sha1, size } = meta.downloads.client;

  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received - lastReport > 1_000_000) {
      lastReport = received;
      progress(
        `Downloading Minecraft ${version} textures… ${Math.round((received / size) * 100)}%`,
        received / size,
      );
    }
  }
  const buffer = Buffer.concat(chunks);
  const digest = createHash('sha1').update(buffer).digest('hex');
  if (digest !== sha1) throw new Error('The downloaded client jar failed its checksum; try again.');
  const target = join(appDir('jars'), `${version}.jar`);
  writeFileSync(`${target}.part`, buffer);
  renameSync(`${target}.part`, target);
  return target;
}

export async function obtainClientJar(version: string, progress: Progress): Promise<Buffer> {
  const local = findLocalJar(version);
  if (local) {
    progress(`Using the Minecraft ${version} install found on this computer.`);
    return readFileSync(local);
  }
  if (process.env.MSL_OFFLINE === '1')
    throw new Error(`Minecraft ${version} is not installed and downloads are disabled.`);
  return readFileSync(await downloadClientJar(version, progress));
}
