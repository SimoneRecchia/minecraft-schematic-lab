import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where projects, extracted game assets and exports live. Override with MSL_HOME. */
export function appHome(): string {
  const dir = process.env.MSL_HOME || join(homedir(), '.minecraft-schematic-lab');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function appDir(...parts: string[]): string {
  const dir = join(appHome(), ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The official launcher's game directory on this OS (may not exist). */
export function minecraftDir(): string {
  if (process.env.MINECRAFT_DIR) return process.env.MINECRAFT_DIR;
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'minecraft');
  if (process.platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), '.minecraft');
  return join(homedir(), '.minecraft');
}
