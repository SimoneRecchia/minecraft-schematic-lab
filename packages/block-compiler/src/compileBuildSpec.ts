import {
  listVersions,
  resolveVersion,
  getCatalog,
  type BlockCatalog,
  type VersionInfo,
} from '@minecraft-schematic-lab/catalog';
import {
  operationSchema,
  validateBuildSpec,
  type BuildOperation,
  type BuildSpec,
  type Component,
  type PaletteEntry as SpecPaletteEntry,
} from '@minecraft-schematic-lab/build-spec';
import { applyAutoStates, completeMultiBlocks } from './autoStates';
import { BlockVolume, type BlockEntityData } from './BlockVolume';
import { CompileContext, type ScriptRunner } from './context';
import { hashString, makeRng, Perlin } from './noise';
import { InternalPalette } from './palette';
import { BlockResolver } from './resolver';
import { CompileLimitError, SparseVolume } from './SparseVolume';
import { Transform } from './transform';
import { box, cone, cylinder, dome, line, polygon, sphere } from './ops/shapes';
import { roof } from './ops/roof';
import { arch, blocks, layers, replace } from './ops/detail';
import { scatter, terrain, tree } from './ops/nature';

export interface CompileOptions {
  /** Executes `script` operations (the server passes a node:vm runner). */
  scriptRunner?: ScriptRunner;
  scriptTimeoutMs?: number;
}

export interface CompileResult {
  spec: BuildSpec;
  version: VersionInfo;
  volume: BlockVolume;
  warnings: string[];
  /** Index -> "operations[3] (tower) > operations[1]" for each cell's prov value. */
  provTable: string[];
  blockCount: number;
  /** Distinct non-air states, sorted. */
  palette: string[];
  /** Local coordinates of the paste anchor (lands at the player's feet). */
  anchor: [number, number, number];
  compileMs: number;
}

export class BuildSpecError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid build spec: ${errors.join('; ')}`);
    this.name = 'BuildSpecError';
    this.errors = errors;
  }
}

const MAX_ERRORS = 40;

function versionHint(): string {
  const majors = [...new Set(listVersions().map((v) => v.major))];
  return `Supported: ${majors[majors.length - 1]} … ${majors[0]} (e.g. "1.21.4", "1.20.1", "1.16.5", "1.12.2", "${listVersions()[0]?.id}").`;
}

export function compileBuildSpec(input: unknown, options: CompileOptions = {}): CompileResult {
  const started = performance.now();
  const validation = validateBuildSpec(input);
  if (!validation.success) throw new BuildSpecError(validation.errors);
  const spec = validation.data;

  const version = resolveVersion(spec.minecraftVersion);
  if (!version) {
    throw new BuildSpecError([
      `minecraftVersion: "${spec.minecraftVersion}" is not a known Minecraft Java release. ${versionHint()}`,
    ]);
  }
  const catalog = getCatalog(version);
  const sparse = new SparseVolume();
  const palette = new InternalPalette(catalog);
  const paletteDefs: Record<string, SpecPaletteEntry> = { ...(spec.palette ?? {}) };
  const seed = spec.seed ?? hashString(spec.name) % 100000;
  const resolver = new BlockResolver(catalog, palette, paletteDefs, seed);
  const ctx = new CompileContext(
    spec,
    catalog,
    sparse,
    palette,
    resolver,
    options.scriptRunner,
    paletteDefs,
    spec.components ?? {},
  );
  const runner = new OperationRunner(ctx, options.scriptTimeoutMs ?? 20000);

  try {
    spec.operations.forEach((op, i) => runner.run(op, `operations[${i}]`, []));
  } catch (error) {
    if (error instanceof CompileLimitError) throw new BuildSpecError([error.message]);
    throw error;
  }
  if (resolver.errors.length > 0) {
    const errors = resolver.errors.slice(0, MAX_ERRORS);
    if (resolver.errors.length > MAX_ERRORS)
      errors.push(`…and ${resolver.errors.length - MAX_ERRORS} more errors.`);
    throw new BuildSpecError(errors);
  }

  completeMultiBlocks(sparse, palette);
  const { volume, clipped } = finalize(sparse, palette, spec, ctx);
  applyAutoStates(volume, palette.entries, catalog);
  const compact = volume.compact();

  const warnings: string[] = [...resolver.notes, ...ctx.warnings];
  for (const key of Object.keys(spec.palette ?? {})) {
    if (catalog.has(key)) {
      warnings.push(
        `Palette key "${key}" is also a block name: everywhere you wrote "${key}" the palette entry was used. Write "minecraft:${key}" for the plain block, or rename the key.`,
      );
    }
  }
  if (clipped > 0) {
    warnings.push(
      `${clipped} block(s) fell outside the declared size ${spec.size?.x}×${spec.size?.y}×${spec.size?.z} and were dropped.`,
    );
  }
  if (ctx.outOfRangeWrites > 0)
    warnings.push(`${ctx.outOfRangeWrites} block(s) were beyond ±30000 and were skipped.`);
  const counts = compact.counts();
  if (counts.size === 0) warnings.push('The build is empty: no operation placed any block.');

  const anchor: [number, number, number] = spec.anchor
    ? [
        spec.anchor[0] - compact.origin[0],
        spec.anchor[1] - compact.origin[1],
        spec.anchor[2] - compact.origin[2],
      ]
    : // Default: horizontal centre, at spec y=0 (ground level by convention) when the build has it.
      [
        Math.floor(compact.sizeX / 2),
        Math.min(compact.sizeY - 1, Math.max(0, -compact.origin[1])),
        Math.floor(compact.sizeZ / 2),
      ];

  return {
    spec,
    version,
    volume: compact,
    warnings: dedupeWarnings(warnings),
    provTable: ctx.provTable,
    blockCount: [...counts.values()].reduce((a, b) => a + b, 0),
    palette: [...counts.keys()].sort(),
    anchor,
    compileMs: Math.round(performance.now() - started),
  };
}

function dedupeWarnings(list: string[]): string[] {
  const out = [...new Set(list)];
  if (out.length > 25) return [...out.slice(0, 25), `…and ${out.length - 25} more warnings.`];
  return out;
}

function finalize(
  sparse: SparseVolume,
  palette: InternalPalette,
  spec: BuildSpec,
  ctx: CompileContext,
): { volume: BlockVolume; clipped: number } {
  const states = palette.entries.map((e) => e.state);
  let min: [number, number, number];
  let max: [number, number, number];
  if (spec.size) {
    min = [0, 0, 0];
    max = [spec.size.x - 1, spec.size.y - 1, spec.size.z - 1];
  } else {
    const b = sparse.bounds();
    if (!b) return { volume: new BlockVolume(1, 1, 1, [0, 0, 0], states), clipped: 0 };
    min = b.min;
    max = b.max;
  }
  const sx = max[0] - min[0] + 1;
  const sy = max[1] - min[1] + 1;
  const sz = max[2] - min[2] + 1;
  if (sx * sy * sz > 120_000_000) {
    throw new BuildSpecError([
      `The build's bounding box ${sx}×${sy}×${sz} is too large (max ~120 million cells). Check coordinates for a typo or split it into parts.`,
    ]);
  }
  const data = new Uint16Array(sx * sy * sz);
  const prov = new Uint16Array(sx * sy * sz);
  let clipped = 0;
  sparse.forEach((x, y, z, id, p) => {
    const lx = x - min[0];
    const ly = y - min[1];
    const lz = z - min[2];
    if (lx < 0 || ly < 0 || lz < 0 || lx >= sx || ly >= sy || lz >= sz) {
      clipped++;
      return;
    }
    const i = lx + sx * (lz + sz * ly);
    data[i] = id;
    prov[i] = p;
  });
  const blockEntities: BlockEntityData[] = [];
  for (const be of ctx.blockEntities.values()) {
    const lx = be.x - min[0];
    const ly = be.y - min[1];
    const lz = be.z - min[2];
    if (lx < 0 || ly < 0 || lz < 0 || lx >= sx || ly >= sy || lz >= sz) continue;
    const id = data[lx + sx * (lz + sz * ly)] as number;
    if (id === 0) continue;
    blockEntities.push({
      id: `minecraft:${palette.get(id).name}`,
      pos: [lx, ly, lz],
      data: be.data,
    });
  }
  return { volume: new BlockVolume(sx, sy, sz, min, states, data, prov, blockEntities), clipped };
}

/** Executes operations with group transforms, components, masks and provenance. */
class OperationRunner {
  private depth = 0;

  constructor(
    private readonly ctx: CompileContext,
    private readonly scriptTimeoutMs: number,
  ) {}

  run(op: BuildOperation, path: string, trail: string[]): void {
    const ctx = this.ctx;
    const label = op.id ? `${path} (${op.id})` : path;
    const prevWhere = ctx.where;
    const prevMask = ctx.mask;
    ctx.where = op.id ? `${path} "${op.id}"` : path;
    if (op.mask) ctx.mask = ctx.parseMask(op.mask);
    try {
      if (op.type === 'group') {
        this.transformed(op, Transform.translate(...(op.offset ?? [0, 0, 0])), () => {
          op.operations.forEach((child, i) =>
            this.run(child, `${path}.operations[${i}]`, [...trail, label]),
          );
        });
        return;
      }
      if (op.type === 'place') {
        const comp = ctx.components[op.component];
        if (!comp) {
          ctx.error(
            `unknown component "${op.component}". Defined: ${Object.keys(ctx.components).join(', ') || 'none'}.`,
          );
          return;
        }
        this.placeComponent(op.component, comp, op, trail, label);
        return;
      }
      ctx.enterProv([...trail, label].join(' > '));
      this.leaf(op);
    } finally {
      ctx.where = prevWhere;
      ctx.mask = prevMask;
    }
  }

  private placeComponent(
    name: string,
    comp: Component,
    op: {
      at: [number, number, number];
      rotate?: number;
      mirror?: 'x' | 'z';
      repeat?: { count: number; offset: [number, number, number] };
      symmetry?: { x?: number; z?: number };
    },
    trail: string[],
    label: string,
  ): void {
    if (this.depth > 16) {
      this.ctx.error(`component "${name}" nests too deeply (recursive components?).`);
      return;
    }
    this.depth++;
    try {
      this.transformed(op, Transform.translate(...op.at), () => {
        comp.operations.forEach((child, i) =>
          this.run(child, `components.${name}.operations[${i}]`, [
            ...trail,
            `${label} place ${name}`,
          ]),
        );
      });
    } finally {
      this.depth--;
    }
  }

  /** Apply mirror -> rotate -> translate, then repeat copies and symmetric copies. */
  private transformed(
    op: {
      rotate?: number;
      mirror?: 'x' | 'z';
      repeat?: { count: number; offset: [number, number, number] };
      symmetry?: { x?: number; z?: number };
    },
    translate: Transform,
    body: () => void,
  ): void {
    let local = translate.compose(Transform.rotate(op.rotate ?? 0));
    if (op.mirror) local = local.compose(Transform.mirror(op.mirror));
    const variants: Transform[] = [Transform.IDENTITY];
    if (op.symmetry?.x !== undefined) variants.push(Transform.mirror('x', op.symmetry.x));
    if (op.symmetry?.z !== undefined) variants.push(Transform.mirror('z', op.symmetry.z));
    if (op.symmetry?.x !== undefined && op.symmetry?.z !== undefined) {
      variants.push(
        Transform.mirror('x', op.symmetry.x).compose(Transform.mirror('z', op.symmetry.z)),
      );
    }
    const count = op.repeat?.count ?? 1;
    const step = op.repeat?.offset ?? [0, 0, 0];
    for (const sym of variants) {
      for (let i = 0; i < count; i++) {
        const copy = sym
          .compose(Transform.translate(step[0] * i, step[1] * i, step[2] * i))
          .compose(local);
        this.ctx.withTransform(copy, body);
      }
    }
  }

  private leaf(op: Exclude<BuildOperation, { type: 'group' } | { type: 'place' }>): void {
    const ctx = this.ctx;
    switch (op.type) {
      case 'box':
        return box(ctx, op);
      case 'line':
        return line(ctx, op);
      case 'cylinder':
        return cylinder(ctx, op);
      case 'cone':
        return cone(ctx, op);
      case 'sphere':
        return sphere(ctx, op);
      case 'dome':
        return dome(ctx, op);
      case 'polygon':
        return polygon(ctx, op);
      case 'roof':
        return roof(ctx, op);
      case 'arch':
        return arch(ctx, op);
      case 'blocks':
        return blocks(ctx, op);
      case 'layers':
        return layers(ctx, op);
      case 'terrain':
        return terrain(ctx, op);
      case 'tree':
        return tree(ctx, op);
      case 'scatter':
        return scatter(ctx, op, (name, at, rotate) => {
          const comp = ctx.components[name];
          if (comp) this.placeComponent(name, comp, { at, rotate }, [], ctx.where);
        });
      case 'replace':
        return replace(ctx, op);
      case 'script':
        return this.script(op.code, op.args ?? {});
    }
  }

  private script(code: string, args: Record<string, unknown>): void {
    const ctx = this.ctx;
    if (!ctx.scriptRunner) {
      ctx.error('script operations are not available in this environment.');
      return;
    }
    const rnd = makeRng(ctx.seed ^ hashString(code));
    const perlin = new Perlin(ctx.seed);
    const where = ctx.where;
    let logs = 0;
    const runOp = (raw: unknown): void => {
      const parsed = operationSchema.safeParse(raw);
      if (!parsed.success) {
        const msg = parsed.error.issues
          .map((i) => `${i.path.join('.') || 'op'}: ${i.message}`)
          .join('; ');
        throw new Error(`invalid operation ${JSON.stringify(raw).slice(0, 120)}: ${msg}`);
      }
      const prevWhere = ctx.where;
      this.run(parsed.data, `${where} script`, []);
      ctx.where = prevWhere;
    };
    const shape = (type: string) => (params: Record<string, unknown>) => runOp({ ...params, type });
    const api: Record<string, unknown> = {
      args,
      set: (x: number, y: number, z: number, block: string) => {
        ctx.put(Math.round(x), Math.round(y), Math.round(z), ctx.source(String(block)));
      },
      get: (x: number, y: number, z: number): string | null => {
        const id = ctx.get(Math.round(x), Math.round(y), Math.round(z));
        return id === 0 ? null : ctx.palette.get(id).state;
      },
      op: runOp,
      box: (from: number[], to: number[], block: string, opts: Record<string, unknown> = {}) =>
        runOp({ type: 'box', from, to, block, ...opts }),
      line: (from: number[], to: number[], block: string, opts: Record<string, unknown> = {}) =>
        runOp({ type: 'line', from, to, block, ...opts }),
      cylinder: shape('cylinder'),
      cone: shape('cone'),
      sphere: shape('sphere'),
      dome: shape('dome'),
      polygon: shape('polygon'),
      roof: shape('roof'),
      arch: shape('arch'),
      tree: shape('tree'),
      layers: shape('layers'),
      terrain: shape('terrain'),
      scatter: shape('scatter'),
      replace: shape('replace'),
      place: (component: string, at: number[], opts: Record<string, unknown> = {}) =>
        runOp({ type: 'place', component, at, ...opts }),
      rand: () => rnd(),
      randInt: (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1)),
      pick: <T>(list: T[]): T | undefined => list[Math.floor(rnd() * list.length)],
      chance: (p: number) => rnd() < p,
      noise: (x: number, y = 0, z = 0) => perlin.noise(x, y, z),
      fbm: (x: number, y = 0, z = 0, octaves = 4) => perlin.fbm(x, y, z, octaves),
      log: (...parts: unknown[]) => {
        if (logs++ < 20) ctx.warnings.add(`${where} log: ${parts.map(String).join(' ')}`);
      },
    };
    try {
      ctx.scriptRunner(code, api, this.scriptTimeoutMs);
    } catch (error) {
      if (error instanceof CompileLimitError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      ctx.error(`script failed: ${message}`);
    }
  }
}

export type { BlockCatalog };
