#!/usr/bin/env node
// scripts/gen-catalog.mjs
//
// Generates packages/catalog/data/catalog.json — the per-version block catalog the compiler uses to
// enforce "only blocks that exist in the chosen Minecraft version", plus the DataVersion table and
// the 1.12 -> 1.13 flattening table used by the legacy .schematic writer.
//
// Source: PrismarineJS/minecraft-data (fetched from GitHub; cached under $TMPDIR). Re-run when a new
// Minecraft version ships:  node scripts/gen-catalog.mjs

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const outFile = resolve(repoRoot, 'packages/catalog/data/catalog.json');
const RAW = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data';
const cacheDir = join(tmpdir(), 'msl-minecraft-data');

async function fetchJson(path) {
  const cached = join(cacheDir, path);
  if (existsSync(cached) && !process.env.REFRESH) return JSON.parse(readFileSync(cached, 'utf8'));
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, text);
  return JSON.parse(text);
}

const RELEASE = /^\d+\.\d+(\.\d+)?$/;

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Some minecraft-data releases omit int property values; fill them from another release.
const knownValues = new Map();

/** Minecraft orders boolean property values true, false. */
function propValues(state, blockName) {
  if (state.type === 'bool') return ['true', 'false'];
  if (state.values) return state.values.map(String);
  const known = knownValues.get(`${blockName}.${state.name}`);
  if (known && known.length === state.num_values) return known;
  return Array.from({ length: state.num_values }, (_, i) => String(i));
}

/** Decode a block's default property values from defaultState - minStateId (last property fastest). */
function defaultIndices(block) {
  const states = block.states ?? [];
  const radices = states.map((s) => propValues(s, block.name).length);
  let rem = (block.defaultState ?? 0) - (block.minStateId ?? 0);
  const out = new Array(states.length).fill(0);
  for (let i = states.length - 1; i >= 0; i--) {
    const r = radices[i];
    out[i] = rem % r;
    rem = Math.floor(rem / r);
  }
  return out;
}

async function main() {
  const dataPaths = await fetchJson('dataPaths.json');
  const protocol = await fetchJson('pc/common/protocolVersions.json');
  const legacy = await fetchJson('pc/common/legacy.json');

  const pcPaths = dataPaths.pc;
  const dataKeys = Object.keys(pcPaths).filter((v) => RELEASE.test(v) && pcPaths[v].blocks);
  dataKeys.sort(cmpVersion);

  // Every release from 1.8 with its DataVersion.
  const releases = protocol
    .filter((e) => RELEASE.test(e.minecraftVersion) && cmpVersion(e.minecraftVersion, '1.8') >= 0)
    .map((e) => ({ id: e.minecraftVersion, dataVersion: e.dataVersion ?? null }));
  const seen = new Set();
  const versions = [];
  for (const r of releases) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    // Nearest minecraft-data release at or below this version provides the block list.
    let datasetKey = null;
    for (const k of dataKeys) if (cmpVersion(k, r.id) <= 0) datasetKey = k;
    if (!datasetKey) continue;
    versions.push({ id: r.id, dataVersion: r.dataVersion, dataset: pcPaths[datasetKey].blocks });
  }
  versions.sort((a, b) => cmpVersion(b.id, a.id));

  const datasetPaths = [...new Set(versions.map((v) => v.dataset))];
  const sigs = [];
  const sigIndex = new Map();
  const sigOf = (props) => {
    const key = JSON.stringify(props);
    let idx = sigIndex.get(key);
    if (idx === undefined) {
      idx = sigs.length;
      sigs.push(props);
      sigIndex.set(key, idx);
    }
    return idx;
  };
  const displayNames = {};
  const datasets = {};
  const flatBlocks = {};

  for (const path of datasetPaths) {
    const blocks = await fetchJson(`${path}/blocks.json`);
    for (const b of blocks) {
      for (const st of b.states ?? []) {
        if (st.values) knownValues.set(`${b.name}.${st.name}`, st.values.map(String));
      }
    }
  }

  // Modern (flattened, 1.13+) datasets first: block name -> property signature.
  for (const path of datasetPaths) {
    const blocks = await fetchJson(`${path}/blocks.json`);
    if (!blocks[0] || !('states' in blocks[0] || 'minStateId' in blocks[0])) continue; // legacy format
    const names = [];
    const sigList = [];
    for (const b of blocks) {
      const states = b.states ?? [];
      const defs = defaultIndices(b);
      const props = states.map((s, i) => [s.name, propValues(s, b.name), defs[i]]);
      names.push(b.name);
      sigList.push(sigOf(props));
      displayNames[b.name] = b.displayName;
    }
    datasets[path] = { legacy: false, names: names.join(' '), sigs: sigList };
    flatBlocks[path] = new Map(names.map((n, i) => [n, sigList[i]]));
  }

  // Legacy (1.8–1.12) datasets: expressed in 1.13 flattened names, so specs always use modern ids.
  const flat113Path = pcPaths['1.13.2'].blocks;
  const flat113 = flatBlocks[flat113Path];
  const legacy112 = await fetchJson(`${pcPaths['1.12.2'].blocks}/blocks.json`);
  const variations112 = new Map(
    legacy112.map((b) => [b.id, new Set((b.variations ?? []).map((v) => v.metadata))]),
  );
  for (const path of datasetPaths) {
    if (datasets[path]) continue;
    const blocks = await fetchJson(`${path}/blocks.json`);
    const byId = new Map(blocks.map((b) => [b.id, b]));
    // Highest numeric block id per legacy release (minecraft-data's 1.10 list is a copy of 1.9,
    // missing magma, nether wart block, red nether bricks, bone block, structure void).
    const MAX_ID = { 'pc/1.8': 197, 'pc/1.9': 212, 'pc/1.10': 217, 'pc/1.11': 234, 'pc/1.12': 252 };
    const maxId = MAX_ID[path] ?? 252;
    const ref112 = new Map(legacy112.map((b) => [b.id, b]));
    for (const [id, b] of ref112) if (id <= maxId && !byId.has(id)) byId.set(id, b);
    if (path !== 'pc/1.8') byId.set(255, ref112.get(255));
    const available = new Set();
    for (const [key, state] of Object.entries(legacy.blocks)) {
      const [idStr, metaStr] = key.split(':');
      const id = Number(idStr);
      const meta = Number(metaStr);
      const block = byId.get(id);
      if (!block || (id > maxId && id !== 255)) continue;
      // A metadata variant added later under an existing id (rare) is not available yet.
      const own = new Set((block.variations ?? []).map((v) => v.metadata));
      const later = variations112.get(id);
      if (own.size > 0 && later?.has(meta) && !own.has(meta)) continue;
      const name = state.replace(/^minecraft:/, '').replace(/\[.*$/, '');
      if (flat113.has(name)) available.add(name);
    }
    const names = [...available].sort();
    datasets[path] = {
      legacy: true,
      names: names.join(' '),
      sigs: names.map((n) => flat113.get(n)),
    };
  }

  // minecraft-data includes blocks that were only behind experimental toggles in these releases
  // (e.g. cherry in 1.19.4, crafter in 1.20.3, pale oak in 1.21.2). A schematic for a normal world
  // of that version must not use them, so derive "released blocks only" datasets.
  const EXPERIMENTAL = [
    { match: /^1\.19\.[34]$/, base: '1.19.2' },
    { match: /^1\.20\.[3-6]$/, base: '1.20.2' },
    { match: /^1\.21\.[23]$/, base: '1.21.1' },
  ];
  const KEEP_RENAMED = new Set(['short_grass']);
  for (const v of versions) {
    const rule = EXPERIMENTAL.find((r) => r.match.test(v.id));
    if (!rule) continue;
    const derived = `${v.dataset}~released`;
    if (!datasets[derived]) {
      const base = new Set(datasets[pcPaths[rule.base].blocks].names.split(' '));
      const src = datasets[v.dataset];
      const names = [];
      const sigList = [];
      src.names.split(' ').forEach((n, i) => {
        if (base.has(n) || KEEP_RENAMED.has(n)) {
          names.push(n);
          sigList.push(src.sigs[i]);
        }
      });
      datasets[derived] = { legacy: false, names: names.join(' '), sigs: sigList };
    }
    v.dataset = derived;
  }
  for (const key of Object.keys(datasets)) {
    if (!versions.some((v) => v.dataset === key)) delete datasets[key];
  }

  // Compact form: one global name table; each dataset is a flat [nameIndex, sigIndex, ...] list.
  const allNames = [...new Set(Object.values(datasets).flatMap((d) => d.names.split(' ')))].sort();
  const nameIdx = new Map(allNames.map((n, i) => [n, i]));
  const compactDatasets = {};
  for (const [path, d] of Object.entries(datasets)) {
    const flat = [];
    d.names.split(' ').forEach((n, i) => flat.push(nameIdx.get(n), d.sigs[i]));
    compactDatasets[path] = { legacy: d.legacy, blocks: flat };
  }

  // Blocks whose collision shape is a full cube in every state (newest data): fences, walls and
  // panes connect to these, like the game does when you place them.
  const newest = datasetPaths.find((p) => !datasets[p].legacy);
  const shapes = await fetchJson(`${newest}/blockCollisionShapes.json`);
  const isFull = (id) => JSON.stringify(shapes.shapes[String(id)]) === '[[0,0,0,1,1,1]]';
  const fullCubes = Object.entries(shapes.blocks)
    .filter(([, v]) => (Array.isArray(v) ? v.every(isFull) : isFull(v)))
    .map(([n]) => n)
    .sort();

  const catalog = {
    source: 'PrismarineJS/minecraft-data (master)',
    generatedAt: new Date().toISOString().slice(0, 10),
    versions,
    names: allNames,
    datasets: compactDatasets,
    sigs,
    displayNames,
    fullCubes,
    legacyBlocks: legacy.blocks,
  };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(catalog));
  const kb = Math.round(JSON.stringify(catalog).length / 1024);
  process.stdout.write(
    `Wrote ${outFile}: ${versions.length} versions, ${Object.keys(datasets).length} datasets, ${sigs.length} signatures, ${kb} KB\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`gen-catalog failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
