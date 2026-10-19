import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  blockAddedIn,
  getCatalog,
  LATEST_VERSION,
  listVersions,
  resolveVersion,
} from '@minecraft-schematic-lab/catalog';
import type { ExportFormat } from '@minecraft-schematic-lab/formats';
import { APP_VERSION, type ViewName, type Vec3 } from '@minecraft-schematic-lab/shared';
import type { AppConfig } from '../config';
import type { BuildOutcome, BuildService } from '../core/BuildService';
import type { Edit } from '../core/edits';

export interface McpDeps {
  builds: BuildService;
  config: AppConfig;
}

type Content = CallToolResult['content'];

const INSTRUCTIONS = `VibeSchem builds Minecraft structures from a BuildSpec (JSON) and shows them in a live 3D viewer in the user's browser, textured with the real game's blocks. The user looks at the viewer; you look at renders returned by the tools.

New build:
1. Once per session, before your first build, call read_guide("workflow") — it is short and sets the bar for quality. Read read_guide("spec") for the BuildSpec language, and the topic guides you need (roofs, styles, palettes, details, landscape, scripts).
2. Plan like an expert builder (massing, palette, proportions, depth), then call create_build with the complete spec. Prefer components + repeat/symmetry, palette mixes and scripts over long lists of single blocks.
3. create_build returns a rendered preview: critique it like a builder (silhouette, depth, texture, roof, grounding, scale) and fix weak spots with edit_build before you present it. render_views gives more angles, close-ups and sections.
4. Then tell the user in a few sentences what you built and that it's in the viewer, where they can export it.

Changes: when the user asks to change something, call get_feedback first — they can pin notes on blocks in the viewer, and each note says which operation placed that block. Edit with edit_build by operation id, then resolve_feedback with a one-line reply.

Redstone: VibeSchem simulates Minecraft Java redstone faithfully for the build's version (game ticks, update order, quasi-connectivity, pistons, torch burnout). For any circuit, read read_guide("redstone"), declare named inputs/outputs and tests in the spec's "circuit" section — they run on every build like unit tests, and the summary reports them — and use simulate to try scenarios, measure delays and catch location-dependent designs. Never hand over a circuit whose tests fail.

Building on the player's world: the player can give you a world (or a schematic) and a point to build at. worlds lists their saved worlds; import_site reads an area (centre + radius, default where they stand) into a new project and returns a terrain report: ground heights, water, trees, flat spots, existing builds. Read read_guide("terrain"), then build on it with edit_build (the spec already has "site"): flatten plots with blending, foundations down to the ground, paths that follow it, ground:true to stand trees and components on it, ground()/surface() in scripts. Coordinates are relative to the chosen point. Exports go back to the same world coordinates: a copy of the world with the build in it (export_build format "world"), a vanilla data pack with /fill commands and undo (no mods), or schematics for //paste -o.

Rules: minecraftVersion is strict — only blocks that exist in that version are accepted; errors suggest alternatives and list_blocks checks availability. Coordinates: +X east, +Y up, +Z south (north = -Z); y=0 is ground level. Give every operation a short "id".`;

const GUIDE_TOPICS = [
  'workflow',
  'spec',
  'principles',
  'roofs',
  'styles',
  'palettes',
  'details',
  'landscape',
  'terrain',
  'scripts',
  'versions',
  'redstone',
  'examples',
] as const;

// A fixed-length array, not z.tuple: a tuple becomes draft-07 `items: [...]`, which the Claude API
// (JSON Schema 2020-12) rejects, dropping every tool that uses it.
const vec3 = z.array(z.number().int()).length(3).describe('[x, y, z]');
const VIEW_NAMES = [
  'iso',
  'iso_nw',
  'iso_ne',
  'iso_sw',
  'front',
  'back',
  'left',
  'right',
  'top',
  'user',
] as const;

function text(t: string): Content[number] {
  return { type: 'text', text: t };
}

function errorResult(message: string): CallToolResult {
  return { content: [text(message)], isError: true };
}

async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export function buildMcpServer({ builds, config }: McpDeps): McpServer {
  const server = new McpServer(
    { name: 'vibeschem', version: APP_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const outcome = async (out: BuildOutcome, preview: boolean): Promise<CallToolResult> => {
    if (!out.ok) {
      return errorResult(
        `The spec was not applied — fix these and call again:\n- ${out.errors.join('\n- ')}`,
      );
    }
    const content: Content = [text(builds.summary(out.build))];
    if (preview) {
      const r = await builds.render({ views: ['iso'], size: 760 });
      for (const img of r.images)
        content.push({ type: 'image', data: img.png.toString('base64'), mimeType: 'image/png' });
      if (r.note) content.push(text(r.note));
    } else {
      void builds.showViewer();
    }
    return { content };
  };

  server.registerTool(
    'read_guide',
    {
      title: 'Read building guide',
      description: `Expert building guides and the full BuildSpec reference. Topics: ${GUIDE_TOPICS.join(', ')}. Start with "workflow"; read "spec" before writing your first BuildSpec.`,
      inputSchema: { topic: z.enum(GUIDE_TOPICS) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) =>
      guarded(async () => {
        const file = join(config.guidesDir, `${topic}.md`);
        if (!existsSync(file)) {
          const have = existsSync(config.guidesDir)
            ? readdirSync(config.guidesDir).join(', ')
            : 'none';
          return errorResult(`Guide "${topic}" not found (available: ${have}).`);
        }
        return { content: [text(readFileSync(file, 'utf8'))] };
      }),
  );

  server.registerTool(
    'create_build',
    {
      title: 'Create build',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      description:
        'Build a Minecraft structure in VibeSchem: compile a BuildSpec and show it in the live 3D viewer (opens the browser if needed). Returns a summary and a rendered preview image. Starts a new project (with its own version history) unless newProject is false, which replaces the current build as a new version. Errors (unknown blocks for the version, bad fields) come back as a list to fix. BuildSpec: {name, minecraftVersion, palette?, components?, operations:[{type, id, …}], circuit?}; operation types: box, line, cylinder, cone, sphere, dome, polygon, roof, arch, blocks, layers, terrain, tree, scatter, replace, flatten, foundation, path, group, place, script — see read_guide("spec"). site = build on an area imported with import_site (see read_guide("terrain")). circuit = named redstone inputs/outputs + tests, run by the simulator on every build — see read_guide("redstone").',
      inputSchema: {
        spec: z.record(z.string(), z.unknown()).describe('The BuildSpec object.'),
        newProject: z
          .boolean()
          .optional()
          .describe('Default true. false = new version of the current project.'),
        label: z.string().optional().describe('Short name for this version in the history.'),
        preview: z.boolean().optional().describe('Return a rendered image (default true).'),
      },
    },
    async ({ spec, newProject, label, preview }) =>
      guarded(async () =>
        outcome(
          await builds.create(spec, {
            newProject: newProject ?? true,
            ...(label ? { label } : {}),
          }),
          preview ?? true,
        ),
      ),
  );

  server.registerTool(
    'edit_build',
    {
      title: 'Edit build',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      description:
        'Change the current VibeSchem Minecraft build without resending it; saved as a new version. "edits" (preferred) target operations by id: {op:"add", operations, after?|before?|into?: id} · {op:"replace", id, with} · {op:"update", id, set:{field: value|null}} · {op:"remove", ids} · {op:"palette", set:{key: entry|null}} · {op:"component", name, set} · {op:"meta", set:{name?, minecraftVersion?, anchor?, …}} · {op:"circuit", set:{inputs?, outputs?: {name: io|null}, tests?: [test | {name, remove:true}], settleTicks?}} (redstone I/O and tests, merged by name). "patch" accepts RFC 6902 JSON Patch on the spec for anything else.',
      inputSchema: {
        edits: z.array(z.object({ op: z.string() }).passthrough()).optional(),
        patch: z.array(z.object({ op: z.string(), path: z.string() }).passthrough()).optional(),
        label: z.string().optional(),
        preview: z.boolean().optional().describe('Return a rendered image (default true).'),
      },
    },
    async ({ edits, patch, label, preview }) =>
      guarded(async () =>
        outcome(
          await builds.edit({
            ...(edits ? { edits: edits as unknown as Edit[] } : {}),
            ...(patch ? { patch: patch as never } : {}),
            ...(label ? { label } : {}),
          }),
          preview ?? true,
        ),
      ),
  );

  server.registerTool(
    'get_build',
    {
      title: 'Get current build',
      description:
        'Summary of the current build (size, materials, warnings, open feedback) and, with spec: true, the full BuildSpec — use it to continue work started in another session.',
      inputSchema: { spec: z.boolean().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ spec }) =>
      guarded(async () => {
        const cur = builds.requireCurrent();
        const content: Content = [text(builds.summary(cur))];
        if (spec) content.push(text(JSON.stringify(cur.record.spec)));
        return { content };
      }),
  );

  server.registerTool(
    'render_views',
    {
      title: 'Render views',
      description:
        'Render the current build with real textures, in one image. views: iso (front-right, default), iso_nw, iso_ne, iso_sw, front (south), back, left (west), right (east), top, user (what the user is looking at right now). focus: frame a region {from, to} for a close-up. cutY: hide everything above this y to see inside (section).',
      inputSchema: {
        views: z.array(z.enum(VIEW_NAMES)).max(4).optional(),
        focus: z.object({ from: vec3, to: vec3 }).optional(),
        cutY: z.number().int().optional(),
        size: z
          .number()
          .int()
          .min(256)
          .max(1400)
          .optional()
          .describe('Pixel size of each view (default 640).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ views, focus, cutY, size }) =>
      guarded(async () => {
        const r = await builds.render({
          views: (views ?? ['iso', 'iso_nw']) as ViewName[],
          ...(focus ? { focus: { from: focus.from as Vec3, to: focus.to as Vec3 } } : {}),
          ...(cutY !== undefined ? { cutY } : {}),
          size: size ?? 640,
        });
        const content: Content = r.images.map((img) => ({
          type: 'image' as const,
          data: img.png.toString('base64'),
          mimeType: 'image/png',
        }));
        if (r.note) content.push(text(r.note));
        return { content };
      }),
  );

  server.registerTool(
    'get_feedback',
    {
      title: 'Get user feedback',
      description:
        'The notes the user pinned in the viewer (on a block or a region), with the block there and the id/path of the operation that placed it, plus requests like switching Minecraft version. Call this whenever the user asks for changes. By default also returns an image with the pins drawn.',
      inputSchema: {
        all: z.boolean().optional().describe('Include resolved notes.'),
        image: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ all, image }) =>
      guarded(async () => {
        const open = builds
          .feedback()
          .filter((f) => f.status === 'open')
          .sort((a, b) => a.createdAt - b.createdAt);
        const items = all ? builds.feedback() : open;
        if (items.length === 0)
          return {
            content: [
              text('No open feedback notes. The user may describe changes in chat instead.'),
            ],
          };
        const lines = items.map((f) => {
          const where = f.region
            ? `region ${f.region.from.join(',')} → ${f.region.to.join(',')}`
            : f.pos
              ? `at ${f.pos.join(',')}`
              : 'whole build';
          const num = open.indexOf(f) + 1;
          const parts = [
            `${num ? `#${num} ` : ''}[${f.id}] (${f.status}, v${f.n ?? '?'}) ${where}: "${f.text}"`,
          ];
          if (f.block) parts.push(`   block: ${f.block.replace('minecraft:', '')}`);
          if (f.source) parts.push(`   placed by: ${f.source}`);
          if (f.targetVersion) parts.push(`   wants Minecraft ${f.targetVersion}`);
          if (f.reply) parts.push(`   your reply: ${f.reply}`);
          return parts.join('\n');
        });
        const content: Content = [text(lines.join('\n'))];
        const pinned = open.filter((f) => f.pos || f.region);
        if ((image ?? true) && pinned.length > 0) {
          // The user's own view, plus a close-up framing every open pin.
          const pts = pinned.flatMap((f) =>
            f.region ? [f.region.from, f.region.to] : [f.pos as Vec3],
          );
          const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i] as number)) - 6) as Vec3;
          const hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i] as number)) + 6) as Vec3;
          const r = await builds.render({
            views: ['user', 'iso'],
            size: 640,
            pins: true,
            focus: { from: lo, to: hi },
          });
          for (const img of r.images)
            content.push({
              type: 'image',
              data: img.png.toString('base64'),
              mimeType: 'image/png',
            });
        }
        return { content };
      }),
  );

  server.registerTool(
    'resolve_feedback',
    {
      title: 'Resolve feedback',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'Mark notes the user pinned on blocks in the VibeSchem viewer as done after addressing them; the reply is shown to the user next to the note.',
      inputSchema: { ids: z.array(z.string()).min(1), reply: z.string().optional() },
    },
    async ({ ids, reply }) =>
      guarded(async () => {
        const done = builds.resolveFeedback(ids, reply);
        return { content: [text(`Resolved ${done.length} note(s).`)] };
      }),
  );

  server.registerTool(
    'inspect',
    {
      title: 'Inspect blocks',
      description:
        'Read exactly what is in the build. With only "from": the block at that spot and the operation that placed it. With "from" and "to": text slices of the region (one character per block + legend + which operations placed what), along axis y (floor plans, default), z (front elevations) or x (side elevations). Keep regions small (≤ ~40×40 per slice).',
      inputSchema: { from: vec3, to: vec3.optional(), axis: z.enum(['y', 'z', 'x']).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ from, to, axis }) =>
      guarded(async () => {
        if (!to) {
          const hit = builds.inspectAt(from as Vec3);
          return {
            content: [
              text(
                `${from.join(',')}: ${hit.state}${hit.source ? `\nplaced by: ${hit.source}` : ''}`,
              ),
            ],
          };
        }
        return { content: [text(builds.inspectRegion(from as Vec3, to as Vec3, axis ?? 'y'))] };
      }),
  );

  server.registerTool(
    'list_blocks',
    {
      title: 'List blocks',
      description:
        'Check blocks against a Minecraft version (default: the current build\'s). "query" searches names (e.g. "deepslate stairs"); "names" checks exact blocks and shows their properties, or when they were added if missing. Also lists the supported versions when called with versions: true.',
      inputSchema: {
        query: z.string().optional(),
        names: z.array(z.string()).max(60).optional(),
        version: z.string().optional(),
        versions: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, names, version, versions }) =>
      guarded(async () => {
        if (versions) {
          const majors = new Map<string, string[]>();
          for (const v of listVersions())
            majors.set(v.major, [...(majors.get(v.major) ?? []), v.id]);
          return {
            content: [
              text([...majors.entries()].map(([m, ids]) => `${m}: ${ids.join(', ')}`).join('\n')),
            ],
          };
        }
        const vid = version ?? builds.current?.result.version.id ?? LATEST_VERSION.id;
        const info = resolveVersion(vid);
        if (!info) return errorResult(`Unknown version "${vid}".`);
        const cat = getCatalog(info);
        const lines: string[] = [`Minecraft ${info.id} (${cat.size} blocks)`];
        if (query) {
          const hits = cat.search(query, 80);
          lines.push(hits.length ? hits.join(', ') : `No block matches "${query}".`);
        }
        for (const raw of names ?? []) {
          const name = raw.replace(/^minecraft:/, '').replace(/\[.*$/, '');
          const real = cat.resolveName(name);
          if (real) {
            const props = cat.props(real) ?? [];
            lines.push(
              `✓ ${real}${real !== name ? ` (named ${real} in this version)` : ''}${props.length ? ` [${props.map((p) => `${p.name}=${p.values.join('|')}`).join(', ')}]` : ''}`,
            );
          } else {
            const since = blockAddedIn(name);
            lines.push(
              `✗ ${name}: ${since ? `added in ${since}` : 'unknown'}${cat.suggest(name, 3).length ? ` — try ${cat.suggest(name, 3).join(', ')}` : ''}`,
            );
          }
        }
        return { content: [text(lines.join('\n'))] };
      }),
  );

  server.registerTool(
    'worlds',
    {
      title: 'List Minecraft worlds',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "The player's Minecraft Java worlds on this computer (official launcher, Prism, MultiMC, CurseForge, Modrinth): id, name, version, where the player stands, dimensions. Use an id with import_site. Worlds are only read.",
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        const list = builds.worlds();
        if (!list.length)
          return {
            content: [
              text(
                'No Minecraft worlds found in the usual saves folders. Ask the player for the world folder path (import_site accepts it), or for a schematic file.',
              ),
            ],
          };
        const lines = list.slice(0, 40).map((w) => {
          const played = w.lastPlayed ? new Date(w.lastPlayed).toISOString().slice(0, 10) : '?';
          const pos = w.player
            ? `player at ${w.player.pos.join(' ')} (${w.player.dimension.replace('minecraft:', '')})`
            : 'player position unknown';
          return `- ${w.id} "${w.name}" · ${w.version ?? 'unknown version'} · ${w.gameMode ?? ''} · last played ${played} · ${pos} · ${w.launcher}`;
        });
        return {
          content: [text(`${list.length} world(s), most recent first:\n${lines.join('\n')}`)],
        };
      }),
  );

  server.registerTool(
    'import_site',
    {
      title: 'Import a site to build on',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      description:
        "Read an area of the player's Minecraft world (or a schematic file) and start a new project on it, shown in the viewer: then build on the real terrain with edit_build. world: id or name from worlds, or a world folder path. center: [x, z] or [x, y, z] in world coordinates (default: where the player stands); radius: half-size of the square area (default 48, max 128). Or file: a .schem/.schematic/.litematic/.nbt path. The world is only read. Returns the terrain report (as the terrain tool) and a preview.",
      inputSchema: {
        world: z.string().optional(),
        center: z
          .array(z.number())
          .min(2)
          .max(3)
          .optional()
          .describe('[x, z] or [x, y, z], world coordinates'),
        radius: z.number().int().min(4).max(128).optional(),
        dimension: z
          .string()
          .optional()
          .describe("minecraft:overworld (default: the player's), minecraft:the_nether, …"),
        file: z
          .string()
          .optional()
          .describe('A schematic file to use as the site instead of a world.'),
        name: z.string().optional(),
      },
    },
    async ({ world, center, radius, dimension, file, name }) =>
      guarded(async () => {
        if (!world && !file) return errorResult('Give "world" (see worlds) or "file".');
        const { site, outcome: out } = file
          ? await builds.importSchematicFile(file, name)
          : await builds.importWorldSite({
              world: world as string,
              ...(center ? { center } : {}),
              ...(radius ? { radius } : {}),
              ...(dimension ? { dimension } : {}),
              ...(name ? { name } : {}),
              allowPath: true,
            });
        if (!out.ok) return errorResult(out.errors.join('\n'));
        const content: Content = [
          text(
            `${builds.terrain()}\n\nThe project "${out.build.record.spec.name}" (site ${site.info.id}) is open in the viewer. Add operations with edit_build ({op:"add"}); keep "site" and minecraftVersion ${site.version} in the spec.`,
          ),
        ];
        const r = await builds.render({ views: ['iso'], size: 760 });
        for (const img of r.images)
          content.push({ type: 'image', data: img.png.toString('base64'), mimeType: 'image/png' });
        return { content };
      }),
  );

  server.registerTool(
    'terrain',
    {
      title: 'Terrain report',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'The ground of the current site as it is now: height map in spec coordinates (y of the top ground block), water, trees, flattest open spots, existing builds, and how spec coordinates map to the world. from/to zoom into a region; step sets the map spacing.',
      inputSchema: {
        from: vec3.optional(),
        to: vec3.optional(),
        step: z.number().int().min(1).max(32).optional(),
      },
    },
    async ({ from, to, step }) =>
      guarded(async () => ({
        content: [
          text(
            builds.terrain({
              ...(step ? { step } : {}),
              ...(from && to ? { from: from as Vec3, to: to as Vec3 } : {}),
            }),
          ),
        ],
      })),
  );

  server.registerTool(
    'export_build',
    {
      title: 'Export build',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Export the current VibeSchem build for Minecraft. Formats: schem (Sponge v2, WorldEdit 7+/FAWE, 1.13+, default), schem3 (Sponge v3, WorldEdit 7.3+), schematic (MCEdit, WorldEdit 6 for 1.8–1.12), litematic (Litematica), nbt (vanilla structure block / /place template), datapack (vanilla commands, no mods: /function …/build builds it where the player stands — or, on a site, at its world position — and …/undo removes it), materials (CSV shopping list), world (builds on a site imported from a world only: a new copy of that world with the build in it; the original is never changed). On a site the schematics hold only the changed area and keep its world position (WorldEdit //paste -o). saveTo writes the file straight into the player's Minecraft folder: worldedit (config/worldedit/schematics, single player), litematica (schematics/) or downloads, under a new name if that file already exists (never overwrites); saveTo world (datapack only) installs the pack into a world's datapacks folder. Without saveTo returns a download link. The viewer has an Export button too.",
      inputSchema: {
        format: z
          .enum([
            'schem',
            'schem3',
            'schematic',
            'litematic',
            'nbt',
            'datapack',
            'materials',
            'world',
          ])
          .optional(),
        saveTo: z.enum(['worldedit', 'litematica', 'downloads', 'world']).optional(),
        world: z
          .string()
          .optional()
          .describe(
            'datapack + saveTo "world": the world id (from worlds) to install it in; default the site\'s world.',
          ),
        name: z.string().optional().describe('format "world": name of the new world copy.'),
      },
    },
    async ({ format, saveTo, world, name }) =>
      guarded(async () => {
        if (format === 'world') {
          const copy = await builds.exportWorldCopy(name);
          return {
            content: [
              text(
                `Created the world "${copy.name}" (folder ${copy.path}) with the build in it: ${copy.blocks.toLocaleString('en-US')} blocks in ${copy.chunks} chunks. The original world is untouched. The player opens "${copy.name}" from Singleplayer; light is recomputed when the area loads.`,
              ),
            ],
          };
        }
        if (format === 'datapack' && saveTo === 'world') {
          const inst = builds.installDatapack(world);
          return {
            content: [
              text(
                `Installed the data pack in "${inst.world}" (${inst.path}). In that world (cheats on): /reload, then /function ${inst.functionId}/build — undo with /function ${inst.functionId}/undo.${inst.warnings.length ? `\nNotes: ${inst.warnings.join(' ')}` : ''}`,
              ),
            ],
          };
        }
        if (saveTo === 'world') return errorResult('saveTo "world" is for format "datapack".');
        const formats = builds.formats();
        const fmt = (format ?? formats.find((f) => f.recommended)?.id ?? 'schem') as ExportFormat;
        if (saveTo) {
          const saved = builds.saveExport(fmt, saveTo);
          return {
            content: [
              text(
                `Saved ${saved.path}${saved.warnings.length ? `\nWarnings: ${saved.warnings.join('; ')}` : ''}`,
              ),
            ],
          };
        }
        const out = builds.export(fmt);
        const targets = builds
          .exportTargets()
          .filter((t) => t.exists)
          .map((t) => `${t.id} (${t.path})`);
        return {
          content: [
            text(
              `${out.filename} (${(out.buffer.length / 1024).toFixed(1)} KB): ${config.baseUrl}/api/export/${fmt}` +
                (out.warnings.length ? `\nWarnings: ${out.warnings.join('; ')}` : '') +
                (targets.length ? `\nCan also save directly to: ${targets.join(', ')}` : ''),
            ),
          ],
        };
      }),
  );

  server.registerTool(
    'history',
    {
      title: 'Version history',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'List the saved versions of the current VibeSchem Minecraft build, or restore one (restoring adds a new version, nothing is lost).',
      inputSchema: {
        action: z.enum(['list', 'restore']),
        n: z.number().int().positive().optional(),
      },
    },
    async ({ action, n }) =>
      guarded(async () => {
        if (action === 'restore') {
          if (!n) return errorResult('Pass n, the version to restore.');
          return outcome(await builds.restore(n), true);
        }
        const rows = builds
          .history()
          .map(
            (v) =>
              `v${v.n} ${new Date(v.createdAt).toISOString().slice(0, 16).replace('T', ' ')} · ${v.label} · ${v.size.join('×')} · ${v.blockCount} blocks`,
          );
        return { content: [text(rows.join('\n') || 'No versions yet.')] };
      }),
  );

  server.registerTool(
    'projects',
    {
      title: 'Projects',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'List the saved VibeSchem Minecraft build projects, open one in the 3D viewer (it becomes the current build), or rename one.',
      inputSchema: {
        action: z.enum(['list', 'open', 'rename']),
        id: z.string().optional(),
        name: z.string().optional(),
      },
    },
    async ({ action, id, name }) =>
      guarded(async () => {
        if (action === 'open') {
          if (!id) return errorResult('Pass the project id.');
          const b = await builds.open(id);
          return { content: [text(builds.summary(b))] };
        }
        if (action === 'rename') {
          if (!id || !name) return errorResult('Pass id and name.');
          builds.rename(id, name);
          return { content: [text(`Renamed to "${name}".`)] };
        }
        const cur = builds.current?.project.id;
        const rows = builds
          .projects()
          .map(
            (p) =>
              `${p.id === cur ? '▶ ' : '  '}${p.id} · "${p.name}" · ${p.minecraftVersion} · ${p.versions} versions · ${p.blockCount} blocks · ${new Date(p.updatedAt).toISOString().slice(0, 10)}`,
          );
        return { content: [text(rows.join('\n') || 'No projects yet.')] };
      }),
  );

  server.registerTool(
    'focus_view',
    {
      title: 'Point the viewer',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        "Move the camera of the user's VibeSchem 3D viewer to a region of the Minecraft build and highlight it, optionally with a short message — to show them what you mean or changed.",
      inputSchema: { from: vec3, to: vec3.optional(), message: z.string().max(200).optional() },
    },
    async ({ from, to, message }) =>
      guarded(async () => {
        builds.focus(from as Vec3, (to ?? from) as Vec3, message);
        return { content: [text('Done.')] };
      }),
  );

  server.registerTool(
    'simulate',
    {
      title: 'Test the redstone',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Run the current VibeSchem build's redstone in a simulator that follows Minecraft Java's own mechanics for the build's version: game ticks (20/s; repeater delay 1 = 2 ticks), neighbour and shape updates in the game's order, scheduled-tick priorities, quasi-connectivity, pistons with slime/honey and 0-tick spitting, observers, comparators reading containers, torch burnout. Runs the stored tests (spec.circuit.tests) or the `tests` given here, and reports pass/fail per test with failing cases, latencies (\"expect … within\"), measured clock periods, traces of signal changes, and problems such as torches burning out or blocks popping off. `inputs`/`outputs` add or override named I/O for this run only. `locations` (2–16) re-runs at other world positions, where dust and pistons update in another order, to catch location-dependent designs. `show` plays one test live in the user's viewer. Test format and step reference: read_guide(\"redstone\").",
      inputSchema: {
        tests: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'Tests to run instead of the stored ones: {name, steps:[{set:{A:1}}, {wait:4}, {expect:{L:1}, within:10}, …], forAll?:{A:[0,15]}, samples?, trace?:[names]}.',
          ),
        only: z.array(z.string()).optional().describe('Run only these stored tests (by name).'),
        inputs: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'Extra named inputs for this run: {"A": {"at": [x,y,z]}} (lever, button, plate…; "as" to place a block).',
          ),
        outputs: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'Extra named outputs: {"Q": {"at": [x,y,z]}} or a bus {"at": [[x,y,z], …]}; "read": "power" for 0–15.',
          ),
        locations: z.number().int().min(1).max(16).optional(),
        show: z.string().optional().describe('Name of a test to play live in the viewer.'),
      },
    },
    async ({ tests, only, inputs, outputs, locations, show }) =>
      guarded(async () => {
        const r = builds.simulate({
          ...(tests ? { tests } : {}),
          ...(only ? { only } : {}),
          ...(inputs ? { inputs } : {}),
          ...(outputs ? { outputs } : {}),
          ...(locations ? { locations } : {}),
          ...(show ? { show } : {}),
        });
        return { content: [text(r.text)] };
      }),
  );

  return server;
}

export async function startMcpServer(deps: McpDeps): Promise<McpServer> {
  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());
  return server;
}
