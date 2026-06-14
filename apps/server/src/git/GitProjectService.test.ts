import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitProjectService } from './GitProjectService';

const git = new GitProjectService();

describe('GitProjectService.resolveSafePath', () => {
  it('accepts a path inside the home directory', () => {
    const resolved = git.resolveSafePath(join(homedir(), 'schematic-projects', 'castle'));
    expect(resolved.startsWith(homedir())).toBe(true);
  });

  it('rejects a path outside the home directory', () => {
    expect(() => git.resolveSafePath('/etc/passwd')).toThrow();
  });

  it('rejects the home directory itself', () => {
    expect(() => git.resolveSafePath(homedir())).toThrow();
  });

  it('rejects an empty path', () => {
    expect(() => git.resolveSafePath('')).toThrow();
  });
});

describe('GitProjectService argument validation', () => {
  const dir = join(homedir(), 'does-not-need-to-exist');

  it('rejects flag-like branch names', async () => {
    await expect(git.createBranch(dir, '--force')).rejects.toThrow();
    await expect(git.checkoutBranch(dir, '-x')).rejects.toThrow();
  });

  it('rejects flag-like remote names and bad urls', async () => {
    await expect(git.setRemote(dir, '-origin', 'https://example.com/r.git')).rejects.toThrow();
    await expect(git.setRemote(dir, 'origin', '--upload-pack=evil')).rejects.toThrow();
    await expect(git.setRemote(dir, 'origin', 'file:///etc')).rejects.toThrow();
  });
});
