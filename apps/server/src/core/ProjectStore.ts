import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { BuildSpec } from '@minecraft-schematic-lab/build-spec';
import type { FeedbackItem, ProjectInfo, VersionSummary } from '@minecraft-schematic-lab/shared';
import { appDir, appHome } from '../paths';

export interface VersionRecord extends VersionSummary {
  spec: BuildSpec;
}

interface ProjectFile extends ProjectInfo {
  history: VersionSummary[];
}

function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return s || 'build';
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 1));
  renameSync(`${path}.tmp`, path);
}

/**
 * Projects on disk: every build is a project with its full version history and the user's
 * feedback notes, so nothing is lost between Claude sessions.
 *   <home>/projects/<id>/project.json, versions/0001.json…, feedback.json
 */
export class ProjectStore {
  private readonly root = appDir('projects');

  private dir(id: string): string {
    return join(this.root, id);
  }

  private read(id: string): ProjectFile {
    const file = join(this.dir(id), 'project.json');
    if (!existsSync(file)) throw new Error(`Project not found: ${id}`);
    return JSON.parse(readFileSync(file, 'utf8')) as ProjectFile;
  }

  private write(p: ProjectFile): void {
    writeJson(join(this.dir(p.id), 'project.json'), p);
  }

  list(): ProjectInfo[] {
    if (!existsSync(this.root)) return [];
    const out: ProjectInfo[] = [];
    for (const id of readdirSync(this.root)) {
      try {
        const { history: _history, ...info } = this.read(id);
        out.push(info);
      } catch {
        // skip unreadable folders
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): ProjectInfo {
    const { history: _history, ...info } = this.read(id);
    return info;
  }

  exists(id: string): boolean {
    return existsSync(join(this.dir(id), 'project.json'));
  }

  create(name: string, minecraftVersion: string): ProjectInfo {
    const base = slug(name);
    let id = base;
    for (let i = 2; existsSync(this.dir(id)); i++) id = `${base}-${i}`;
    mkdirSync(join(this.dir(id), 'versions'), { recursive: true });
    const now = Date.now();
    const p: ProjectFile = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      minecraftVersion,
      versions: 0,
      blockCount: 0,
      history: [],
    };
    this.write(p);
    return this.get(id);
  }

  history(id: string): VersionSummary[] {
    return this.read(id).history;
  }

  getVersion(id: string, n: number): VersionRecord {
    const file = join(this.dir(id), 'versions', `${String(n).padStart(4, '0')}.json`);
    if (!existsSync(file)) throw new Error(`Version ${n} of ${id} not found.`);
    return JSON.parse(readFileSync(file, 'utf8')) as VersionRecord;
  }

  latestVersion(id: string): VersionRecord | null {
    const p = this.read(id);
    const last = p.history[p.history.length - 1];
    return last ? this.getVersion(id, last.n) : null;
  }

  addVersion(id: string, record: Omit<VersionRecord, 'n'>): VersionRecord {
    const p = this.read(id);
    const n = (p.history[p.history.length - 1]?.n ?? 0) + 1;
    const full: VersionRecord = { ...record, n };
    writeJson(join(this.dir(id), 'versions', `${String(n).padStart(4, '0')}.json`), full);
    const { spec: _spec, ...summary } = full;
    p.history.push(summary);
    p.versions = p.history.length;
    p.updatedAt = full.createdAt;
    p.name = record.spec.name;
    p.minecraftVersion = record.spec.minecraftVersion;
    p.blockCount = record.blockCount;
    this.write(p);
    return full;
  }

  rename(id: string, name: string): ProjectInfo {
    const p = this.read(id);
    p.name = name;
    this.write(p);
    return this.get(id);
  }

  /** Moves the project to <home>/trash (recoverable by hand). */
  remove(id: string): void {
    const trash = appDir('trash');
    renameSync(this.dir(id), join(trash, `${id}-${Date.now()}`));
  }

  feedback(id: string): FeedbackItem[] {
    const file = join(this.dir(id), 'feedback.json');
    if (!existsSync(file)) return [];
    return JSON.parse(readFileSync(file, 'utf8')) as FeedbackItem[];
  }

  saveFeedback(id: string, items: FeedbackItem[]): void {
    writeJson(join(this.dir(id), 'feedback.json'), items);
  }

  get currentId(): string | null {
    const file = join(appHome(), 'state.json');
    if (!existsSync(file)) return null;
    try {
      const id = (JSON.parse(readFileSync(file, 'utf8')) as { current?: string }).current ?? null;
      return id && this.exists(id) ? id : null;
    } catch {
      return null;
    }
  }

  set currentId(id: string | null) {
    writeJson(join(appHome(), 'state.json'), { current: id });
  }
}
