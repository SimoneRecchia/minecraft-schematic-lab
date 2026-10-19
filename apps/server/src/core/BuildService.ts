import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import jsonpatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import {
  BlockVolume,
  BuildSpecError,
  compileBuildSpec,
  nodeScriptRunner,
  worldFor,
  type CompileResult,
} from '@minecraft-schematic-lab/block-compiler';
import {
  circuitIoSchema,
  circuitTestSchema,
  type BuildSpec,
  type CircuitDefinition,
  type CircuitTest,
} from '@minecraft-schematic-lab/build-spec';
import {
  assetVersionFor,
  blockDataIsOlder,
  blockNameOf,
  catalogData,
  getCatalog,
  resolveVersion,
} from '@minecraft-schematic-lab/catalog';
import {
  formatReport,
  runCircuit,
  type CircuitReport,
  type CircuitSpec,
  type TestSpec,
} from '@minecraft-schematic-lab/redstone';
import {
  exportBuild,
  formatsFor,
  readSchematic,
  writeDatapack,
  type DatapackOutput,
  type ExportFormat,
  type ExportResult,
} from '@minecraft-schematic-lab/formats';
import type {
  BuildHeader,
  FeedbackItem,
  InspectResult,
  ProjectInfo,
  SimInfo,
  SiteInfo,
  Vec3,
  ViewName,
  ExportTarget,
  WorldInfo,
} from '@minecraft-schematic-lab/shared';
import {
  copyWorld,
  listWorlds,
  MAX_SITE_RADIUS,
  OVERWORLD,
  readWorld,
  readWorldSite,
  siteFromSchematic,
  writeBlocks,
  type WorldSummary,
} from '@minecraft-schematic-lab/world';
import { augmentCatalog } from '../assets/augment';
import type { AssetStore } from '../assets/AssetStore';
import type { AppConfig } from '../config';
import { openViewer } from '../openBrowser';
import { minecraftDir } from '../paths';
import { renderIsometric, defaultColors, type ColorSource } from '../render/renderIsometric';
import type { CaptureBroker, CapturedImage } from './CaptureBroker';
import { applyEdits, type Edit } from './edits';
import type { EventHub } from './EventHub';
import type { ProjectStore, VersionRecord } from './ProjectStore';
import { SiteStore, type StoredSite } from './SiteStore';
import { changedBounds, siteChanges, terrainReport, toCompileSite } from './sites';

export interface CurrentBuild {
  project: ProjectInfo;
  record: VersionRecord;
  result: CompileResult;
  buildId: string;
  assetVersion: string;
}

export type BuildOutcome = { ok: true; build: CurrentBuild } | { ok: false; errors: string[] };

export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const augmented = new Set<string>();

/** How long an open viewer tab may take to reconnect (it retries every second). */
const VIEWER_RECONNECT_MS = 4000;

export class BuildService {
  current: CurrentBuild | null = null;
  private volumeCache: { buildId: string; gz: Buffer } | null = null;
  private changesCache: { buildId: string; gz: Buffer } | null = null;
  private feedbackSeq = 0;
  private worldPaths = new Map<string, string>();

  constructor(
    private readonly store: ProjectStore,
    private readonly assets: AssetStore,
    private readonly hub: EventHub,
    private readonly capture: CaptureBroker,
    private readonly config: AppConfig,
    private readonly sites: SiteStore = new SiteStore(),
  ) {}

  /** Reopen the last project so the viewer shows it right away. */
  async init(): Promise<void> {
    const id = this.store.currentId ?? this.store.list()[0]?.id;
    if (!id) return;
    try {
      await this.open(id, false);
    } catch {
      // A broken last project shouldn't stop the server.
    }
  }

  private async compile(
    spec: BuildSpec,
  ): Promise<{ ok: true; result: CompileResult } | { ok: false; errors: string[] }> {
    const version = resolveVersion(spec.minecraftVersion);
    if (version && blockDataIsOlder(version) && !augmented.has(version.id)) {
      try {
        const pack = await this.assets.ensure(assetVersionFor(version));
        augmentCatalog(getCatalog(version), pack.data);
        augmented.add(version.id);
      } catch {
        // Offline: fall back to the bundled data (blocks new in this release will be rejected).
      }
    }
    const siteId = (spec as { site?: { id?: unknown } } | null)?.site?.id;
    const site = typeof siteId === 'string' ? this.sites.get(siteId) : null;
    try {
      return {
        ok: true,
        result: compileBuildSpec(spec, {
          scriptRunner: nodeScriptRunner,
          ...(site ? { site: toCompileSite(site) } : {}),
        }),
      };
    } catch (error) {
      if (error instanceof BuildSpecError) return { ok: false, errors: error.errors };
      throw error;
    }
  }

  private activate(
    project: ProjectInfo,
    record: VersionRecord,
    result: CompileResult,
  ): CurrentBuild {
    const build: CurrentBuild = {
      project,
      record,
      result,
      buildId: `${project.id}@${record.n}`,
      assetVersion: assetVersionFor(result.version),
    };
    this.current = build;
    this.volumeCache = null;
    this.changesCache = null;
    this.store.currentId = project.id;
    this.hub.broadcast({
      type: 'build',
      buildId: build.buildId,
      projectId: project.id,
      n: record.n,
    });
    // Warm the textures so the viewer is instant.
    void this.assets.ensure(build.assetVersion).catch(() => undefined);
    return build;
  }

  private async commit(spec: BuildSpec, label: string, newProject: boolean): Promise<BuildOutcome> {
    this.hub.broadcast({ type: 'compiling', label });
    const compiled = await this.compile(spec);
    if (!compiled.ok) {
      this.hub.broadcast({ type: 'build-error', errors: compiled.errors });
      return compiled;
    }
    const result = compiled.result;
    const project =
      newProject || !this.current
        ? this.store.create(spec.name, spec.minecraftVersion)
        : this.current.project;
    const record = this.store.addVersion(project.id, {
      label,
      createdAt: Date.now(),
      spec: result.spec,
      blockCount: result.blockCount,
      size: [result.volume.sizeX, result.volume.sizeY, result.volume.sizeZ],
    });
    const build = this.activate(this.store.get(project.id), record, result);
    if (newProject) this.hub.broadcast({ type: 'projects' });
    return { ok: true, build };
  }

  create(
    spec: unknown,
    opts: { newProject?: boolean; label?: string } = {},
  ): Promise<BuildOutcome> {
    const s = spec as BuildSpec;
    return this.commit(s, opts.label ?? 'Initial build', opts.newProject ?? true);
  }

  async edit(opts: { edits?: Edit[]; patch?: Operation[]; label?: string }): Promise<BuildOutcome> {
    const cur = this.requireCurrent();
    let spec = cur.record.spec;
    try {
      if (opts.edits?.length) spec = applyEdits(spec, opts.edits);
      if (opts.patch?.length)
        spec = jsonpatch.applyPatch(structuredClone(spec), opts.patch, true, false).newDocument;
    } catch (error) {
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
    return this.commit(spec, opts.label ?? 'Edit', false);
  }

  async restore(n: number): Promise<BuildOutcome> {
    const cur = this.requireCurrent();
    const record = this.store.getVersion(cur.project.id, n);
    return this.commit(record.spec, `Restored v${n}`, false);
  }

  /** Try the build in another Minecraft version; applied only when every block exists there. */
  async changeVersion(version: string, apply: boolean): Promise<BuildOutcome> {
    const cur = this.requireCurrent();
    const spec = { ...cur.record.spec, minecraftVersion: version };
    if (!apply) {
      const compiled = await this.compile(spec);
      return compiled.ok ? { ok: true, build: cur } : compiled;
    }
    return this.commit(spec, `Minecraft ${version}`, false);
  }

  async open(projectId: string, broadcastProjects = true): Promise<CurrentBuild> {
    const latest = this.store.latestVersion(projectId);
    if (!latest) throw new UserError(`Project ${projectId} has no builds yet.`, 404);
    const compiled = await this.compile(latest.spec);
    if (!compiled.ok)
      throw new UserError(
        `The latest version no longer compiles: ${compiled.errors.join('; ')}`,
        422,
      );
    const build = this.activate(this.store.get(projectId), latest, compiled.result);
    if (broadcastProjects) this.hub.broadcast({ type: 'projects' });
    return build;
  }

  requireCurrent(): CurrentBuild {
    if (!this.current) throw new UserError('There is no build yet. Create one first.', 409);
    return this.current;
  }

  header(): BuildHeader | null {
    const b = this.current;
    if (!b) return null;
    const v = b.result.volume;
    return {
      buildId: b.buildId,
      projectId: b.project.id,
      n: b.record.n,
      name: b.record.spec.name,
      ...(b.record.spec.description ? { description: b.record.spec.description } : {}),
      minecraftVersion: b.result.version.id,
      assetVersion: b.assetVersion,
      size: [v.sizeX, v.sizeY, v.sizeZ],
      origin: v.origin,
      anchor: b.result.anchor,
      palette: v.palette,
      blockCount: b.result.blockCount,
      warnings: b.result.warnings,
      compileMs: b.result.compileMs,
      createdAt: b.record.createdAt,
      ...(() => {
        const site = this.currentSite();
        return site && b.result.site
          ? { site: { ...site.info, changes: b.result.site.changes } }
          : {};
      })(),
    };
  }

  /** The site the current build stands on, if any. */
  currentSite(): StoredSite | null {
    const id = this.current?.record.spec.site?.id;
    return id ? this.sites.get(id) : null;
  }

  /** Gzipped Uint8 mask (YZX) of the cells the build changes on its site. */
  changesGz(): Buffer {
    const b = this.requireCurrent();
    const changed = b.result.site?.changed;
    if (!changed) throw new UserError('This build is not on a site.', 404);
    if (this.changesCache?.buildId !== b.buildId)
      this.changesCache = { buildId: b.buildId, gz: gzipSync(Buffer.from(changed), { level: 4 }) };
    return this.changesCache.gz;
  }

  /** Gzipped Uint16 palette indices (YZX), cached per build. */
  volumeGz(): Buffer {
    const b = this.requireCurrent();
    if (this.volumeCache?.buildId !== b.buildId) {
      const data = b.result.volume.data;
      this.volumeCache = {
        buildId: b.buildId,
        gz: gzipSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { level: 4 }),
      };
    }
    return this.volumeCache.gz;
  }

  /** What is at a spec position, and which operation put it there. */
  inspectAt(pos: Vec3): InspectResult {
    const b = this.requireCurrent();
    const v = b.result.volume;
    const lx = pos[0] - v.origin[0];
    const ly = pos[1] - v.origin[1];
    const lz = pos[2] - v.origin[2];
    if (!v.inBounds(lx, ly, lz)) return { pos, state: 'minecraft:air', source: null };
    const i = v.index(lx, ly, lz);
    const state = v.palette[v.data[i] as number] ?? 'minecraft:air';
    const prov = v.prov[i] as number;
    return { pos, state, source: prov ? (b.result.provTable[prov] ?? null) : null };
  }

  /**
   * Text slices of a region (spec coordinates), one character per block with a legend — a precise
   * way for Claude to read what is where.
   */
  inspectRegion(from: Vec3, to: Vec3, axis: 'y' | 'x' | 'z' = 'y', maxChars = 12_000): string {
    const b = this.requireCurrent();
    const v = b.result.volume;
    const lo = [
      Math.min(from[0], to[0]),
      Math.min(from[1], to[1]),
      Math.min(from[2], to[2]),
    ] as Vec3;
    const hi = [
      Math.max(from[0], to[0]),
      Math.max(from[1], to[1]),
      Math.max(from[2], to[2]),
    ] as Vec3;
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@^~<>/|';
    const legend = new Map<string, string>();
    const sources = new Map<string, Set<string>>();
    const glyph = (state: string): string => {
      if (state === 'minecraft:air') return '.';
      let g = legend.get(state);
      if (!g) {
        g = glyphs[legend.size] ?? '!';
        legend.set(state, g);
      }
      return g;
    };
    const lines: string[] = [];
    const get = (x: number, y: number, z: number): string => {
      const lx = x - v.origin[0];
      const ly = y - v.origin[1];
      const lz = z - v.origin[2];
      if (!v.inBounds(lx, ly, lz)) return '.';
      const i = v.index(lx, ly, lz);
      const state = v.palette[v.data[i] as number] ?? 'minecraft:air';
      const p = v.prov[i] as number;
      if (p && state !== 'minecraft:air') {
        const src = b.result.provTable[p] ?? '';
        const set = sources.get(src) ?? new Set();
        set.add(blockNameOf(state));
        sources.set(src, set);
      }
      return glyph(state);
    };
    if (axis === 'y') {
      for (let y = hi[1]; y >= lo[1]; y--) {
        lines.push(`y=${y}  (rows z=${lo[2]}..${hi[2]}, columns x=${lo[0]}..${hi[0]})`);
        for (let z = lo[2]; z <= hi[2]; z++) {
          let row = '';
          for (let x = lo[0]; x <= hi[0]; x++) row += get(x, y, z);
          lines.push(`${String(z).padStart(5)} ${row}`);
        }
      }
    } else if (axis === 'z') {
      for (let z = lo[2]; z <= hi[2]; z++) {
        lines.push(`z=${z}  (rows y=${hi[1]}..${lo[1]} top-down, columns x=${lo[0]}..${hi[0]})`);
        for (let y = hi[1]; y >= lo[1]; y--) {
          let row = '';
          for (let x = lo[0]; x <= hi[0]; x++) row += get(x, y, z);
          lines.push(`${String(y).padStart(5)} ${row}`);
        }
      }
    } else {
      for (let x = lo[0]; x <= hi[0]; x++) {
        lines.push(`x=${x}  (rows y=${hi[1]}..${lo[1]} top-down, columns z=${lo[2]}..${hi[2]})`);
        for (let y = hi[1]; y >= lo[1]; y--) {
          let row = '';
          for (let z = lo[2]; z <= hi[2]; z++) row += get(x, y, z);
          lines.push(`${String(y).padStart(5)} ${row}`);
        }
      }
    }
    let body = lines.join('\n');
    if (body.length > maxChars)
      body = `${body.slice(0, maxChars)}\n… (truncated: inspect a smaller region)`;
    const legendText = [...legend.entries()]
      .map(([s, g]) => `${g} = ${s.replace('minecraft:', '')}`)
      .join('\n');
    const srcText = [...sources.entries()]
      .slice(0, 30)
      .map(([src, names]) => `${src}: ${[...names].slice(0, 6).join(', ')}`)
      .join('\n');
    return `Legend (. = air):\n${legendText}\n\nPlaced by:\n${srcText}\n\n${body}`;
  }

  // ---------------------------------------------------------------- feedback

  feedback(): FeedbackItem[] {
    const b = this.current;
    return b ? this.store.feedback(b.project.id) : [];
  }

  private saveFeedback(items: FeedbackItem[]): void {
    const b = this.requireCurrent();
    this.store.saveFeedback(b.project.id, items);
    this.hub.broadcast({ type: 'feedback', items });
  }

  addFeedback(input: Partial<FeedbackItem> & { text: string }): FeedbackItem {
    const b = this.requireCurrent();
    let source: string | undefined;
    let block: string | undefined;
    if (input.pos) {
      const hit = this.inspectAt(input.pos);
      source = hit.source ?? undefined;
      block = hit.state;
    }
    const item: FeedbackItem = {
      id: `fb${Date.now().toString(36)}${(++this.feedbackSeq).toString(36)}`,
      createdAt: Date.now(),
      status: 'open',
      kind: input.kind ?? 'note',
      text: input.text.slice(0, 2000),
      n: b.record.n,
      ...(input.pos ? { pos: input.pos } : {}),
      ...(input.region ? { region: input.region } : {}),
      ...(block ? { block } : {}),
      ...(source ? { source } : {}),
      ...(input.targetVersion ? { targetVersion: input.targetVersion } : {}),
    };
    this.saveFeedback([...this.feedback(), item]);
    return item;
  }

  resolveFeedback(ids: string[], reply?: string): FeedbackItem[] {
    const items = this.feedback().map((f) =>
      ids.includes(f.id)
        ? { ...f, status: 'resolved' as const, resolvedAt: Date.now(), ...(reply ? { reply } : {}) }
        : f,
    );
    this.saveFeedback(items);
    return items.filter((f) => ids.includes(f.id));
  }

  deleteFeedback(id: string): void {
    this.saveFeedback(this.feedback().filter((f) => f.id !== id));
  }

  // ---------------------------------------------------------------- export

  formats() {
    const b = this.requireCurrent();
    return formatsFor(b.result.version);
  }

  export(format: ExportFormat): ExportResult {
    const b = this.requireCurrent();
    const base = {
      name: b.record.spec.name,
      version: b.result.version,
      ...(b.record.spec.description ? { description: b.record.spec.description } : {}),
    };
    const site = this.currentSite();
    if (format === 'datapack') return this.datapackExport(this.datapack());
    if (!site || !b.result.site)
      return exportBuild(format, { ...base, volume: b.result.volume, anchor: b.result.anchor });
    // On a site: only the part the build changes, placed back where it came from.
    const bounds = changedBounds(b.result);
    if (!bounds)
      throw new UserError('Nothing on the site has changed yet: there is nothing to export.');
    let volume = b.result.volume.crop(bounds.lo, bounds.hi);
    const mask = cropMask(b.result, bounds);
    if (format === 'materials') {
      // What the player needs to place: changed cells only.
      const data = volume.data.map((id, i) => (mask[i] ? id : 0));
      volume = new BlockVolume(
        volume.sizeX,
        volume.sizeY,
        volume.sizeZ,
        volume.origin,
        volume.palette,
        data,
        volume.prov,
        volume.blockEntities,
      );
    }
    const anchor: Vec3 = [-volume.origin[0], -volume.origin[1], -volume.origin[2]];
    const worldMin: Vec3 = [
      site.origin[0] + volume.origin[0],
      site.origin[1] + volume.origin[1],
      site.origin[2] + volume.origin[2],
    ];
    const out = exportBuild(format, {
      ...base,
      volume,
      anchor,
      worldMin,
      ...(format === 'nbt' ? { mask } : {}),
    });
    const where = `world ${worldMin.join(' ')}`;
    const hint: Record<string, string> = {
      schem: `WorldEdit: //schem load ${out.filename.replace(/\.schem$/, '')} then //paste -o puts it back at ${where} (its first corner).`,
      schem3: `WorldEdit: //schem load ${out.filename.replace(/\.schem$/, '')} then //paste -o puts it back at ${where} (its first corner).`,
      schematic: `WorldEdit: //schematic load ${out.filename.replace(/\.schematic$/, '')} then //paste -o puts it back at ${where}.`,
      litematic: `Litematica: place the schematic with its origin at ${where}, paste with "Replace: All".`,
      nbt: `Only the changed blocks are in the file. /place template <its id> ${worldMin.join(' ')} (1.19+) or a structure block at ${where}.`,
    };
    return {
      ...out,
      warnings: [...(hint[format] ? [hint[format] as string] : []), ...out.warnings],
    };
  }

  /** The current build as a vanilla data pack: on a site at its world position, else where you stand. */
  datapack(): DatapackOutput {
    const b = this.requireCurrent();
    return this.datapackWithId(`${b.record.spec.name}_v${b.record.n}`);
  }

  private datapackExport(pack: DatapackOutput): ExportResult {
    return {
      buffer: pack.zip,
      filename: `${pack.folder}.zip`,
      mime: 'application/zip',
      warnings: [
        `In the game: put the .zip in the world's datapacks folder, /reload, then /function ${pack.functionId}/build (undo: /function ${pack.functionId}/undo).`,
        ...pack.warnings,
      ],
    };
  }

  /**
   * Write the data pack into a world's datapacks folder (the site's world, or `worldId`). Only
   * adds a new folder: nothing in the world changes until the player runs the function.
   */
  installDatapack(worldId?: string): {
    path: string;
    world: string;
    functionId: string;
    warnings: string[];
  } {
    const site = this.currentSite();
    let worldPath: string | undefined;
    if (worldId) worldPath = this.worldPath(worldId);
    else if (site?.source.kind === 'world') worldPath = site.source.worldPath;
    if (!worldPath)
      throw new UserError(
        'Which world? Pass a world id from the worlds list (or build on a site).',
      );
    if (!existsSync(join(worldPath, 'level.dat')))
      throw new UserError(`The world folder ${worldPath} is gone.`, 404);
    let pack = this.datapack();
    const base = pack.folder;
    let folder = base;
    for (let n = 2; existsSync(join(worldPath, 'datapacks', folder)); n++) {
      folder = `${base}_${n}`;
      const b = this.requireCurrent();
      pack = this.datapackWithId(`${b.record.spec.name}_v${b.record.n}_${n}`);
    }
    const dest = join(worldPath, 'datapacks', folder);
    for (const [path, data] of pack.files) {
      const file = join(dest, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data, { flag: 'wx' });
    }
    const world = readWorld(worldPath)?.name ?? worldPath;
    return { path: dest, world, functionId: pack.functionId, warnings: pack.warnings };
  }

  private datapackWithId(id: string): DatapackOutput {
    const b = this.requireCurrent();
    const site = this.currentSite();
    if (site && b.result.site) {
      if (!b.result.site.changes)
        throw new UserError('Nothing on the site has changed yet: there is nothing to export.');
      return writeDatapack({
        name: b.record.spec.name,
        version: b.result.version,
        id,
        place: {
          kind: 'world',
          dimension: site.source.kind === 'world' ? site.source.dimension : OVERWORLD,
          center: site.origin,
        },
        changes: siteChanges(b.result, site),
      });
    }
    return writeDatapack({
      name: b.record.spec.name,
      version: b.result.version,
      id,
      place: { kind: 'here' },
      changes: datapackChanges(b.result),
    });
  }

  /**
   * A copy of the site's world with the build in it, next to the original in the saves folder.
   * The original world is only read.
   */
  async exportWorldCopy(name?: string): Promise<{
    path: string;
    folder: string;
    name: string;
    chunks: number;
    blocks: number;
  }> {
    const b = this.requireCurrent();
    const site = this.currentSite();
    if (!site || !b.result.site || site.source.kind !== 'world')
      throw new UserError(
        'Only a build on a site imported from a world can be written into a world copy.',
      );
    if (!site.writable)
      throw new UserError(
        "This part of the world can't be written back (not fully generated, or saved before Minecraft 1.14): use a schematic or the data pack instead.",
      );
    const source = site.source;
    if (!existsSync(join(source.worldPath, 'level.dat')))
      throw new UserError(`The world folder ${source.worldPath} is gone.`, 404);
    const changes = siteChanges(b.result, site);
    if (!changes.length) throw new UserError('Nothing on the site has changed yet.');
    const spec = b.record.spec.name;
    const fallback = spec.startsWith(source.worldName)
      ? `${source.worldName} (VibeSchem v${b.record.n})`
      : `${source.worldName} + ${spec}`;
    const copy = await copyWorld(source.worldPath, (name ?? fallback).slice(0, 80));
    const report = writeBlocks(
      copy.path,
      source.dimension,
      changes.map((c) => ({
        x: c.pos[0],
        y: c.pos[1],
        z: c.pos[2],
        state: c.state,
        ...(c.nbt ? { nbt: c.nbt } : {}),
      })),
    );
    return { ...copy, chunks: report.chunks, blocks: report.blocks };
  }

  // ---------------------------------------------------------------- sites

  /** Worlds in the player's saves folders (official launcher, Prism, MultiMC, CurseForge, Modrinth). */
  worlds(): WorldInfo[] {
    const list = listWorlds(minecraftDir());
    this.worldPaths = new Map(list.map((w) => [w.id, w.path]));
    return list.map(worldInfo);
  }

  worldIcon(id: string): Buffer | null {
    const path = this.worldPath(id);
    const icon = join(path, 'icon.png');
    return existsSync(icon) ? readFileSync(icon) : null;
  }

  /** A world id from worlds(), a world name, or (for the MCP tool) a world folder path. */
  private worldPath(ref: string, allowPath = false): string {
    if (!this.worldPaths.has(ref)) this.worlds();
    const byId = this.worldPaths.get(ref);
    if (byId) return byId;
    const all = listWorlds(minecraftDir());
    const byName = all.filter(
      (w) => w.name.toLowerCase() === ref.toLowerCase() || w.folder === ref,
    );
    if (byName.length === 1) return (byName[0] as WorldSummary).path;
    if (byName.length > 1)
      throw new UserError(
        `Several worlds are called "${ref}": ${byName.map((w) => `${w.id} (${w.launcher})`).join(', ')}. Use the id.`,
      );
    if (allowPath && isAbsolute(ref) && existsSync(join(ref, 'level.dat'))) return resolve(ref);
    throw new UserError(`No world "${ref}" in the saves folders. Call worlds to list them.`, 404);
  }

  /** Read part of a world and start a new project on it. */
  async importWorldSite(opts: {
    world: string;
    center?: number[];
    radius?: number;
    dimension?: string;
    name?: string;
    below?: number;
    above?: number;
    allowPath?: boolean;
  }): Promise<{ site: StoredSite; outcome: BuildOutcome }> {
    const path = this.worldPath(opts.world, opts.allowPath ?? false);
    const world = readWorld(path);
    if (!world) throw new UserError(`${path} is not a Minecraft world (no level.dat).`);
    const dimension =
      opts.dimension ??
      (opts.center ? undefined : world.player?.dimension) ??
      (world.dimensions.includes(OVERWORLD) ? OVERWORLD : world.dimensions[0]) ??
      OVERWORLD;
    const fromPlayer =
      world.player && world.player.dimension === dimension ? world.player.pos : null;
    const c = opts.center ?? fromPlayer ?? world.spawn ?? [0, 0];
    const center = (c.length >= 3 ? [c[0], c[1], c[2]] : [c[0] ?? 0, c[c.length - 1] ?? 0]) as
      | Vec3
      | [number, number];
    // The player's own position: y of their feet is a good y=0, unless they're flying high.
    const radius = Math.min(MAX_SITE_RADIUS, Math.max(4, Math.round(opts.radius ?? 48)));
    let site;
    try {
      site = readWorldSite(path, {
        center: opts.center ? center : [center[0], center[center.length - 1] as number],
        radius,
        dimension,
        ...(opts.below !== undefined ? { below: opts.below } : {}),
        ...(opts.above !== undefined ? { above: opts.above } : {}),
      });
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : String(error));
    }
    const name = opts.name ?? `${world.name} @ ${site.origin[0]}, ${site.origin[2]}`;
    const stored = this.sites.save(
      site,
      { kind: 'world', worldPath: path, worldName: world.name, dimension, center, radius },
      name,
    );
    const outcome = await this.commit(
      { name, minecraftVersion: site.version, site: { id: stored.info.id }, operations: [] },
      'Imported site',
      true,
    );
    return { site: stored, outcome };
  }

  /** A schematic file as the site, in a new project. */
  async importSchematicSite(
    buffer: Buffer,
    filename: string,
    name?: string,
  ): Promise<{ site: StoredSite; outcome: BuildOutcome }> {
    let site;
    try {
      site = siteFromSchematic(readSchematic(buffer, filename));
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : String(error));
    }
    const title = name ?? filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    const stored = this.sites.save(site, { kind: 'schematic', filename }, title);
    const outcome = await this.commit(
      { name: title, minecraftVersion: site.version, site: { id: stored.info.id }, operations: [] },
      'Imported schematic',
      true,
    );
    return { site: stored, outcome };
  }

  importSchematicFile(
    path: string,
    name?: string,
  ): Promise<{ site: StoredSite; outcome: BuildOutcome }> {
    if (!existsSync(path)) throw new UserError(`No file at ${path}.`, 404);
    return this.importSchematicSite(readFileSync(path), path, name);
  }

  siteList(): SiteInfo[] {
    return this.sites.list();
  }

  /** The terrain report of the current build's site (as it is now, after the build's changes). */
  terrain(opts: { step?: number; from?: Vec3; to?: Vec3 } = {}): string {
    const b = this.requireCurrent();
    const site = this.currentSite();
    if (!site || !b.result.site)
      throw new UserError(
        'The current build is not on a site. Import one first: import_site (a world area) or import a schematic.',
      );
    return terrainReport(site, b.result.volume, opts);
  }

  exportTargets(): ExportTarget[] {
    const mc = minecraftDir();
    return [
      {
        id: 'worldedit',
        label: 'WorldEdit (single player)',
        path: join(mc, 'config', 'worldedit', 'schematics'),
        exists: existsSync(join(mc, 'config', 'worldedit')),
      },
      {
        id: 'litematica',
        label: 'Litematica',
        path: join(mc, 'schematics'),
        exists: existsSync(join(mc, 'schematics')) || existsSync(join(mc, 'config', 'litematica')),
      },
      {
        id: 'downloads',
        label: 'Downloads',
        path: join(homedir(), 'Downloads'),
        exists: existsSync(join(homedir(), 'Downloads')),
      },
    ];
  }

  saveExport(
    format: ExportFormat,
    targetId: ExportTarget['id'],
  ): { path: string; warnings: string[] } {
    const target = this.exportTargets().find((t) => t.id === targetId);
    if (!target) throw new UserError(`Unknown destination "${targetId}".`);
    const out = this.export(format);
    mkdirSync(target.path, { recursive: true });
    // Never overwrite a file already in the player's folder: "castle.schem" becomes "castle (2).schem".
    const ext = extname(out.filename);
    const stem = out.filename.slice(0, out.filename.length - ext.length);
    let path = join(target.path, out.filename);
    for (let n = 2; existsSync(path); n++) path = join(target.path, `${stem} (${n})${ext}`);
    writeFileSync(path, out.buffer, { flag: 'wx' });
    return { path, warnings: out.warnings };
  }

  // ---------------------------------------------------------------- rendering

  private colorSource(): ColorSource {
    const b = this.current;
    const pack = b ? this.assets.peek(b.assetVersion) : undefined;
    if (!pack) return defaultColors;
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    return (state) => {
      const c = pack.baker.colors(state);
      return c ? { top: hex(c.top), side: hex(c.side) } : defaultColors(state);
    };
  }

  /**
   * Make sure the user has a viewer, reusing the tab that is already open: a tab left open from
   * an earlier session reconnects by itself within a few seconds, so a new tab opens only when
   * none comes back.
   */
  async showViewer(waitMs = 15_000): Promise<boolean> {
    if (this.hub.count > 0) return true;
    if (await this.hub.waitForClient(VIEWER_RECONNECT_MS)) return true;
    openViewer(`${this.config.baseUrl}/`);
    return this.hub.waitForClient(waitMs);
  }

  /** Real textured views from the open viewer; flat-colour fallback when there is none. */
  async render(opts: {
    views: ViewName[];
    focus?: { from: Vec3; to: Vec3 };
    cutY?: number;
    size?: number;
    pins?: boolean;
  }): Promise<{ images: CapturedImage[]; fallback: boolean; note?: string }> {
    const b = this.requireCurrent();
    await this.showViewer();
    if (this.hub.count > 0) {
      try {
        const images = await this.capture.request({
          buildId: b.buildId,
          views: opts.views,
          ...(opts.focus ? { focus: opts.focus } : {}),
          ...(opts.cutY !== undefined ? { cutY: opts.cutY } : {}),
          size: opts.size ?? 720,
          pins: opts.pins ?? true,
        });
        return { images, fallback: false };
      } catch (error) {
        const png = renderIsometric(b.result.volume, this.colorSource());
        return {
          images: [{ view: 'iso', png }],
          fallback: true,
          note: `Viewer render failed (${error instanceof Error ? error.message : String(error)}); flat-colour isometric fallback.`,
        };
      }
    }
    return {
      images: [{ view: 'iso', png: renderIsometric(b.result.volume, this.colorSource()) }],
      fallback: true,
      note: 'No browser viewer connected; flat-colour isometric fallback.',
    };
  }

  focus(from: Vec3, to: Vec3, message?: string): void {
    this.hub.broadcast({ type: 'focus', from, to, ...(message ? { message } : {}) });
  }

  // ---------------------------------------------------------------- projects

  projects(): ProjectInfo[] {
    return this.store.list();
  }

  history() {
    const b = this.requireCurrent();
    return this.store.history(b.project.id);
  }

  rename(id: string, name: string): ProjectInfo {
    const p = this.store.rename(id, name);
    this.hub.broadcast({ type: 'projects' });
    return p;
  }

  remove(id: string): void {
    this.store.remove(id);
    if (this.current?.project.id === id) {
      this.current = null;
      this.store.currentId = null;
      this.hub.broadcast({ type: 'build', buildId: '', projectId: '', n: 0 });
    }
    this.hub.broadcast({ type: 'projects' });
  }

  // ---------------------------------------------------------------- redstone

  /** What the viewer's simulator needs to run the same simulation as the server. */
  simInfo(): SimInfo {
    const b = this.requireCurrent();
    const catalog = getCatalog(b.result.version);
    return {
      buildId: b.buildId,
      version: b.result.version.id,
      fullCubes: catalogData.fullCubes.filter((n) => catalog.has(n)),
      defaults: {
        piston_head: catalog.defaultProps('piston_head'),
        moving_piston: catalog.defaultProps('moving_piston'),
      },
      circuit: (b.result.spec.circuit as Record<string, unknown> | undefined) ?? null,
      blockEntities: b.result.volume.blockEntities.map((be) => ({ pos: be.pos, data: be.data })),
    };
  }

  /**
   * Run redstone tests on the current build: the stored ones, or ones given here (with extra
   * inputs/outputs for this run). `locations` reruns everything at other world positions, where
   * dust and pistons update their neighbours in another order, to catch location-dependent
   * circuits. `show` plays one test live in the viewer.
   */
  simulate(opts: {
    tests?: unknown[];
    only?: string[];
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    locations?: number;
    show?: string;
  }): { text: string; ok: boolean } {
    const b = this.requireCurrent();
    const stored: CircuitDefinition = b.result.spec.circuit ?? {};
    const errors: string[] = [];
    const parseIo = (map: Record<string, unknown> | undefined, kind: string) => {
      const out: NonNullable<CircuitDefinition['inputs']> = {};
      for (const [name, io] of Object.entries(map ?? {})) {
        const r = circuitIoSchema.safeParse(io);
        if (r.success) out[name] = r.data;
        else
          errors.push(
            `${kind}.${name}: ${r.error.issues.map((i) => `${i.path.join('.') || 'value'} ${i.message}`).join('; ')}`,
          );
      }
      return out;
    };
    const circuit: CircuitDefinition = {
      ...stored,
      inputs: { ...stored.inputs, ...parseIo(opts.inputs, 'inputs') },
      outputs: { ...stored.outputs, ...parseIo(opts.outputs, 'outputs') },
    };
    let tests: CircuitTest[] = [];
    if (opts.tests) {
      opts.tests.forEach((t, k) => {
        const r = circuitTestSchema.safeParse(t);
        if (r.success) tests.push(r.data);
        else
          errors.push(
            `tests[${k}]: ${r.error.issues.map((i) => `${i.path.join('.') || 'test'}: ${i.message}`).join('; ')}`,
          );
      });
    } else {
      tests = stored.tests ?? [];
      if (opts.only?.length) {
        const missing = opts.only.filter((n) => !tests.some((t) => t.name === n));
        if (missing.length)
          errors.push(`No stored test named ${missing.map((n) => `"${n}"`).join(', ')}.`);
        tests = tests.filter((t) => opts.only?.includes(t.name));
      }
    }
    if (errors.length) return { text: `Not run:\n- ${errors.join('\n- ')}`, ok: false };

    const catalog = getCatalog(b.result.version);
    const volume = b.result.volume;
    const run = (offset?: Vec3): CircuitReport =>
      runCircuit(
        worldFor(volume, catalog, offset ? { offset } : {}),
        circuit as CircuitSpec,
        volume.origin,
        {
          tests: tests as TestSpec[],
        },
      ).report;
    const report = run();
    const lines = [formatReport(report)];
    if (tests.length === 0)
      lines.push(
        'No tests: give `tests` here, or store them in the spec under circuit.tests (edit_build {op:"circuit"}).',
      );
    const values = this.circuitValues(circuit);
    if (values) lines.push(`At rest: ${values}`);
    let ok = report.errors.length === 0 && report.tests.every((t) => t.ok);
    const n = Math.min(16, Math.max(1, opts.locations ?? 1));
    if (n > 1) {
      // BlockPos hashes order dust and piston updates: shifting x walks through the orders.
      const differing = new Set<string>();
      for (let k = 1; k < n; k++) {
        const other = run([k * 7, 64 + k, k * 3]);
        other.tests.forEach((t, j) => {
          const base = report.tests[j];
          if (base && base.ok !== t.ok) differing.add(t.name);
        });
      }
      lines.push(
        differing.size
          ? `⚠ Location-dependent: ${[...differing].join(', ')} pass at some world positions and fail at others (update order). Make the design independent of it.`
          : `Same results at ${n} world positions.`,
      );
      if (differing.size) ok = false;
    }
    if (opts.show) {
      const test = tests.find((t) => t.name === opts.show);
      if (!test) lines.push(`show: no test named "${opts.show}".`);
      else {
        this.hub.broadcast({
          type: 'sim',
          buildId: b.buildId,
          test: test as Record<string, unknown>,
          circuit: circuit as Record<string, unknown>,
        });
        lines.push(
          this.hub.count > 0
            ? `Playing "${test.name}" in the viewer.`
            : 'No viewer is open to play it in.',
        );
      }
    }
    return { text: lines.join('\n'), ok };
  }

  /** "A=0, B=0, S=0" for the circuit's named I/O at rest, or null without any. */
  private circuitValues(circuit: CircuitDefinition): string | null {
    const b = this.requireCurrent();
    const names = [...Object.keys(circuit.inputs ?? {}), ...Object.keys(circuit.outputs ?? {})];
    if (!names.length) return null;
    const { circuit: c } = runCircuit(
      worldFor(b.result.volume, getCatalog(b.result.version)),
      { inputs: circuit.inputs, outputs: circuit.outputs } as CircuitSpec,
      b.result.volume.origin,
      { tests: [] },
    );
    if (c.errors.length) return null;
    return Object.entries(c.values())
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
  }

  /** Compact text summary used in tool results. */
  summary(build: CurrentBuild): string {
    const v = build.result.volume;
    const changed = build.result.site?.changed;
    // On a site, list what the build places rather than the terrain it stands on.
    const counts = changed ? [...changedCounts(v, changed).entries()] : [...v.counts().entries()];
    const byName = new Map<string, number>();
    for (const [s, n] of counts) byName.set(blockNameOf(s), (byName.get(blockNameOf(s)) ?? 0) + n);
    const top = [...byName.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, n]) => `${name} ×${n.toLocaleString('en-US')}`)
      .join(', ');
    const lines = [
      `Build "${build.record.spec.name}" v${build.record.n} (project ${build.project.id}) · Minecraft ${build.result.version.id} · ${v.sizeX}×${v.sizeY}×${v.sizeZ} (origin ${v.origin.join(',')}) · ${build.result.blockCount.toLocaleString('en-US')} blocks · ${byName.size} block types · compiled in ${build.result.compileMs} ms`,
      `${changed ? 'Blocks the build places' : 'Top materials'}: ${top || '—'}`,
    ];
    if (build.result.warnings.length)
      lines.push(`Warnings:\n- ${build.result.warnings.join('\n- ')}`);
    if (build.result.circuit) lines.push(`Redstone — ${formatReport(build.result.circuit)}`);
    const siteId = build.record.spec.site?.id;
    const site = siteId ? this.sites.get(siteId) : null;
    if (site && build.result.site) {
      const where =
        site.source.kind === 'world'
          ? `world "${site.source.worldName}" (${site.source.dimension})`
          : `schematic ${site.source.filename}`;
      lines.push(
        `Site ${site.info.id}: ${where}, spec (0,0,0) = world (${site.origin.join(', ')}). ${build.result.site.changes.toLocaleString('en-US')} blocks differ from the site. The terrain tool maps the ground.`,
      );
    }
    const open = this.feedback().filter((f) => f.status === 'open').length;
    if (open)
      lines.push(`${open} open feedback note(s) from the user in the viewer: call get_feedback.`);
    lines.push(`Viewer: ${this.config.baseUrl}/ (${this.hub.count} open)`);
    return lines.join('\n');
  }
}

function worldInfo(w: WorldSummary): WorldInfo {
  return {
    id: w.id,
    name: w.name,
    folder: w.folder,
    launcher: w.launcher,
    version: w.version,
    lastPlayed: w.lastPlayed,
    gameMode: w.gameMode,
    player: w.player,
    spawn: w.spawn,
    dimensions: w.dimensions,
    hasIcon: w.hasIcon,
    supported: w.dimensions.length > 0,
  };
}

/** Every block of a build as offsets from its paste anchor (data pack placed where you stand). */
function datapackChanges(result: CompileResult) {
  const v = result.volume;
  const nbt = new Map(v.blockEntities.map((be) => [v.index(...be.pos), be.data]));
  const out: { pos: Vec3; state: string; nbt?: Record<string, unknown>; before: string }[] = [];
  let i = 0;
  for (let y = 0; y < v.sizeY; y++)
    for (let z = 0; z < v.sizeZ; z++)
      for (let x = 0; x < v.sizeX; x++, i++) {
        const id = v.data[i] as number;
        if (id === 0) continue;
        const data = nbt.get(i);
        out.push({
          pos: [x - result.anchor[0], y - result.anchor[1], z - result.anchor[2]],
          state: v.palette[id] as string,
          ...(data ? { nbt: data } : {}),
          before: 'minecraft:air',
        });
      }
  return out;
}

function cropMask(result: CompileResult, bounds: { lo: Vec3; hi: Vec3 }): Uint8Array {
  const v = result.volume;
  const changed = result.site?.changed as Uint8Array;
  const [x0, y0, z0] = bounds.lo;
  const [x1, y1, z1] = bounds.hi;
  const sx = x1 - x0 + 1;
  const out = new Uint8Array(sx * (y1 - y0 + 1) * (z1 - z0 + 1));
  let i = 0;
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++) {
      const from = v.index(x0, y, z);
      out.set(changed.subarray(from, from + sx), i);
      i += sx;
    }
  return out;
}

function changedCounts(v: BlockVolume, changed: Uint8Array): Map<string, number> {
  const byId = new Uint32Array(v.palette.length);
  for (let i = 0; i < v.data.length; i++) if (changed[i]) (byId[v.data[i] as number] as number)++;
  const out = new Map<string, number>();
  for (let id = 1; id < byId.length; id++)
    if (byId[id]) out.set(v.palette[id] as string, byId[id] as number);
  return out;
}
