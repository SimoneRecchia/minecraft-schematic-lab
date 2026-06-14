#!/usr/bin/env node
// scripts/bundle.mjs
//
// Bundles the MCP/HTTP server into a single self-contained ESM file that can be
// run directly by `npx github:SimoneRecchia/minecraft-schematic-lab --mcp`.
//
//   - apps/server/src/index.ts  ->  bundle/server.mjs   (esm, node22, executable)
//   - apps/web/dist/**          ->  bundle/web/dist/**   (the browser viewer it serves)
//
// The three workspace packages (@minecraft-schematic-lab/{shared,build-spec,
// block-compiler}) are INLINED into server.mjs. The eight real npm deps stay
// EXTERNAL so npm installs them from `dependencies` at `npx` time (this keeps
// the native @napi-rs/canvas binary out of the bundle, where esbuild can't put
// it anyway).
//
// Run AFTER the web viewer has been built (`pnpm build`, which produces
// apps/web/dist). Then: `node scripts/bundle.mjs`.

import { build } from 'esbuild';
import { cp, mkdir, rm, chmod, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const serverEntry = resolve(repoRoot, 'apps/server/src/index.ts');
const webDistSrc = resolve(repoRoot, 'apps/web/dist');
const outDir = resolve(repoRoot, 'bundle');
const outFile = resolve(outDir, 'server.mjs');
const webDistOut = resolve(outDir, 'web/dist');

// Real npm deps: keep external so they install from package.json "dependencies".
// MUST stay in sync with the runtime "dependencies" of the ROOT package.json.
const external = [
  'fastify',
  '@fastify/static',
  '@modelcontextprotocol/sdk',
  '@napi-rs/canvas',
  'execa',
  'fast-json-patch',
  'prismarine-nbt',
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

async function main() {
  if (!(await exists(serverEntry))) {
    throw new Error(`Server entry not found: ${serverEntry}`);
  }
  if (!(await exists(resolve(webDistSrc, 'index.html')))) {
    throw new Error(
      `Web viewer not built: ${webDistSrc}/index.html is missing. Run "pnpm build" first.`,
    );
  }

  // Clean output.
  await rm(outDir, { recursive: true, force: true });
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

  // 2) Ship the browser viewer next to the bundle: bundle/web/dist/**.
  //    config.ts resolves './web/dist' relative to server.mjs -> bundle/web/dist.
  await mkdir(dirname(webDistOut), { recursive: true });
  await cp(webDistSrc, webDistOut, { recursive: true });

  process.stdout.write(`\nBundle ready:\n  ${outFile}\n  ${webDistOut}\n`);
}

main().catch((error) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`bundle.mjs failed: ${detail}\n`);
  process.exit(1);
});
