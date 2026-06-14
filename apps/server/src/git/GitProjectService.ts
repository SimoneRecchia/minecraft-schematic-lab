import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execa } from 'execa';
import { HttpError } from '../httpError';

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export interface CommitResult {
  committed: boolean;
  commit: string | null;
}

/**
 * Thin, safe wrapper around the `git` CLI. All calls use argument arrays (never shell strings),
 * only ever touch repo-local config (never --global), and never delete anything. Paths are
 * constrained to the user's home directory.
 */
export class GitProjectService {
  /** Resolve and validate a path: symlink-safe, must live under (not be) the home directory. */
  resolveSafePath(input: string): string {
    if (!input || !input.trim()) {
      throw new HttpError(400, 'A project path is required.');
    }
    const abs = isAbsolute(input) ? input : resolve(homedir(), input);

    let existing = abs;
    while (!existsSync(existing) && dirname(existing) !== existing) {
      existing = dirname(existing);
    }
    const realExisting = realpathSync(existing);
    const remainder = relative(existing, abs);
    const realAbs = remainder ? join(realExisting, remainder) : realExisting;

    const realHome = realpathSync(homedir());
    if (realAbs === realHome) {
      throw new HttpError(400, 'Refusing to use the home directory itself; pick a subfolder.');
    }
    if (!realAbs.startsWith(realHome + sep)) {
      throw new HttpError(400, 'Project path must be inside your home directory.');
    }
    return realAbs;
  }

  ensureDir(dir: string): void {
    mkdirSync(dir, { recursive: true });
  }

  async checkGitAvailable(): Promise<void> {
    try {
      await execa('git', ['--version']);
    } catch {
      throw new HttpError(500, 'git is not installed. Install git and try again.');
    }
  }

  async isRepo(dir: string): Promise<boolean> {
    try {
      const { stdout } = await execa('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async initRepo(dir: string): Promise<void> {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
  }

  async readLocalIdentity(dir: string): Promise<GitIdentity> {
    const get = async (key: string): Promise<string | null> => {
      try {
        const { stdout } = await execa('git', ['config', '--local', key], { cwd: dir });
        return stdout.trim() || null;
      } catch {
        return null;
      }
    };
    return { name: await get('user.name'), email: await get('user.email') };
  }

  async setLocalIdentity(dir: string, name: string, email: string): Promise<void> {
    await execa('git', ['config', '--local', 'user.name', name], { cwd: dir });
    await execa('git', ['config', '--local', 'user.email', email], { cwd: dir });
  }

  writeFiles(dir: string, files: Record<string, string>): void {
    this.ensureDir(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8');
    }
  }

  async commitAll(cwd: string, message: string): Promise<CommitResult> {
    await execa('git', ['add', '-A'], { cwd });
    const status = await execa('git', ['status', '--porcelain'], { cwd });
    if (!status.stdout.trim()) {
      return { committed: false, commit: null };
    }
    await execa('git', ['commit', '-m', message], { cwd });
    const head = await execa('git', ['rev-parse', 'HEAD'], { cwd });
    return { committed: true, commit: head.stdout.trim() };
  }

  async currentBranch(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async listBranches(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execa('git', ['branch', '--format=%(refname:short)'], { cwd });
      return stdout
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async createBranch(cwd: string, name: string): Promise<void> {
    this.assertGitRef(name, 'branch');
    await execa('git', ['branch', name], { cwd });
  }

  async checkoutBranch(cwd: string, name: string): Promise<void> {
    this.assertGitRef(name, 'branch');
    await execa('git', ['checkout', name], { cwd });
  }

  async remotes(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execa('git', ['remote'], { cwd });
      return stdout
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async setRemote(cwd: string, name: string, url: string): Promise<void> {
    this.assertGitRef(name, 'remote');
    this.assertRemoteUrl(url);
    const existing = await this.remotes(cwd);
    if (existing.includes(name)) {
      await execa('git', ['remote', 'set-url', name, url], { cwd });
    } else {
      await execa('git', ['remote', 'add', name, url], { cwd });
    }
  }

  async push(cwd: string, remote: string, branch: string): Promise<string> {
    this.assertGitRef(remote, 'remote');
    this.assertGitRef(branch, 'branch');
    const { stdout, stderr } = await execa('git', ['push', '--set-upstream', remote, branch], {
      cwd,
    });
    return [stdout, stderr].filter(Boolean).join('\n');
  }

  private assertGitRef(name: string, kind: 'branch' | 'remote'): void {
    if (typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, `A ${kind} name is required.`);
    }
    if (name.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(name)) {
      throw new HttpError(400, `Invalid ${kind} name: "${name}".`);
    }
  }

  private assertRemoteUrl(url: string): void {
    if (typeof url !== 'string' || !url.trim()) {
      throw new HttpError(400, 'A remote URL is required.');
    }
    if (url.startsWith('-') || !/^(https:\/\/|git@|ssh:\/\/)[\w@.:/~-]+$/.test(url)) {
      throw new HttpError(400, 'Remote URL must be an https or ssh git URL.');
    }
  }
}
