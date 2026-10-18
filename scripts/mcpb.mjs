#!/usr/bin/env node
// scripts/mcpb.mjs
//
// Builds the Claude Desktop extension (the Chat tab's double-click install) from the plugin output:
//
//   mcpb/{manifest.json,icon.png,.mcpbignore} -> dist/mcpb/   (bundle.mjs syncs the version)
//   plugin/server/**                   ->  dist/mcpb/server/**         (server.mjs, viewer, guides)
//   plugin/package{,-lock}.json        ->  dist/mcpb/node_modules      (npm ci --omit=dev)
//   + the @napi-rs/canvas binary of every platform in CANVAS_PLATFORMS (from the lockfile, checked)
//   dist/mcpb                          ->  dist/vibeschem.mcpb                 (mcpb pack)
//   plugin/skills/minecraft-builder    ->  dist/minecraft-builder-skill.zip    (Customize > Skills)
//
// Claude Desktop runs `node server.mjs` with its own built-in Node (24.x), so players need nothing
// installed. The canvas module is N-API: one binary per OS/CPU works with any Node >= 22, so a single
// .mcpb carries the four binaries Claude Desktop can need (macOS arm64/x64, Windows x64/arm64).
//
// Then the packed file is smoke-tested: unpacked, started over stdio like Claude Desktop does, and
// checked to list exactly the manifest's tools and to answer read_guide.
//
//   node scripts/mcpb.mjs                          build + check (run `pnpm bundle` first; `pnpm mcpb` does both)
//   node scripts/mcpb.mjs --check [file.mcpb]      check only
//         [--node <binary>]                        ...with another Node (an Electron binary works too)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { unzipSync, zipSync } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const pluginDir = resolve(repoRoot, 'plugin');
const srcDir = resolve(repoRoot, 'mcpb');
const distDir = resolve(repoRoot, 'dist');
const stageDir = resolve(distDir, 'mcpb');
const mcpbFile = resolve(distDir, 'vibeschem.mcpb');
const skillDir = resolve(pluginDir, 'skills/minecraft-builder');
const skillZip = resolve(distDir, 'minecraft-builder-skill.zip');
const mcpbCli = resolve(repoRoot, 'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');

/** The platforms Claude Desktop runs on (it has no Linux build). */
const CANVAS_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64-msvc', 'win32-arm64-msvc'];

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const log = (line) => process.stdout.write(`${line}\n`);

/** mcpb/manifest.json, whose version scripts/bundle.mjs keeps equal to the root package.json's. */
async function readManifest() {
  const { version } = await readJson(resolve(repoRoot, 'package.json'));
  const manifest = await readJson(resolve(srcDir, 'manifest.json'));
  if (manifest.version !== version) {
    throw new Error(
      `mcpb/manifest.json is at ${manifest.version}, not ${version}: run "pnpm bundle".`,
    );
  }
  return manifest;
}

/** Minimal tar reader for an npm package tarball: regular files only, `package/` stripped. */
function untar(tar, destDir) {
  const files = [];
  let longName = null;
  for (let off = 0; off + 512 <= tar.length; ) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) =>
      header
        .subarray(start, start + len)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      // pax header: keep a long `path` for the next entry
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      longName = m ? m[1] : null;
      continue;
    }
    if (type !== '0') continue;
    const prefix = field(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    const rel = name.replace(/^package\//, '');
    const target = resolve(destDir, rel);
    if (!target.startsWith(destDir + sep)) throw new Error(`Unsafe path in tarball: ${name}`);
    files.push({ target, body });
  }
  return files;
}

/**
 * npm only installs the canvas binary of the machine it runs on; add the others from the exact
 * tarballs pinned in plugin/package-lock.json, checking each one's sha512.
 */
async function addCanvasBinaries() {
  const lock = await readJson(resolve(pluginDir, 'package-lock.json'));
  for (const platform of CANVAS_PLATFORMS) {
    const key = `node_modules/@napi-rs/canvas-${platform}`;
    const dest = resolve(stageDir, key);
    if (await exists(resolve(dest, 'package.json'))) continue; // npm installed this one
    const entry = lock.packages?.[key];
    if (!entry?.resolved || !entry.integrity)
      throw new Error(`${key} is missing from the lockfile.`);
    const response = await fetch(entry.resolved);
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${entry.resolved}`);
    const tgz = Buffer.from(await response.arrayBuffer());
    const expected = entry.integrity
      .split(/\s+/)
      .find((h) => h.startsWith('sha512-'))
      ?.slice('sha512-'.length);
    const actual = createHash('sha512').update(tgz).digest('base64');
    if (actual !== expected) throw new Error(`Integrity check failed for ${entry.resolved}`);
    for (const { target, body } of untar(gunzipSync(tgz), dest)) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    }
    log(`  + @napi-rs/canvas-${platform}`);
  }
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath, entry.name));
  }
  return out.sort();
}

/** The building skill, zipped as Claude's skill upload expects: minecraft-builder/SKILL.md. */
async function zipSkill() {
  const files = {};
  for (const file of await listFiles(skillDir)) {
    const name = ['minecraft-builder', ...relative(skillDir, file).split(sep)].join('/');
    files[name] = new Uint8Array(await readFile(file));
  }
  await writeFile(skillZip, zipSync(files, { level: 9 }));
}

async function build() {
  if (!(await exists(resolve(pluginDir, 'server/server.mjs')))) {
    throw new Error(
      'plugin/server/server.mjs is missing. Run "pnpm bundle" first (or "pnpm mcpb").',
    );
  }
  const manifest = await readManifest();

  log(`Staging ${relative(repoRoot, stageDir)}...`);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await cp(resolve(pluginDir, 'server'), resolve(stageDir, 'server'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) {
    await cp(resolve(pluginDir, f), resolve(stageDir, f));
  }
  for (const f of ['manifest.json', 'icon.png', '.mcpbignore']) {
    await cp(resolve(srcDir, f), resolve(stageDir, f));
  }
  if (await exists(resolve(repoRoot, 'LICENSE'))) {
    await cp(resolve(repoRoot, 'LICENSE'), resolve(stageDir, 'LICENSE'));
  }

  log('Installing the runtime dependencies (npm ci)...');
  execFileSync(
    'npm',
    ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'],
    { cwd: stageDir, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  await addCanvasBinaries();

  await rm(mcpbFile, { force: true });
  execFileSync(process.execPath, [mcpbCli, 'pack', stageDir, mcpbFile], { stdio: 'inherit' });
  await zipSkill();
  log(`\nBuilt ${manifest.name} ${manifest.version}:`);
  log(`  ${relative(repoRoot, mcpbFile)}`);
  log(`  ${relative(repoRoot, skillZip)}`);
}

/**
 * Claude Desktop refuses the whole extension ("Unsafe file path detected") when an entry looks like
 * path traversal; it flags any ".." in a name, even "do..ts.txt". Also stay under its count limit.
 */
function checkInstallable(names) {
  const unsafe = names.filter((n) => n.includes('..') || n.startsWith('/') || /[\\:]/.test(n));
  if (unsafe.length > 0) {
    throw new Error(
      `Claude Desktop would refuse these paths; exclude them in mcpb/.mcpbignore:\n  ${unsafe.join('\n  ')}`,
    );
  }
  if (names.length > 100_000) throw new Error(`Too many files for Claude Desktop: ${names.length}`);
}

/**
 * Start the packed server the way Claude Desktop does (`node ${__dirname}/server/server.mjs --mcp`
 * over stdio) and check it lists exactly the manifest's tools and answers read_guide.
 */
async function check(file, node) {
  const dir = await mkdtemp(join(tmpdir(), 'msl-mcpb-check-'));
  try {
    const entries = unzipSync(new Uint8Array(await readFile(file)));
    checkInstallable(Object.keys(entries));
    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith('/')) continue;
      const target = resolve(dir, name);
      if (!target.startsWith(dir + sep)) throw new Error(`Unsafe path in ${file}: ${name}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
    const manifest = await readJson(join(dir, 'manifest.json'));
    const { command, args } = manifest.server.mcp_config;
    if (command !== 'node') throw new Error(`Expected command "node", got "${command}".`);
    const transport = new StdioClientTransport({
      command: node,
      args: args.map((a) => a.replaceAll('${__dirname}', dir)),
      env: {
        ...process.env,
        MSL_HOME: join(dir, '.msl-home'), // don't touch the player's projects
        MSL_NO_BROWSER: '1',
        PORT: '8790', // stay clear of a running 8765 (the server takes the next free port anyway)
        ELECTRON_RUN_AS_NODE: '1', // lets --node point at an Electron binary; ignored by Node
      },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => (stderr += chunk));
    const client = new Client({ name: 'mcpb-check', version: '1.0.0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const served = tools.map((t) => t.name).sort();
      const declared = manifest.tools.map((t) => t.name).sort();
      if (JSON.stringify(served) !== JSON.stringify(declared)) {
        throw new Error(
          `The server's tools don't match mcpb/manifest.json.\n  server:   ${served.join(', ')}\n  manifest: ${declared.join(', ')}`,
        );
      }
      const guide = await client.callTool({ name: 'read_guide', arguments: { topic: 'workflow' } });
      const text = guide.content?.find((c) => c.type === 'text')?.text ?? '';
      if (guide.isError || text.length < 200) throw new Error(`read_guide failed: ${text}`);
      const runtime = await client.getServerVersion();
      log(
        `Check passed: ${file === mcpbFile ? relative(repoRoot, file) : file} starts with ${node}, ` +
          `serves ${served.length} tools (${runtime?.name} ${runtime?.version}) and read_guide.`,
      );
    } catch (error) {
      if (stderr) process.stderr.write(`--- server stderr ---\n${stderr}\n`);
      throw error;
    } finally {
      await client.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const nodeAt = argv.indexOf('--node');
  const node = nodeAt >= 0 ? argv[nodeAt + 1] : process.execPath;
  if (!node) throw new Error('--node needs a path.');
  if (argv.includes('--check')) {
    const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--node');
    await check(file ? resolve(file) : mcpbFile, node);
    return;
  }
  await build();
  await check(mcpbFile, node);
}

main().catch((error) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`mcpb.mjs failed: ${detail}\n`);
  process.exit(1);
});
