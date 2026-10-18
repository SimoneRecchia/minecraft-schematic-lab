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
import { openViewer } from '../openBrowser';

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
  'scripts',
  'versions',
  'examples',
] as const;

const vec3 = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
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
      openViewerIfClosed();
    }
    return { content };
  };

  const openViewerIfClosed = () => openViewer(`${config.baseUrl}/`);

  server.registerTool(
    'read_guide',
    {
      title: 'Read building guide',
      description: `Expert building guides and the full BuildSpec reference. Topics: ${GUIDE_TOPICS.join(', ')}. Start with "workflow"; read "spec" before writing your first BuildSpec.`,
      inputSchema: { topic: z.enum(GUIDE_TOPICS) },
      annotations: { readOnlyHint: true },
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
      description:
        'Compile a BuildSpec and show it in the live viewer (opens the browser if needed). Returns a summary and a rendered preview image. Starts a new project (with its own version history) unless newProject is false, which replaces the current build as a new version. Errors (unknown blocks for the version, bad fields) come back as a list to fix. BuildSpec: {name, minecraftVersion, palette?, components?, operations:[{type, id, …}]}; operation types: box, line, cylinder, cone, sphere, dome, polygon, roof, arch, blocks, layers, terrain, tree, scatter, replace, group, place, script — see read_guide("spec").',
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
      description:
        'Change the current build without resending it; saved as a new version. "edits" (preferred) target operations by id: {op:"add", operations, after?|before?|into?: id} · {op:"replace", id, with} · {op:"update", id, set:{field: value|null}} · {op:"remove", ids} · {op:"palette", set:{key: entry|null}} · {op:"component", name, set} · {op:"meta", set:{name?, minecraftVersion?, anchor?, …}}. "patch" accepts RFC 6902 JSON Patch on the spec for anything else.',
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      description:
        'Mark feedback notes as done after addressing them; the reply is shown to the user next to the note.',
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
    'export_build',
    {
      title: 'Export build',
      description:
        "Export the current build. Formats: schem (Sponge v2, WorldEdit 7+/FAWE, 1.13+, default), schem3 (Sponge v3, WorldEdit 7.3+), schematic (MCEdit, WorldEdit 6 for 1.8–1.12), litematic (Litematica), nbt (vanilla structure block / /place template), materials (CSV shopping list). saveTo writes the file straight into the player's Minecraft folder: worldedit (config/worldedit/schematics, single player), litematica (schematics/) or downloads. Without saveTo returns a download link. The viewer has an Export button too.",
      inputSchema: {
        format: z
          .enum(['schem', 'schem3', 'schematic', 'litematic', 'nbt', 'materials'])
          .optional(),
        saveTo: z.enum(['worldedit', 'litematica', 'downloads']).optional(),
      },
    },
    async ({ format, saveTo }) =>
      guarded(async () => {
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
      description:
        'List the saved versions of the current project, or restore one (restoring adds a new version, nothing is lost).',
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
      description:
        'List saved projects, open one in the viewer (it becomes the current build), or rename one.',
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
      description:
        "Move the user's viewer camera to a region and highlight it, optionally with a short message — to show them what you mean or changed.",
      inputSchema: { from: vec3, to: vec3.optional(), message: z.string().max(200).optional() },
    },
    async ({ from, to, message }) =>
      guarded(async () => {
        builds.focus(from as Vec3, (to ?? from) as Vec3, message);
        return { content: [text('Done.')] };
      }),
  );

  return server;
}

export async function startMcpServer(deps: McpDeps): Promise<McpServer> {
  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());
  return server;
}
