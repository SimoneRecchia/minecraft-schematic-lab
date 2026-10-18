// Second stage of the VibeSchem launchers (see ../.mcp.json), the same on every OS. The first
// stage, scripts/start-server (macOS, Linux) or scripts/start-server.cmd (Windows), finds Node 22+
// (or downloads it) and runs this file with it:
//
//   1. Runtime npm deps: Claude Code installs them from package-lock.json when it caches the
//      plugin. If that didn't happen (no npm on its PATH, older Claude Code, --plugin-dir), install
//      them here with this Node's own npm, once per plugin version.
//   2. Start the bundled server in MCP mode, in this same process.
//
// stdout is the MCP channel: everything this script says goes to stderr.
// `--check` does step 1 and reports, without starting the server.

import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(ROOT, '.install-lock');
const LOG = join(ROOT, '.install.log');
const check = process.argv.includes('--check');

const log = (message) => process.stderr.write(`vibeschem: ${message}\n`);
function die(message) {
  log(message);
  process.exit(1);
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// --- 1) Runtime dependencies ---------------------------------------------------------------------

function depsOk() {
  // .package-lock.json is written by npm at the very end of an install: a half-done one lacks it.
  if (!existsSync(join(ROOT, 'node_modules', '.package-lock.json'))) return false;
  const { dependencies } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const dep of Object.keys(dependencies)) {
    if (!existsSync(join(ROOT, 'node_modules', dep, 'package.json'))) return false;
  }
  try {
    // The native binary must match this OS and CPU.
    createRequire(join(ROOT, 'package.json'))('@napi-rs/canvas');
    return true;
  } catch {
    return false;
  }
}

/** npm's own entry point, next to this Node (or next to the path the first stage found it at). */
function findNpm() {
  const dirs = [dirname(process.execPath)];
  if (process.env.VIBESCHEM_NODE) dirs.push(dirname(process.env.VIBESCHEM_NODE));
  for (const dir of dirs) {
    for (const cli of [
      join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
      join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // macOS/Linux layout
    ]) {
      if (existsSync(cli)) return cli;
    }
    try {
      const cli = realpathSync(join(dir, 'npm')); // a symlink to npm-cli.js (Homebrew, distros)
      if (cli.endsWith('npm-cli.js')) return cli;
    } catch {
      // no npm there
    }
  }
  return null;
}

async function installDeps() {
  const npm = findNpm();
  if (!npm) die(`npm was not found next to ${process.execPath}.`);
  log(
    `Installing the server's dependencies with Node ${process.version} (one time, about a minute).`,
  );
  const out = openSync(LOG, 'w');
  // detached: if Claude Code gives up waiting and stops this launcher, the install still finishes
  // and the next start is instant.
  const npmProcess = spawn(
    process.execPath,
    [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'],
    { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true },
  );
  writeFileSync(join(LOCK, 'pid'), String(npmProcess.pid));
  const status = await new Promise((done) => {
    npmProcess.on('error', () => done(1));
    npmProcess.on('exit', (code) => done(code ?? 1));
  });
  closeSync(out);
  rmSync(LOCK, { recursive: true, force: true });
  if (status !== 0 || !depsOk()) {
    process.stderr.write(readFileSync(LOG, 'utf8'));
    die(`Installing the dependencies failed (log: ${LOG}). The first start needs internet.`);
  }
  log('Dependencies ready.');
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function ensureDeps() {
  if (depsOk()) return;
  for (let waited = 0; ; waited++) {
    try {
      mkdirSync(LOCK);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') die(`Cannot write to ${ROOT} to install the dependencies.`);
    }
    // Another Claude session is installing: wait for it, or take over if it died.
    let pid = 0;
    try {
      pid = Number(readFileSync(join(LOCK, 'pid'), 'utf8'));
    } catch {
      // not written yet
    }
    if ((pid && !alive(pid)) || (!pid && waited >= 10)) {
      rmSync(LOCK, { recursive: true, force: true }); // its owner died
      continue;
    }
    if (waited >= 600) die('Timed out waiting for another install to finish.');
    await sleep(1000);
    if (depsOk()) return;
  }
  if (depsOk()) {
    rmSync(LOCK, { recursive: true, force: true });
    return;
  }
  await installDeps();
}

await ensureDeps();

const server = join(ROOT, 'server', 'server.mjs');
if (check) {
  process.stdout.write(
    `Node: ${process.execPath} (${process.version})\nPlugin: ${ROOT}\nDependencies: ready\n` +
      `Server: ${server}\n` +
      'All set. If the tools are still missing, restart Claude (or reconnect the server in /mcp).\n',
  );
  process.exit(0);
}

// --- 2) Start ------------------------------------------------------------------------------------

process.argv.splice(2, Infinity, '--mcp');
await import(pathToFileURL(server).href);
