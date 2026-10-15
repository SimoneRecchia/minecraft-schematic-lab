#!/usr/bin/env node
// scripts/bundle.mjs
//
// Builds the Claude Code plugin in plugin/ (also what `npx github:SimoneRecchia/minecraft-schematic-lab
// --mcp` runs):
//
//   - apps/server/src/index.ts           ->  plugin/server/server.mjs   (esm, node22, executable)
//   - apps/web/dist/**                   ->  plugin/server/web/dist/**  (the browser viewer it serves)
//   - apps/server/guides/*.md            ->  plugin/server/guides/*.md  (building guides for read_guide)
//   - .claude/skills/minecraft-builder/  ->  plugin/skills/minecraft-builder/
//   - runtime npm deps                   ->  plugin/package.json (+ package-lock.json when they change)
//
// The workspace packages (@minecraft-schematic-lab/{shared,catalog,build-spec,
// block-compiler,formats}, including the block catalog JSON) are INLINED into server.mjs. The real npm deps stay
// EXTERNAL: Claude Code installs them from plugin/package-lock.json when it caches the plugin, and
// plugin/scripts/start-server.sh installs them itself when that didn't happen (this keeps the
// native @napi-rs/canvas binary out of the bundle, where esbuild can't put it anyway).
//
// Run AFTER the web viewer has been built (`pnpm build`, which produces
// apps/web/dist). Then: `node scripts/bundle.mjs`.

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, chmod, access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const serverEntry = resolve(repoRoot, 'apps/server/src/index.ts');
const webDistSrc = resolve(repoRoot, 'apps/web/dist');
const guidesSrc = resolve(repoRoot, 'apps/server/guides');
const skillSrc = resolve(repoRoot, '.claude/skills/minecraft-builder');
const pluginDir = resolve(repoRoot, 'plugin');
const outDir = resolve(pluginDir, 'server');
const outFile = resolve(outDir, 'server.mjs');
const webDistOut = resolve(outDir, 'web/dist');
const guidesOut = resolve(outDir, 'guides');
const skillOut = resolve(pluginDir, 'skills/minecraft-builder');

// Real npm deps: keep external so they install from plugin/package.json.
// MUST stay in sync with the runtime "dependencies" of the ROOT package.json (checked by
// apps/server/src/plugin.test.ts).
const external = [
  'fastify',
  '@fastify/static',
  '@modelcontextprotocol/sdk',
  '@napi-rs/canvas',
  'fast-json-patch',
  'fflate',
  'zod',
];

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** The exact version the workspace runs (and tests) with, so the plugin ships the same one. */
async function installedVersion(dep) {
  for (const base of ['apps/server/node_modules', 'node_modules']) {
    const file = resolve(repoRoot, base, dep, 'package.json');
    if (await exists(file)) return JSON.parse(await readFile(file, 'utf8')).version;
  }
  throw new Error(`${dep} is not installed. Run "pnpm install" first.`);
}

/**
 * The plugin's version follows the root package.json: installed plugins only update when it
 * changes, so bump it there for a release. So does the desktop extension's (mcpb/manifest.json,
 * packed by scripts/mcpb.mjs).
 */
async function syncPluginVersion(version) {
  const file = resolve(pluginDir, '.claude-plugin/plugin.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (manifest.version !== version) {
    // Keep `version` right after `displayName` so the manifest stays readable.
    const { name, displayName, ...rest } = manifest;
    delete rest.version;
    const next = { name, displayName, version, ...rest };
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  const mcpbFile = resolve(repoRoot, 'mcpb/manifest.json');
  const mcpb = JSON.parse(await readFile(mcpbFile, 'utf8'));
  if (mcpb.version !== version) {
    mcpb.version = version; // an existing key keeps its place
    await writeFile(mcpbFile, `${JSON.stringify(mcpb, null, 2)}\n`);
  }
}

/** plugin/package.json: the runtime deps pinned to the workspace versions. */
async function writeRuntimePackage() {
  const root = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
  await syncPluginVersion(root.version);
  const dependencies = {};
  for (const dep of Object.keys(root.dependencies).sort()) {
    dependencies[dep] = await installedVersion(dep);
  }
  const pkg = {
    name: 'minecraft-schematic-lab-plugin',
    version: root.version,
    private: true,
    type: 'module',
    description: 'Runtime dependencies of the bundled server (plugin/server/server.mjs).',
    license: root.license ?? 'MIT',
    engines: root.engines,
    dependencies,
  };
  await writeFile(resolve(pluginDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  return dependencies;
}

/** Regenerate plugin/package-lock.json only when the pinned deps changed (needs npm + network). */
async function syncLockfile(dependencies) {
  const lockFile = resolve(pluginDir, 'package-lock.json');
  if (await exists(lockFile)) {
    const lock = JSON.parse(await readFile(lockFile, 'utf8'));
    const locked = lock.packages?.['']?.dependencies ?? {};
    if (JSON.stringify(locked) === JSON.stringify(dependencies)) return;
  }
  process.stdout.write('Updating plugin/package-lock.json (npm)...\n');
  execFileSync(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: pluginDir, stdio: 'inherit', shell: process.platform === 'win32' },
  );
}

async function main() {
  if (!(await exists(serverEntry))) {
    throw new Error(`Server entry not found: ${serverEntry}`);
  }
  if (!(await exists(resolve(webDistSrc, 'index.html')))) {
    throw new Error(
      `Web viewer not built: ${webDistSrc}/index.html is missing. Run "pnpm build" first.`,
    );
  }

  // Clean the generated parts of the plugin (the manifests and the launcher are hand-written).
  await rm(outDir, { recursive: true, force: true });
  await rm(skillOut, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // 1) Bundle the server (workspace packages inlined, npm deps external).
  await build({
    entryPoints: [serverEntry],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    // Make the file directly executable as a CLI.
    banner: { js: '#!/usr/bin/env node' },
    external,
    logLevel: 'info',
  });
  await chmod(outFile, 0o755);

  // 2) Ship the browser viewer next to the bundle: plugin/server/web/dist/**.
  //    config.ts resolves './web/dist' relative to server.mjs -> plugin/server/web/dist.
  await mkdir(dirname(webDistOut), { recursive: true });
  await cp(webDistSrc, webDistOut, { recursive: true });

  // 3) The building guides served by the read_guide tool: plugin/server/guides/*.md.
  await cp(guidesSrc, guidesOut, { recursive: true });

  // 4) The skill (edited in .claude/skills, where it also serves this checkout).
  await cp(skillSrc, skillOut, { recursive: true });

  // 5) Runtime dependencies for the plugin.
  await syncLockfile(await writeRuntimePackage());

  process.stdout.write(
    `\nPlugin ready in ${pluginDir}:\n  ${outFile}\n  ${webDistOut}\n  ${guidesOut}\n  ${skillOut}\n`,
  );
}

main().catch((error) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`bundle.mjs failed: ${detail}\n`);
  process.exit(1);
});
