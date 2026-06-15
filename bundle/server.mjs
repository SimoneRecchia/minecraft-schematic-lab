#!/usr/bin/env node

// apps/server/src/index.ts
import { existsSync as existsSync4 } from "node:fs";
import { createServer } from "node:net";

// apps/server/src/config.ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
function resolveWebDist() {
  const candidates = [];
  if (process.env.WEB_DIST_PATH) {
    candidates.push(process.env.WEB_DIST_PATH);
  }
  candidates.push(fileURLToPath(new URL("./web/dist", import.meta.url)));
  candidates.push(fileURLToPath(new URL("../../web/dist", import.meta.url)));
  for (const dir of candidates) {
    if (existsSync(`${dir}/index.html`)) {
      return dir;
    }
  }
  return candidates[candidates.length - 1];
}
function loadConfig(argv = process.argv.slice(2)) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "", 10) || 8765;
  const mcpMode = argv.includes("--mcp") || process.env.MCP === "1";
  const baseUrl = `http://${host}:${port}`;
  const webDist = resolveWebDist();
  return { host, port, baseUrl, mcpMode, webDist };
}

// apps/server/src/git/GitProjectService.ts
import { existsSync as existsSync2, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execa } from "execa";

// apps/server/src/httpError.ts
var HttpError = class extends Error {
  statusCode;
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
};
function statusCodeOf(error) {
  if (error instanceof HttpError) return error.statusCode;
  return 500;
}
function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// apps/server/src/git/GitProjectService.ts
var GitProjectService = class {
  /** Resolve and validate a path: symlink-safe, must live under (not be) the home directory. */
  resolveSafePath(input) {
    if (!input || !input.trim()) {
      throw new HttpError(400, "A project path is required.");
    }
    const abs = isAbsolute(input) ? input : resolve(homedir(), input);
    let existing = abs;
    while (!existsSync2(existing) && dirname(existing) !== existing) {
      existing = dirname(existing);
    }
    const realExisting = realpathSync(existing);
    const remainder = relative(existing, abs);
    const realAbs = remainder ? join(realExisting, remainder) : realExisting;
    const realHome = realpathSync(homedir());
    if (realAbs === realHome) {
      throw new HttpError(400, "Refusing to use the home directory itself; pick a subfolder.");
    }
    if (!realAbs.startsWith(realHome + sep)) {
      throw new HttpError(400, "Project path must be inside your home directory.");
    }
    return realAbs;
  }
  ensureDir(dir) {
    mkdirSync(dir, { recursive: true });
  }
  async checkGitAvailable() {
    try {
      await execa("git", ["--version"]);
    } catch {
      throw new HttpError(500, "git is not installed. Install git and try again.");
    }
  }
  async isRepo(dir) {
    try {
      const { stdout } = await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }
  async initRepo(dir) {
    await execa("git", ["init", "-b", "main"], { cwd: dir });
  }
  async readLocalIdentity(dir) {
    const get = async (key) => {
      try {
        const { stdout } = await execa("git", ["config", "--local", key], { cwd: dir });
        return stdout.trim() || null;
      } catch {
        return null;
      }
    };
    return { name: await get("user.name"), email: await get("user.email") };
  }
  async setLocalIdentity(dir, name, email) {
    await execa("git", ["config", "--local", "user.name", name], { cwd: dir });
    await execa("git", ["config", "--local", "user.email", email], { cwd: dir });
  }
  writeFiles(dir, files) {
    this.ensureDir(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, "utf8");
    }
  }
  async commitAll(cwd, message) {
    await execa("git", ["add", "-A"], { cwd });
    const status = await execa("git", ["status", "--porcelain"], { cwd });
    if (!status.stdout.trim()) {
      return { committed: false, commit: null };
    }
    await execa("git", ["commit", "-m", message], { cwd });
    const head = await execa("git", ["rev-parse", "HEAD"], { cwd });
    return { committed: true, commit: head.stdout.trim() };
  }
  async currentBranch(cwd) {
    try {
      const { stdout } = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
  async listBranches(cwd) {
    try {
      const { stdout } = await execa("git", ["branch", "--format=%(refname:short)"], { cwd });
      return stdout.split("\n").map((b) => b.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  async createBranch(cwd, name) {
    this.assertGitRef(name, "branch");
    await execa("git", ["branch", name], { cwd });
  }
  async checkoutBranch(cwd, name) {
    this.assertGitRef(name, "branch");
    await execa("git", ["checkout", name], { cwd });
  }
  async remotes(cwd) {
    try {
      const { stdout } = await execa("git", ["remote"], { cwd });
      return stdout.split("\n").map((r) => r.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  async setRemote(cwd, name, url) {
    this.assertGitRef(name, "remote");
    this.assertRemoteUrl(url);
    const existing = await this.remotes(cwd);
    if (existing.includes(name)) {
      await execa("git", ["remote", "set-url", name, url], { cwd });
    } else {
      await execa("git", ["remote", "add", name, url], { cwd });
    }
  }
  async push(cwd, remote, branch) {
    this.assertGitRef(remote, "remote");
    this.assertGitRef(branch, "branch");
    const { stdout, stderr } = await execa("git", ["push", "--set-upstream", remote, branch], {
      cwd
    });
    return [stdout, stderr].filter(Boolean).join("\n");
  }
  assertGitRef(name, kind) {
    if (typeof name !== "string" || !name.trim()) {
      throw new HttpError(400, `A ${kind} name is required.`);
    }
    if (name.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(name)) {
      throw new HttpError(400, `Invalid ${kind} name: "${name}".`);
    }
  }
  assertRemoteUrl(url) {
    if (typeof url !== "string" || !url.trim()) {
      throw new HttpError(400, "A remote URL is required.");
    }
    if (url.startsWith("-") || !/^(https:\/\/|git@|ssh:\/\/)[\w@.:/~-]+$/.test(url)) {
      throw new HttpError(400, "Remote URL must be an https or ssh git URL.");
    }
  }
};

// apps/server/src/http/createHttpServer.ts
import { existsSync as existsSync3 } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

// apps/server/src/http/routes/exportRoutes.ts
function registerExportRoutes(app, sm) {
  app.get("/api/session/export.schem", async (request, reply) => {
    const { version } = request.query;
    const schematicVersion = version === "3" ? 3 : 2;
    const { buffer, filename } = await sm.exportSchematic(schematicVersion);
    return reply.type("application/octet-stream").header("content-disposition", `attachment; filename="${filename}"`).send(buffer);
  });
}

// packages/shared/src/blockColor.ts
function cleanName(state) {
  const s = state.toLowerCase();
  const withoutNs = s.includes(":") ? s.slice(s.indexOf(":") + 1) : s;
  return withoutNs.replace(/\[.*$/, "");
}
var KEYWORD_COLORS = [
  { re: /sea_lantern|prismarine/, hex: "#9fc6bd" },
  { re: /end_rod/, hex: "#e6e2d6" },
  { re: /glass|pane/, hex: "#a9e0f5" },
  { re: /water/, hex: "#3b6feb" },
  { re: /lava|magma/, hex: "#d8662a" },
  { re: /glowstone|shroomlight|redstone_lamp|lantern|torch|lamp|^light$/, hex: "#f4d27a" },
  { re: /mossy/, hex: "#6f7f53" },
  { re: /cobble/, hex: "#7c7c7c" },
  { re: /stone_brick|brick_stone/, hex: "#8a8a8a" },
  { re: /deepslate/, hex: "#3b3b40" },
  { re: /blackstone|basalt|obsidian/, hex: "#2b2b33" },
  { re: /andesite|gravel/, hex: "#9a9a9a" },
  { re: /diorite|quartz|calcite/, hex: "#e7e5dd" },
  { re: /amethyst/, hex: "#9a70c4" },
  { re: /purpur/, hex: "#ab63ab" },
  { re: /granite/, hex: "#9a6a5a" },
  { re: /stone|smooth_stone/, hex: "#8f8f8f" },
  { re: /dark_oak|stripped_spruce/, hex: "#4b3621" },
  { re: /spruce/, hex: "#6f4f2a" },
  { re: /birch/, hex: "#d8c896" },
  { re: /acacia/, hex: "#b5642e" },
  { re: /jungle/, hex: "#9b6b3f" },
  { re: /mangrove/, hex: "#7a3f3a" },
  { re: /cherry/, hex: "#e3b6c8" },
  { re: /bamboo/, hex: "#c2b24a" },
  { re: /crimson/, hex: "#7b3a4b" },
  { re: /warped/, hex: "#2c8374" },
  { re: /oak|plank|log|wood|fence|stripped/, hex: "#9c7a48" },
  { re: /red_sand/, hex: "#bd6b3a" },
  { re: /sand|sandstone/, hex: "#dcd0a0" },
  { re: /nether_brick/, hex: "#3f2226" },
  { re: /brick/, hex: "#9b5b4a" },
  { re: /netherrack|nether/, hex: "#6e3334" },
  { re: /dirt|coarse|podzol|mud|clay|mycelium/, hex: "#7a5a3a" },
  { re: /grass|moss|leaves|vine|fern|kelp|lily/, hex: "#5d8a3a" },
  { re: /snow|powder_snow/, hex: "#eef3f6" },
  { re: /ice/, hex: "#9fd0ff" },
  { re: /wool|concrete|terracotta|glazed/, hex: "#b0795a" },
  { re: /netherite/, hex: "#4a4348" },
  { re: /iron/, hex: "#d8d8d8" },
  { re: /gold/, hex: "#f4d35e" },
  { re: /diamond/, hex: "#5fded0" },
  { re: /emerald/, hex: "#37c87a" },
  { re: /lapis/, hex: "#1f4ea1" },
  { re: /redstone/, hex: "#b32d2d" },
  { re: /coal/, hex: "#2a2a2a" },
  { re: /copper/, hex: "#c1714b" },
  { re: /bone/, hex: "#e3e0ca" }
];
var DYE_COLORS = {
  white: "#e3e6e6",
  light_gray: "#8e8e86",
  gray: "#3f4448",
  black: "#1a1c20",
  brown: "#7a4d2b",
  red: "#a52722",
  orange: "#f07613",
  yellow: "#f8c627",
  lime: "#64ab18",
  green: "#5a7d1d",
  cyan: "#158a8f",
  light_blue: "#3ab3da",
  blue: "#3a3cc1",
  purple: "#8a2db5",
  magenta: "#c14cc4",
  pink: "#ed9ab4"
};
var DYE_NAMES = Object.keys(DYE_COLORS).sort((a, b) => b.length - a.length);
var COLORED_BLOCK = /concrete|wool|terracotta|stained_glass|carpet|candle|shulker_box|glazed|bed|banner/;
function dyeColorFor(name) {
  for (const dye of DYE_NAMES) {
    if (name.startsWith(`${dye}_`)) return DYE_COLORS[dye] ?? null;
  }
  return null;
}
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = h * 31 + s.charCodeAt(i) | 0;
  }
  return (h % 360 + 360) % 360;
}
function isTransparent(state) {
  return /glass|pane|ice|slime|honey|barrier|tinted/.test(cleanName(state));
}
function blockShape(state) {
  const s = cleanName(state);
  if (/stairs/.test(s)) return "stairs";
  if (/slab/.test(s)) return "slab";
  if (/_bars|^bars$|fence|_pane$|chain|end_rod|lightning_rod|_wall$|wall$|_rail|^rail$|ladder/.test(s)) {
    return "thin";
  }
  if (/glass/.test(s)) return "glass";
  return "full";
}
function colorFor(state) {
  const s = state.toLowerCase();
  const name = cleanName(state);
  if (COLORED_BLOCK.test(name)) {
    const dye = dyeColorFor(name);
    if (dye) return dye;
  }
  for (const { re, hex } of KEYWORD_COLORS) {
    if (re.test(s)) return hex;
  }
  return `hsl(${hashHue(s)}, 42%, 55%)`;
}

// packages/shared/src/ids.ts
function newBuildId() {
  return `build_${crypto.randomUUID()}`;
}
function newSessionId() {
  return `session_${crypto.randomUUID()}`;
}

// packages/shared/src/version.ts
var APP_VERSION = "0.1.0";

// apps/server/src/http/routes/healthRoutes.ts
function registerHealthRoutes(app) {
  app.get("/api/health", async () => ({
    ok: true,
    name: "minecraft-schematic-lab",
    version: APP_VERSION
  }));
}

// apps/server/src/http/routes/projectRoutes.ts
function registerProjectRoutes(app, sm) {
  app.post("/api/project/init-local", async (request) => {
    const { path } = request.body ?? {};
    return sm.initLocalProject(String(path ?? ""));
  });
  app.post("/api/project/init-git", async (request) => {
    const { path, userName, userEmail } = request.body ?? {};
    return sm.initGitProject(String(path ?? ""), userName, userEmail);
  });
  app.post("/api/project/save-version", async (request) => {
    const { message } = request.body ?? {};
    return sm.saveVersion(String(message ?? "Update schematic"));
  });
  app.get("/api/project/status", async () => sm.projectStatus());
  app.get("/api/project/branches", async () => sm.branches());
  app.post("/api/project/branch", async (request) => {
    const { name, create } = request.body ?? {};
    return sm.branch(String(name ?? ""), Boolean(create));
  });
  app.post("/api/project/push", async (request) => {
    const { remote, remoteUrl } = request.body ?? {};
    return sm.push(remote ?? "origin", remoteUrl);
  });
}

// apps/server/src/http/routes/sessionRoutes.ts
function registerSessionRoutes(app, sm) {
  app.post("/api/session/create", async () => {
    const session = sm.createSession();
    return { sessionId: session.id };
  });
  app.get("/api/session/current", async () => sm.current());
  app.post("/api/session/build", async (request) => sm.build(request.body));
  app.post("/api/session/validate", async (request) => sm.validate(request.body));
  app.post("/api/session/apply-patch", async (request) => {
    const body = request.body;
    const patch = Array.isArray(body) ? body : body?.patch;
    return sm.applyPatch(patch);
  });
  app.get("/api/session/preview-data", async () => sm.getPreviewData());
  app.get("/api/session/preview.png", async (_request, reply) => {
    const png = await sm.renderImage();
    return reply.type("image/png").send(png);
  });
  app.get("/api/session/list", async () => sm.list());
  app.post("/api/session/select", async (request) => {
    const { sessionId } = request.body ?? {};
    sm.select(String(sessionId ?? ""));
    return { ok: true };
  });
  app.post("/api/session/delete", async (request) => {
    const { sessionId } = request.body ?? {};
    sm.deleteSession(String(sessionId ?? ""));
    return { ok: true };
  });
}

// apps/server/src/http/createHttpServer.ts
var BODY_LIMIT = 8 * 1024 * 1024;
async function createHttpServer(sm, config) {
  const app = Fastify({
    logger: config.mcpMode ? false : { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: BODY_LIMIT
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = statusCodeOf(error);
    reply.status(status).send({ error: messageOf(error) });
  });
  registerHealthRoutes(app);
  registerSessionRoutes(app, sm);
  registerExportRoutes(app, sm);
  registerProjectRoutes(app, sm);
  if (existsSync3(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ error: `Not found: ${request.method} ${request.url}` });
    });
  }
  return app;
}

// apps/server/src/mcp/createMcpServer.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// packages/build-spec/src/schema.ts
import { z } from "zod";
var vec3 = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
var boxOpSchema = z.object({
  type: z.literal("box"),
  from: vec3,
  to: vec3,
  block: z.string().min(1)
});
var hollowBoxOpSchema = z.object({
  type: z.literal("hollow_box"),
  from: vec3,
  to: vec3,
  block: z.string().min(1),
  thickness: z.number().int().positive().optional()
});
var wallRectOpSchema = z.object({
  type: z.literal("wall_rect"),
  from: vec3,
  to: vec3,
  block: z.string().min(1),
  hollow: z.boolean().optional()
});
var gableRoofOpSchema = z.object({
  type: z.literal("gable_roof"),
  from: vec3,
  to: vec3,
  axis: z.enum(["x", "z"]),
  block: z.string().min(1),
  overhang: z.number().int().nonnegative().optional()
});
var cylinderOpSchema = z.object({
  type: z.literal("cylinder"),
  center: vec3,
  radius: z.number().positive(),
  height: z.number().int().positive(),
  block: z.string().min(1),
  hollow: z.boolean().optional()
});
var windowPatternOpSchema = z.object({
  type: z.literal("window_pattern"),
  side: z.enum(["north", "south", "east", "west"]),
  y: z.number().int(),
  positions: z.array(z.number().int()),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  glassBlock: z.string().min(1),
  frameBlock: z.string().min(1).optional()
});
var sphereOpSchema = z.object({
  type: z.literal("sphere"),
  center: vec3,
  radius: z.number().positive(),
  block: z.string().min(1),
  hollow: z.boolean().optional()
});
var pyramidOpSchema = z.object({
  type: z.literal("pyramid"),
  from: vec3,
  to: vec3,
  block: z.string().min(1),
  hollow: z.boolean().optional()
});
var rampOpSchema = z.object({
  type: z.literal("ramp"),
  from: vec3,
  to: vec3,
  axis: z.enum(["x", "z"]),
  block: z.string().min(1)
});
var replaceOpSchema = z.object({
  type: z.literal("replace"),
  from: vec3,
  to: vec3,
  target: z.string().min(1),
  block: z.string().min(1)
});
var blockEntityOpSchema = z.object({
  type: z.literal("block_entity"),
  pos: vec3,
  block: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional()
});
var buildOperationSchema = z.discriminatedUnion("type", [
  boxOpSchema,
  hollowBoxOpSchema,
  wallRectOpSchema,
  gableRoofOpSchema,
  cylinderOpSchema,
  windowPatternOpSchema,
  sphereOpSchema,
  pyramidOpSchema,
  rampOpSchema,
  replaceOpSchema,
  blockEntityOpSchema
]);
var buildSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  minecraftVersion: z.string().min(1),
  size: z.object({
    x: z.number().int().positive(),
    y: z.number().int().positive(),
    z: z.number().int().positive()
  }),
  origin: z.object({
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int()
  }).optional(),
  palette: z.record(z.string(), z.string()),
  operations: z.array(buildOperationSchema),
  metadata: z.object({
    prompt: z.string().optional(),
    style: z.string().optional(),
    notes: z.array(z.string()).optional()
  }).optional()
});

// packages/build-spec/src/validateBuildSpec.ts
function validateBuildSpec(input) {
  const parsed = buildSpecSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data, errors: [] };
  }
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { success: false, errors };
}

// packages/build-spec/src/examples.ts
var fantasyHouseDemo = {
  id: "fantasy-house",
  name: "Fantasy Cottage",
  minecraftVersion: "1.21",
  size: { x: 21, y: 16, z: 19 },
  palette: {
    foundation: "minecraft:cobblestone",
    wall: "minecraft:spruce_planks",
    roof: "minecraft:dark_oak_stairs",
    glass: "minecraft:glass_pane",
    frame: "minecraft:stripped_spruce_log"
  },
  operations: [
    { type: "box", from: [1, 0, 0], to: [19, 1, 15], block: "foundation" },
    { type: "hollow_box", from: [1, 2, 0], to: [19, 9, 15], block: "wall" },
    { type: "gable_roof", from: [1, 9, 0], to: [19, 15, 17], axis: "x", block: "roof", overhang: 1 },
    {
      type: "window_pattern",
      side: "south",
      y: 4,
      positions: [4, 9, 14],
      width: 3,
      height: 4,
      glassBlock: "glass",
      frameBlock: "frame"
    }
  ],
  metadata: { style: "fantasy", prompt: "a cozy spruce cottage with a dark oak gable roof" }
};
var stoneWatchtower = {
  id: "stone-watchtower",
  name: "Stone Watchtower",
  minecraftVersion: "1.21",
  size: { x: 15, y: 26, z: 15 },
  palette: {
    base: "minecraft:cobblestone",
    wall: "minecraft:stone_bricks",
    cap: "minecraft:mossy_stone_bricks"
  },
  operations: [
    { type: "cylinder", center: [7, 0, 7], radius: 6, height: 1, block: "base" },
    { type: "cylinder", center: [7, 1, 7], radius: 6, height: 17, block: "wall", hollow: true },
    { type: "cylinder", center: [7, 18, 7], radius: 6, height: 1, block: "cap" },
    { type: "cylinder", center: [7, 19, 7], radius: 5, height: 1, block: "cap" },
    { type: "cylinder", center: [7, 20, 7], radius: 4, height: 1, block: "cap" },
    { type: "cylinder", center: [7, 21, 7], radius: 3, height: 1, block: "cap" },
    { type: "cylinder", center: [7, 22, 7], radius: 2, height: 1, block: "cap" },
    { type: "cylinder", center: [7, 23, 7], radius: 1, height: 2, block: "cap" }
  ],
  metadata: { style: "medieval" }
};
var logCabin = {
  id: "log-cabin",
  name: "Log Cabin",
  minecraftVersion: "1.21",
  size: { x: 17, y: 13, z: 15 },
  palette: {
    floor: "minecraft:spruce_planks",
    wall: "minecraft:spruce_log",
    roof: "minecraft:dark_oak_planks",
    rail: "minecraft:spruce_fence",
    glass: "minecraft:glass_pane"
  },
  operations: [
    { type: "box", from: [0, 0, 1], to: [12, 0, 13], block: "floor" },
    { type: "hollow_box", from: [0, 1, 1], to: [12, 7, 13], block: "wall" },
    { type: "gable_roof", from: [0, 7, 1], to: [12, 12, 13], axis: "z", block: "roof", overhang: 1 },
    { type: "wall_rect", from: [13, 1, 1], to: [16, 1, 13], block: "rail", hollow: false },
    {
      type: "window_pattern",
      side: "east",
      y: 3,
      positions: [4, 9],
      width: 2,
      height: 3,
      glassBlock: "glass"
    }
  ],
  metadata: { style: "rustic" }
};
var featureShowcase = {
  id: "feature-showcase",
  name: "Feature Showcase",
  minecraftVersion: "1.21",
  size: { x: 25, y: 25, z: 25 },
  palette: {
    stone: "minecraft:stone",
    gold: "minecraft:gold_block",
    dome: "minecraft:glass",
    core: "minecraft:glowstone",
    path: "minecraft:smooth_stone"
  },
  operations: [
    { type: "pyramid", from: [0, 0, 0], to: [16, 8, 16], block: "stone" },
    { type: "replace", from: [0, 0, 0], to: [16, 0, 16], target: "stone", block: "gold" },
    { type: "sphere", center: [8, 15, 8], radius: 5, block: "dome", hollow: true },
    { type: "box", from: [7, 14, 7], to: [9, 16, 9], block: "core" },
    { type: "ramp", from: [17, 0, 4], to: [24, 8, 12], axis: "x", block: "path" }
  ],
  metadata: { style: "showcase" }
};
var exampleSpecs = {
  [fantasyHouseDemo.id]: fantasyHouseDemo,
  [stoneWatchtower.id]: stoneWatchtower,
  [logCabin.id]: logCabin,
  [featureShowcase.id]: featureShowcase
};

// apps/server/src/openBrowser.ts
import { spawn } from "node:child_process";
var opened = false;
function openViewerOnce(url) {
  if (opened) return;
  opened = true;
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
  }
}

// apps/server/src/mcp/toolHelpers.ts
function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
function imageResult(png, caption) {
  const content = [];
  if (caption) content.push({ type: "text", text: caption });
  content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
  return { content };
}

// apps/server/src/mcp/tools/createBuildTool.ts
function registerCreateBuildTool(server, deps) {
  server.registerTool(
    "create_build",
    {
      title: "Create build",
      description: "Compile a BuildSpec into a schematic and show it in the live browser preview (which opens automatically). Use this to build something from scratch or replace the current build.",
      inputSchema: { spec: buildSpecSchema }
    },
    async (args) => {
      try {
        const result = deps.sessionManager.build(args.spec);
        if (result.valid) {
          openViewerOnce(`${deps.config.baseUrl}/`);
        }
        return textResult({
          buildId: result.buildId,
          valid: result.valid,
          errors: result.errors,
          warnings: result.warnings,
          blockCount: result.blockCount,
          palette: result.palette,
          previewUrl: `${deps.config.baseUrl}/`,
          message: result.valid ? "Build created. The browser preview should open automatically (and updates on its own)." : "The spec has validation errors; fix them and try again."
        });
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/tools/getCurrentBuildTool.ts
function registerGetCurrentBuildTool(server, deps) {
  server.registerTool(
    "get_current_build",
    {
      title: "Get current build",
      description: "Return the current BuildSpec, stats (block count, palette, size), warnings, the preview URL and the project status."
    },
    async () => {
      try {
        return textResult(deps.sessionManager.current());
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/tools/validateBuildTool.ts
function registerValidateBuildTool(server, deps) {
  server.registerTool(
    "validate_build",
    {
      title: "Validate build",
      description: "Validate a BuildSpec without changing the current build. Returns validity, errors and warnings (e.g. unknown block ids or out-of-bounds operations).",
      inputSchema: { spec: buildSpecSchema }
    },
    async (args) => {
      try {
        return textResult(deps.sessionManager.validate(args.spec));
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/tools/applyPatchTool.ts
import { z as z2 } from "zod";
function registerApplyPatchTool(server, deps) {
  server.registerTool(
    "apply_patch",
    {
      title: "Apply patch",
      description: "Apply an RFC 6902 JSON Patch to the current BuildSpec and rebuild. Use this for incremental changes (e.g. swap a palette block, add an operation) instead of resending the whole spec.",
      inputSchema: { patch: z2.array(z2.unknown()) }
    },
    async (args) => {
      try {
        const result = deps.sessionManager.applyPatch(args.patch);
        openViewerOnce(`${deps.config.baseUrl}/`);
        return textResult(result);
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/tools/renderPreviewTool.ts
function registerRenderPreviewTool(server, deps) {
  server.registerTool(
    "render_preview",
    {
      title: "Render preview (data)",
      description: "Return a compact summary of the current build: size and a per-block-state count, plus the viewer URL and the image preview URL."
    },
    async () => {
      try {
        const preview = deps.sessionManager.getPreviewData();
        const counts = {};
        for (const [state, positions] of Object.entries(preview.instances)) {
          counts[state] = positions.length;
        }
        return textResult({
          size: preview.size,
          blocks: counts,
          previewUrl: `${deps.config.baseUrl}/`,
          previewImageUrl: `${deps.config.baseUrl}/api/session/preview.png`
        });
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/tools/renderImageTool.ts
function registerRenderImageTool(server, deps) {
  server.registerTool(
    "render_image",
    {
      title: "Render image",
      description: "Render the current build as an isometric PNG and return it as an image, so you can actually see the result and judge what to improve."
    },
    async () => {
      try {
        const png = await deps.sessionManager.renderImage();
        const { stats } = deps.sessionManager.current();
        return imageResult(
          png,
          `Isometric preview \u2014 ${stats.blockCount} blocks, ${stats.size.x}x${stats.size.y}x${stats.size.z}.`
        );
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/tools/exportSchematicTool.ts
import { z as z3 } from "zod";
function registerExportSchematicTool(server, deps) {
  server.registerTool(
    "export_schematic",
    {
      title: "Export schematic",
      description: "Export the current build to a WorldEdit Sponge .schem file. Returns the filename, size and a download URL the user can click in the browser. Defaults to Sponge v2 (most compatible); pass version 3 for the newer format.",
      inputSchema: { version: z3.union([z3.literal(2), z3.literal(3)]).optional() }
    },
    async (args) => {
      try {
        const version = args.version ?? 2;
        const { buffer, filename } = await deps.sessionManager.exportSchematic(version);
        return textResult({
          filename,
          version,
          size: buffer.length,
          downloadUrl: `${deps.config.baseUrl}/api/session/export.schem?version=${version}`
        });
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/tools/gitProjectTool.ts
import { z as z4 } from "zod";
function registerGitProjectTools(server, deps) {
  server.registerTool(
    "init_git_project",
    {
      title: "Initialize git project",
      description: "Turn a local folder (inside the home directory) into a git-versioned schematic project. Requires git to be installed. Writes the build spec + .schem and makes the first commit.",
      inputSchema: {
        projectPath: z4.string(),
        userName: z4.string().optional(),
        userEmail: z4.string().optional()
      }
    },
    async (args) => {
      try {
        return textResult(
          await deps.sessionManager.initGitProject(args.projectPath, args.userName, args.userEmail)
        );
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
  server.registerTool(
    "save_version",
    {
      title: "Save version",
      description: "Write the current build to the git project folder and commit it with the given message.",
      inputSchema: { message: z4.string() }
    },
    async (args) => {
      try {
        return textResult(await deps.sessionManager.saveVersion(args.message));
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
  server.registerTool(
    "git_branch",
    {
      title: "Git branch",
      description: "Switch to a branch in the git project, optionally creating it first.",
      inputSchema: { name: z4.string(), create: z4.boolean().optional() }
    },
    async (args) => {
      try {
        return textResult(await deps.sessionManager.branch(args.name, args.create ?? false));
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
  server.registerTool(
    "git_push",
    {
      title: "Git push",
      description: "Push the git project to a remote. Optionally set the remote URL first (https or ssh). The user must have push access configured.",
      inputSchema: { remote: z4.string().optional(), remoteUrl: z4.string().optional() }
    },
    async (args) => {
      try {
        return textResult(await deps.sessionManager.push(args.remote ?? "origin", args.remoteUrl));
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/tools/sessionTools.ts
import { z as z5 } from "zod";
function registerSessionTools(server, deps) {
  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description: "List the in-memory build sessions (each is an independent schematic) and which one is current."
    },
    async () => {
      try {
        return textResult(deps.sessionManager.list());
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
  server.registerTool(
    "select_session",
    {
      title: "Select session",
      description: "Make the given session the current one (subsequent tools act on it).",
      inputSchema: { sessionId: z5.string() }
    },
    async (args) => {
      try {
        deps.sessionManager.select(args.sessionId);
        return textResult(deps.sessionManager.current());
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }
  );
}

// apps/server/src/mcp/createMcpServer.ts
function buildMcpServer(deps) {
  const server = new McpServer({ name: "minecraft-schematic-lab", version: APP_VERSION });
  registerCreateBuildTool(server, deps);
  registerGetCurrentBuildTool(server, deps);
  registerValidateBuildTool(server, deps);
  registerApplyPatchTool(server, deps);
  registerRenderPreviewTool(server, deps);
  registerRenderImageTool(server, deps);
  registerExportSchematicTool(server, deps);
  registerGitProjectTools(server, deps);
  registerSessionTools(server, deps);
  return server;
}
async function startMcpServer(deps) {
  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());
  return server;
}

// apps/server/src/session/SessionManager.ts
import { writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import jsonpatch from "fast-json-patch";

// packages/block-compiler/src/BlockVolume.ts
var AIR = "minecraft:air";
function sortPair(a, b) {
  return a <= b ? [a, b] : [b, a];
}
var BlockVolume = class {
  x;
  y;
  z;
  cells;
  palette = [AIR];
  paletteIndex = /* @__PURE__ */ new Map([[AIR, 0]]);
  _outOfBoundsWrites = 0;
  constructor(x, y, z6) {
    this.x = x;
    this.y = y;
    this.z = z6;
    this.cells = new Uint16Array(x * y * z6);
  }
  /** YZX layout: x varies fastest, then z, then y. */
  index(x, y, z6) {
    return x + this.x * (z6 + this.z * y);
  }
  inBounds(x, y, z6) {
    return x >= 0 && y >= 0 && z6 >= 0 && x < this.x && y < this.y && z6 < this.z;
  }
  idFor(state) {
    const existing = this.paletteIndex.get(state);
    if (existing !== void 0) return existing;
    const id = this.palette.length;
    this.palette.push(state);
    this.paletteIndex.set(state, id);
    return id;
  }
  /** Place a block. Out-of-bounds writes are ignored (counted). Returns whether it was placed. */
  setBlock(x, y, z6, state) {
    if (!this.inBounds(x, y, z6)) {
      this._outOfBoundsWrites++;
      return false;
    }
    this.cells[this.index(x, y, z6)] = this.idFor(state);
    return true;
  }
  getBlock(x, y, z6) {
    if (!this.inBounds(x, y, z6)) return AIR;
    const id = this.cells[this.index(x, y, z6)] ?? 0;
    return this.palette[id] ?? AIR;
  }
  countBlocks() {
    let count = 0;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== 0) count++;
    }
    return count;
  }
  /** Distinct non-air states actually present, sorted. */
  getPalette() {
    const present = /* @__PURE__ */ new Set();
    for (let i = 0; i < this.cells.length; i++) {
      const id = this.cells[i] ?? 0;
      if (id !== 0) present.add(this.palette[id] ?? AIR);
    }
    return [...present].sort();
  }
  /** state -> list of [x,y,z] positions, iterating in YZX order. */
  toInstanceGroups() {
    const groups = {};
    this.forEachYZX((x, y, z6, state) => {
      if (state === AIR) return;
      (groups[state] ??= []).push([x, y, z6]);
    });
    return groups;
  }
  forEachYZX(cb) {
    for (let y = 0; y < this.y; y++) {
      for (let z6 = 0; z6 < this.z; z6++) {
        for (let x = 0; x < this.x; x++) {
          const id = this.cells[this.index(x, y, z6)] ?? 0;
          cb(x, y, z6, this.palette[id] ?? AIR);
        }
      }
    }
  }
  getNonAirBounds() {
    let found = false;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let y = 0; y < this.y; y++) {
      for (let z6 = 0; z6 < this.z; z6++) {
        for (let x = 0; x < this.x; x++) {
          if ((this.cells[this.index(x, y, z6)] ?? 0) === 0) continue;
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z6 < minZ) minZ = z6;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z6 > maxZ) maxZ = z6;
        }
      }
    }
    if (!found) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }
  get outOfBoundsWrites() {
    return this._outOfBoundsWrites;
  }
};

// packages/block-compiler/src/operations/box.ts
function box(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  for (let y = y0; y <= y1; y++) {
    for (let z6 = z0; z6 <= z1; z6++) {
      for (let x = x0; x <= x1; x++) {
        volume.setBlock(x, y, z6, state);
      }
    }
  }
}

// packages/block-compiler/src/operations/hollowBox.ts
function hollowBox(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const t = op.thickness ?? 1;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  for (let y = y0; y <= y1; y++) {
    for (let z6 = z0; z6 <= z1; z6++) {
      for (let x = x0; x <= x1; x++) {
        const onShell = x < x0 + t || x > x1 - t || y < y0 + t || y > y1 - t || z6 < z0 + t || z6 > z1 - t;
        if (onShell) volume.setBlock(x, y, z6, state);
      }
    }
  }
}

// packages/block-compiler/src/operations/wallRect.ts
function wallRect(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const hollow = op.hollow ?? true;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  for (let y = y0; y <= y1; y++) {
    for (let z6 = z0; z6 <= z1; z6++) {
      for (let x = x0; x <= x1; x++) {
        if (!hollow || x === x0 || x === x1 || z6 === z0 || z6 === z1) {
          volume.setBlock(x, y, z6, state);
        }
      }
    }
  }
}

// packages/block-compiler/src/operations/gableRoof.ts
function gableRoof(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const oh = op.overhang ?? 0;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  if (op.axis === "x") {
    const xa = x0 - oh;
    const xb = x1 + oh;
    for (let layer = 0; ; layer++) {
      const y = y0 + layer;
      const zl = z0 + layer;
      const zr = z1 - layer;
      if (y > y1 || zl > zr) break;
      for (let x = xa; x <= xb; x++) {
        volume.setBlock(x, y, zl, state);
        volume.setBlock(x, y, zr, state);
      }
    }
  } else {
    const za = z0 - oh;
    const zb = z1 + oh;
    for (let layer = 0; ; layer++) {
      const y = y0 + layer;
      const xl = x0 + layer;
      const xr = x1 - layer;
      if (y > y1 || xl > xr) break;
      for (let z6 = za; z6 <= zb; z6++) {
        volume.setBlock(xl, y, z6, state);
        volume.setBlock(xr, y, z6, state);
      }
    }
  }
}

// packages/block-compiler/src/operations/cylinder.ts
function cylinder(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const [cx, cy, cz] = op.center;
  const r = op.radius;
  const hollow = op.hollow ?? false;
  const reach = Math.ceil(r);
  for (let h = 0; h < op.height; h++) {
    const y = cy + h;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist > r + 0.5) continue;
        if (hollow && dist <= r - 0.5) continue;
        volume.setBlock(cx + dx, y, cz + dz, state);
      }
    }
  }
}

// packages/block-compiler/src/operations/windowPattern.ts
function findWallPlane(volume, axis, along, y, outermost) {
  const limit = axis === "x" ? volume.z : volume.x;
  let found = null;
  for (let p = 0; p < limit; p++) {
    const state = axis === "x" ? volume.getBlock(along, y, p) : volume.getBlock(p, y, along);
    if (state === AIR) continue;
    if (outermost) {
      found = p;
    } else if (found === null) {
      found = p;
      break;
    }
  }
  return found;
}
function windowPattern(volume, op, ctx) {
  const glass = ctx.resolveBlock(op.glassBlock);
  const frame = op.frameBlock ? ctx.resolveBlock(op.frameBlock) : null;
  const axis = op.side === "north" || op.side === "south" ? "x" : "z";
  const outermost = op.side === "south" || op.side === "east";
  const setOnWall = (along, y, plane, state) => {
    if (axis === "x") volume.setBlock(along, y, plane, state);
    else volume.setBlock(plane, y, along, state);
  };
  for (const start of op.positions) {
    const plane = findWallPlane(volume, axis, start, op.y, outermost);
    if (plane === null) {
      ctx.warn(
        `window_pattern (${op.side}) found no wall at position ${start}, y=${op.y}; skipped.`
      );
      continue;
    }
    if (frame) {
      for (let dh = -1; dh <= op.height; dh++) {
        for (let dw = -1; dw <= op.width; dw++) {
          const onBorder = dh === -1 || dh === op.height || dw === -1 || dw === op.width;
          if (onBorder) setOnWall(start + dw, op.y + dh, plane, frame);
        }
      }
    }
    for (let dh = 0; dh < op.height; dh++) {
      for (let dw = 0; dw < op.width; dw++) {
        setOnWall(start + dw, op.y + dh, plane, glass);
      }
    }
  }
}

// packages/block-compiler/src/operations/sphere.ts
function sphere(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const [cx, cy, cz] = op.center;
  const r = op.radius;
  const hollow = op.hollow ?? false;
  const reach = Math.ceil(r);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > r + 0.5) continue;
        if (hollow && dist <= r - 0.5) continue;
        volume.setBlock(cx + dx, cy + dy, cz + dz, state);
      }
    }
  }
}

// packages/block-compiler/src/operations/pyramid.ts
function pyramid(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const hollow = op.hollow ?? false;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  for (let i = 0; ; i++) {
    const y = y0 + i;
    const ax0 = x0 + i;
    const ax1 = x1 - i;
    const az0 = z0 + i;
    const az1 = z1 - i;
    if (y > y1 || ax0 > ax1 || az0 > az1) break;
    for (let z6 = az0; z6 <= az1; z6++) {
      for (let x = ax0; x <= ax1; x++) {
        if (!hollow || x === ax0 || x === ax1 || z6 === az0 || z6 === az1) {
          volume.setBlock(x, y, z6, state);
        }
      }
    }
  }
}

// packages/block-compiler/src/operations/ramp.ts
function ramp(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  if (op.axis === "x") {
    const span = Math.max(1, x1 - x0);
    for (let x = x0; x <= x1; x++) {
      const topY = y0 + Math.round((x - x0) / span * (y1 - y0));
      for (let z6 = z0; z6 <= z1; z6++) {
        for (let y = y0; y <= topY; y++) {
          volume.setBlock(x, y, z6, state);
        }
      }
    }
  } else {
    const span = Math.max(1, z1 - z0);
    for (let z6 = z0; z6 <= z1; z6++) {
      const topY = y0 + Math.round((z6 - z0) / span * (y1 - y0));
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= topY; y++) {
          volume.setBlock(x, y, z6, state);
        }
      }
    }
  }
}

// packages/block-compiler/src/operations/replace.ts
function replace(volume, op, ctx) {
  const target = ctx.resolveBlock(op.target);
  const state = ctx.resolveBlock(op.block);
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  for (let y = y0; y <= y1; y++) {
    for (let z6 = z0; z6 <= z1; z6++) {
      for (let x = x0; x <= x1; x++) {
        if (volume.getBlock(x, y, z6) === target) {
          volume.setBlock(x, y, z6, state);
        }
      }
    }
  }
}

// packages/block-compiler/src/operations/blockEntity.ts
function blockEntity(volume, op, ctx) {
  const state = ctx.resolveBlock(op.block);
  const [x, y, z6] = op.pos;
  if (!volume.setBlock(x, y, z6, state)) {
    ctx.warn(`block_entity at [${x}, ${y}, ${z6}] is out of bounds; skipped.`);
    return;
  }
  ctx.addBlockEntity({
    pos: [x, y, z6],
    id: state.split("[")[0] ?? state,
    data: op.data ?? {}
  });
}

// packages/block-compiler/src/compileBuildSpec.ts
var BuildSpecError = class extends Error {
  errors;
  constructor(errors) {
    super(`Invalid build spec: ${errors.join("; ")}`);
    this.name = "BuildSpecError";
    this.errors = errors;
  }
};
var BLOCK_STATE_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_/.]+(\[[a-z0-9_=,.:]*\])?$/;
function compileBuildSpec(input) {
  const validation = validateBuildSpec(input);
  if (!validation.success) {
    throw new BuildSpecError(validation.errors);
  }
  const spec = validation.data;
  const volume = new BlockVolume(spec.size.x, spec.size.y, spec.size.z);
  const warnings = [];
  const blockEntities = [];
  const warnedStates = /* @__PURE__ */ new Set();
  const ctx = {
    resolveBlock(key) {
      const mapped = spec.palette[key];
      const state = mapped ?? key;
      if (mapped === void 0 && !BLOCK_STATE_PATTERN.test(key)) {
        warnings.push(
          `"${key}" is not a palette key or a valid block id; using it literally.`
        );
      }
      if (!warnedStates.has(state) && !BLOCK_STATE_PATTERN.test(state)) {
        warnedStates.add(state);
        warnings.push(`"${state}" does not look like a valid Minecraft block id.`);
      }
      return state;
    },
    warn(message) {
      warnings.push(message);
    },
    addBlockEntity(entity) {
      blockEntities.push(entity);
    }
  };
  for (const op of spec.operations) {
    dispatch(volume, op, ctx);
  }
  if (volume.outOfBoundsWrites > 0) {
    warnings.push(
      `${volume.outOfBoundsWrites} block(s) were placed outside the ${spec.size.x}x${spec.size.y}x${spec.size.z} bounds and were skipped.`
    );
  }
  return {
    spec,
    volume,
    warnings,
    blockCount: volume.countBlocks(),
    palette: volume.getPalette(),
    blockEntities
  };
}
function dispatch(volume, op, ctx) {
  switch (op.type) {
    case "box":
      return box(volume, op, ctx);
    case "hollow_box":
      return hollowBox(volume, op, ctx);
    case "wall_rect":
      return wallRect(volume, op, ctx);
    case "gable_roof":
      return gableRoof(volume, op, ctx);
    case "cylinder":
      return cylinder(volume, op, ctx);
    case "window_pattern":
      return windowPattern(volume, op, ctx);
    case "sphere":
      return sphere(volume, op, ctx);
    case "pyramid":
      return pyramid(volume, op, ctx);
    case "ramp":
      return ramp(volume, op, ctx);
    case "replace":
      return replace(volume, op, ctx);
    case "block_entity":
      return blockEntity(volume, op, ctx);
  }
}

// apps/server/src/render/renderIsometric.ts
import { createCanvas } from "@napi-rs/canvas";
function fillPolygon(ctx, pts, fill) {
  ctx.beginPath();
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 1;
  ctx.stroke();
}
var keyOf = (x, y, z6) => `${x},${y},${z6}`;
function renderIsometric(volume, maxSize = 900) {
  const cubes = [];
  const fullSet = /* @__PURE__ */ new Set();
  const slabSet = /* @__PURE__ */ new Set();
  for (const [state, positions] of Object.entries(volume.toInstanceGroups())) {
    const color = colorFor(state);
    const shape = blockShape(state);
    for (const [x, y, z6] of positions) {
      cubes.push({ x, y, z: z6, color, state });
      if (shape === "full" || shape === "stairs") fullSet.add(keyOf(x, y, z6));
      else if (shape === "slab") slabSet.add(keyOf(x, y, z6));
    }
  }
  const span = volume.x + volume.z;
  let tile = Math.min(
    Math.floor(2 * maxSize / Math.max(1, volume.x + volume.z)),
    Math.floor(maxSize / Math.max(1, span / 4 + volume.y / 2)),
    28
  );
  tile = Math.max(2, tile);
  const hw = tile / 2;
  const hh = tile / 4;
  const vh = tile / 2;
  const margin = tile;
  const anchor = (c) => ({
    cx: (c.x - c.z) * hw,
    cy: (c.x + c.z) * hh - c.y * vh
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cubes) {
    const { cx, cy } = anchor(c);
    minX = Math.min(minX, cx - hw);
    maxX = Math.max(maxX, cx + hw);
    minY = Math.min(minY, cy - hh);
    maxY = Math.max(maxY, cy + hh + vh);
  }
  if (cubes.length === 0) {
    minX = 0;
    minY = 0;
    maxX = tile;
    maxY = tile;
  }
  const width = Math.ceil(maxX - minX) + margin * 2;
  const height = Math.ceil(maxY - minY) + margin * 2;
  const offsetX = -minX + margin;
  const offsetY = -minY + margin;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0e1116";
  ctx.fillRect(0, 0, width, height);
  cubes.sort(
    (a, b) => a.x + a.z - a.y - (b.x + b.z - b.y) || a.x + a.z - (b.x + b.z) || a.y - b.y
  );
  for (const c of cubes) {
    const { cx, cy } = anchor(c);
    const sx = cx + offsetX;
    const sy = cy + offsetY;
    const shape = blockShape(c.state);
    let s = 1;
    let topOff = 0;
    let h = vh;
    if (shape === "slab") {
      topOff = vh * 0.5;
      h = vh * 0.5;
    } else if (shape === "thin") {
      s = 0.42;
      topOff = hh * (1 - s);
    }
    const hwS = hw * s;
    const hhS = hh * s;
    const top = sy + topOff;
    const aboveKey = keyOf(c.x, c.y + 1, c.z);
    const zKey = keyOf(c.x, c.y, c.z + 1);
    const xKey = keyOf(c.x + 1, c.y, c.z);
    let drawTop = true;
    let drawLeft = true;
    let drawRight = true;
    if (shape === "slab") {
      drawLeft = !(fullSet.has(zKey) || slabSet.has(zKey));
      drawRight = !(fullSet.has(xKey) || slabSet.has(xKey));
    } else if (shape !== "thin") {
      drawTop = !(fullSet.has(aboveKey) || slabSet.has(aboveKey));
      drawLeft = !fullSet.has(zKey);
      drawRight = !fullSet.has(xKey);
    }
    const alpha = isTransparent(c.state) ? 0.55 : 1;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    const topFace = [
      [sx, top - hhS],
      [sx + hwS, top],
      [sx, top + hhS],
      [sx - hwS, top]
    ];
    const leftFace = [
      [sx - hwS, top],
      [sx, top + hhS],
      [sx, top + hhS + h],
      [sx - hwS, top + h]
    ];
    const rightFace = [
      [sx + hwS, top],
      [sx, top + hhS],
      [sx, top + hhS + h],
      [sx + hwS, top + h]
    ];
    if (drawTop) fillPolygon(ctx, topFace, c.color);
    if (drawLeft) {
      fillPolygon(ctx, leftFace, c.color);
      fillPolygon(ctx, leftFace, "rgba(0,0,0,0.32)");
    }
    if (drawRight) {
      fillPolygon(ctx, rightFace, c.color);
      fillPolygon(ctx, rightFace, "rgba(0,0,0,0.18)");
    }
    if (alpha !== 1) ctx.globalAlpha = 1;
  }
  return canvas.toBuffer("image/png");
}

// apps/server/src/schematic/writeSpongeSchematic.ts
import { gzipSync } from "node:zlib";
import nbt from "prismarine-nbt";

// apps/server/src/schematic/schematicTypes.ts
var DATA_VERSIONS = {
  "1.21": 3953,
  "1.20": 3463,
  "1.19": 3105,
  "1.18": 2860,
  "1.17": 2724,
  "1.16": 2566,
  "1.15": 2230,
  "1.14": 1952
};
var DEFAULT_DATA_VERSION = 3953;
function dataVersionFor(version) {
  const exact = DATA_VERSIONS[version];
  if (exact !== void 0) return exact;
  for (const [key, value] of Object.entries(DATA_VERSIONS)) {
    if (version === key || version.startsWith(`${key}.`)) return value;
  }
  return DEFAULT_DATA_VERSION;
}

// apps/server/src/schematic/writeSpongeSchematic.ts
var intNode = (value) => ({ type: "int", value });
var shortNode = (value) => ({ type: "short", value });
var stringNode = (value) => ({ type: "string", value });
var byteNode = (value) => ({ type: "byte", value });
var intArrayNode = (value) => ({ type: "intArray", value });
var byteArrayNode = (value) => ({ type: "byteArray", value });
var compoundNode = (value) => ({ type: "compound", value });
function pushVarint(out, value) {
  let v = value >>> 0;
  for (; ; ) {
    let b = v & 127;
    v >>>= 7;
    if (v !== 0) b |= 128;
    out.push(b > 127 ? b - 256 : b);
    if (v === 0) break;
  }
}
function jsonToNbt(value) {
  if (typeof value === "string") return stringNode(value);
  if (typeof value === "boolean") return byteNode(value ? 1 : 0);
  if (typeof value === "number") {
    return Number.isInteger(value) ? intNode(value) : { type: "double", value };
  }
  if (Array.isArray(value)) {
    const items = value.map(jsonToNbt);
    const elemType = items[0]?.type ?? "string";
    return { type: "list", value: { type: elemType, value: items.map((n) => n.value) } };
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = jsonToNbt(v);
    }
    return compoundNode(out);
  }
  return stringNode("");
}
function blockEntityCompound(be, version) {
  const base = {
    Id: stringNode(be.id),
    Pos: intArrayNode([be.pos[0], be.pos[1], be.pos[2]])
  };
  const data = jsonToNbt(be.data);
  if (version === 3) {
    base.Data = data;
  } else if (data.type === "compound") {
    Object.assign(base, data.value);
  }
  return compoundNode(base);
}
async function writeSpongeSchematic(spec, volume, options = {}) {
  const version = options.version ?? 2;
  const blockEntities = options.blockEntities ?? [];
  const dataVersion = dataVersionFor(spec.minecraftVersion);
  const paletteIndex = /* @__PURE__ */ new Map();
  const paletteValue = {};
  const blockData = [];
  volume.forEachYZX((_x, _y, _z, state) => {
    let id = paletteIndex.get(state);
    if (id === void 0) {
      id = paletteIndex.size;
      paletteIndex.set(state, id);
      paletteValue[state] = intNode(id);
    }
    pushVarint(blockData, id);
  });
  const offset = spec.origin ? [spec.origin.x, spec.origin.y, spec.origin.z] : [0, 0, 0];
  const metadata = compoundNode({
    Name: stringNode(spec.name),
    Author: stringNode("minecraft-schematic-lab"),
    WEOffsetX: intNode(0),
    WEOffsetY: intNode(0),
    WEOffsetZ: intNode(0)
  });
  const beList = {
    type: "list",
    value: { type: "compound", value: blockEntities.map((be) => blockEntityCompound(be, version).value) }
  };
  let root;
  if (version === 3) {
    const blocks = {
      Palette: compoundNode(paletteValue),
      Data: byteArrayNode(blockData)
    };
    if (blockEntities.length > 0) blocks.BlockEntities = beList;
    root = {
      type: "compound",
      name: "",
      value: {
        Schematic: compoundNode({
          Version: intNode(3),
          DataVersion: intNode(dataVersion),
          Metadata: metadata,
          Width: shortNode(volume.x),
          Height: shortNode(volume.y),
          Length: shortNode(volume.z),
          Offset: intArrayNode(offset),
          Blocks: compoundNode(blocks)
        })
      }
    };
  } else {
    const value = {
      Version: intNode(2),
      DataVersion: intNode(dataVersion),
      Metadata: metadata,
      Width: shortNode(volume.x),
      Height: shortNode(volume.y),
      Length: shortNode(volume.z),
      Offset: intArrayNode(offset),
      PaletteMax: intNode(paletteIndex.size),
      Palette: compoundNode(paletteValue),
      BlockData: byteArrayNode(blockData)
    };
    if (blockEntities.length > 0) value.BlockEntities = beList;
    root = { type: "compound", name: "Schematic", value };
  }
  const uncompressed = nbt.writeUncompressed(
    root,
    "big"
  );
  return gzipSync(uncompressed);
}

// apps/server/src/session/SessionManager.ts
var { applyPatch, deepClone } = jsonpatch;
var EMPTY_SIZE = { x: 0, y: 0, z: 0 };
function safeFilename(name) {
  const cleaned = name.trim().replace(/[^A-Za-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "schematic";
}
function projectReadme(session) {
  const name = session.spec?.name ?? "Schematic";
  return [
    `# ${name}`,
    "",
    "Generated by [minecraft-schematic-lab](https://github.com/SimoneRecchia/minecraft-schematic-lab).",
    "",
    `- Blocks: ${session.blockCount}`,
    `- Palette: ${session.palette.join(", ") || "\u2014"}`,
    "",
    "Load the `.schem` with WorldEdit: `//schem load <name>` then `//paste`.",
    ""
  ].join("\n");
}
var SessionManager = class {
  constructor(config, git) {
    this.config = config;
    this.git = git;
    this.createSession();
  }
  sessions = /* @__PURE__ */ new Map();
  currentId = "";
  now() {
    return Date.now();
  }
  createSession() {
    const id = newSessionId();
    const ts = this.now();
    const session = {
      id,
      buildId: null,
      spec: null,
      volume: null,
      warnings: [],
      blockCount: 0,
      palette: [],
      blockEntities: [],
      schematicCache: /* @__PURE__ */ new Map(),
      project: { mode: "memory", path: null, git: null },
      createdAt: ts,
      updatedAt: ts
    };
    this.sessions.set(id, session);
    this.currentId = id;
    return session;
  }
  getCurrent() {
    const session = this.sessions.get(this.currentId);
    if (!session) throw new HttpError(500, "No active session.");
    return session;
  }
  list() {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.id,
      name: s.spec?.name ?? "Untitled",
      buildId: s.buildId,
      blockCount: s.blockCount,
      isCurrent: s.id === this.currentId
    }));
  }
  select(id) {
    if (!this.sessions.has(id)) throw new HttpError(404, `Session not found: ${id}`);
    this.currentId = id;
  }
  deleteSession(id) {
    if (!this.sessions.has(id)) throw new HttpError(404, `Session not found: ${id}`);
    this.sessions.delete(id);
    if (this.currentId === id) {
      const next = this.sessions.keys().next();
      if (next.done) this.createSession();
      else this.currentId = next.value;
    }
  }
  build(input) {
    const session = this.getCurrent();
    try {
      const result = compileBuildSpec(input);
      session.spec = result.spec;
      session.volume = result.volume;
      session.warnings = result.warnings;
      session.blockCount = result.blockCount;
      session.palette = result.palette;
      session.blockEntities = result.blockEntities;
      session.buildId = newBuildId();
      session.schematicCache.clear();
      session.updatedAt = this.now();
      return {
        sessionId: session.id,
        buildId: session.buildId,
        valid: true,
        errors: [],
        warnings: result.warnings,
        blockCount: result.blockCount,
        palette: result.palette,
        previewData: this.previewFor(session)
      };
    } catch (error) {
      if (error instanceof BuildSpecError) {
        return {
          sessionId: session.id,
          buildId: session.buildId,
          valid: false,
          errors: error.errors,
          warnings: [],
          blockCount: 0,
          palette: [],
          previewData: this.previewFor(session)
        };
      }
      throw error;
    }
  }
  validate(input) {
    try {
      const result = compileBuildSpec(input);
      return { valid: true, errors: [], warnings: result.warnings };
    } catch (error) {
      if (error instanceof BuildSpecError) {
        return { valid: false, errors: error.errors, warnings: [] };
      }
      throw error;
    }
  }
  applyPatch(patch) {
    const session = this.getCurrent();
    if (!session.spec) {
      throw new HttpError(409, "No current build to patch. Create a build first.");
    }
    if (!Array.isArray(patch)) {
      throw new HttpError(400, "Patch must be a JSON Patch (RFC 6902) array.");
    }
    const next = applyPatch(deepClone(session.spec), patch, true, false).newDocument;
    const result = this.build(next);
    if (!result.valid) {
      throw new HttpError(422, `Patched spec is invalid: ${result.errors.join("; ")}`);
    }
    return {
      spec: session.spec,
      valid: true,
      errors: [],
      warnings: result.warnings,
      stats: this.statsFor(session),
      previewUrl: this.previewUrl()
    };
  }
  current() {
    const session = this.getCurrent();
    return {
      sessionId: session.id,
      buildId: session.buildId,
      spec: session.spec,
      stats: this.statsFor(session),
      warnings: session.warnings,
      previewUrl: this.previewUrl(),
      project: this.projectStatus()
    };
  }
  getPreviewData() {
    return this.previewFor(this.getCurrent());
  }
  async renderImage() {
    const session = this.getCurrent();
    if (!session.volume) {
      throw new HttpError(409, "Nothing to render yet. Create a build first.");
    }
    return renderIsometric(session.volume);
  }
  async exportSchematic(version = 2) {
    const session = this.getCurrent();
    if (!session.spec || !session.volume) {
      throw new HttpError(409, "Nothing to export yet. Create a build first.");
    }
    const buffer = await this.schematicFor(session, version);
    const filename = `${safeFilename(session.spec.name || session.spec.id)}.schem`;
    return { buffer, filename };
  }
  projectStatus() {
    const session = this.getCurrent();
    return {
      mode: session.project.mode,
      path: session.project.path,
      git: session.project.git ? {
        branch: session.project.git.branch,
        branches: session.project.git.branches,
        remote: session.project.git.remote
      } : null
    };
  }
  async initLocalProject(path) {
    const dir = this.git.resolveSafePath(path);
    this.git.ensureDir(dir);
    const session = this.getCurrent();
    session.project = { mode: "local", path: dir, git: null };
    await this.writeProjectFiles(session, dir);
    return { mode: "local", path: dir };
  }
  async initGitProject(path, userName, userEmail) {
    await this.git.checkGitAvailable();
    const dir = this.git.resolveSafePath(path);
    this.git.ensureDir(dir);
    if (!await this.git.isRepo(dir)) {
      await this.git.initRepo(dir);
    }
    const identity = await this.git.readLocalIdentity(dir);
    await this.git.setLocalIdentity(
      dir,
      userName ?? identity.name ?? "minecraft-schematic-lab",
      userEmail ?? identity.email ?? "schematic-lab@localhost"
    );
    const session = this.getCurrent();
    await this.writeProjectFiles(session, dir);
    await this.git.commitAll(dir, "Initialize schematic project");
    const branch = await this.git.currentBranch(dir);
    const branches = await this.git.listBranches(dir);
    session.project = { mode: "git", path: dir, git: { branch, branches, remote: null } };
    return { mode: "git", path: dir, branch };
  }
  async saveVersion(message) {
    const session = this.requireGitPath();
    const dir = session.project.path;
    await this.writeProjectFiles(session, dir);
    const result = await this.git.commitAll(dir, message || "Update schematic");
    await this.refreshGitInfo(session);
    return { committed: result.committed, commit: result.commit, message };
  }
  async branches() {
    const session = this.requireGitPath();
    const dir = session.project.path;
    return {
      current: await this.git.currentBranch(dir),
      branches: await this.git.listBranches(dir)
    };
  }
  async branch(name, create = false) {
    const session = this.requireGitPath();
    const dir = session.project.path;
    if (create) await this.git.createBranch(dir, name);
    await this.git.checkoutBranch(dir, name);
    await this.refreshGitInfo(session);
    return {
      current: await this.git.currentBranch(dir),
      branches: await this.git.listBranches(dir)
    };
  }
  async push(remote = "origin", remoteUrl) {
    const session = this.requireGitPath();
    const dir = session.project.path;
    if (remoteUrl) await this.git.setRemote(dir, remote, remoteUrl);
    const branch = await this.git.currentBranch(dir) ?? "main";
    const output = await this.git.push(dir, remote, branch);
    if (session.project.git) session.project.git.remote = remote;
    return { ok: true, output };
  }
  requireGitPath() {
    const session = this.getCurrent();
    if (session.project.mode !== "git" || !session.project.path) {
      throw new HttpError(409, "No git project. Initialize one first with init_git_project.");
    }
    return session;
  }
  async refreshGitInfo(session) {
    const dir = session.project.path;
    if (!dir) return;
    session.project.git = {
      branch: await this.git.currentBranch(dir),
      branches: await this.git.listBranches(dir),
      remote: session.project.git?.remote ?? null
    };
  }
  async writeProjectFiles(session, dir) {
    if (!session.spec || !session.volume) return;
    this.git.writeFiles(dir, {
      "build-spec.json": `${JSON.stringify(session.spec, null, 2)}
`,
      "README.md": projectReadme(session),
      ".gitignore": "node_modules/\n"
    });
    const buffer = await this.schematicFor(session, 2);
    writeFileSync2(join2(dir, `${safeFilename(session.spec.name || session.spec.id)}.schem`), buffer);
  }
  async schematicFor(session, version = 2) {
    const cached = session.schematicCache.get(version);
    if (cached) return cached;
    if (!session.spec || !session.volume) {
      throw new HttpError(409, "Nothing to export yet. Create a build first.");
    }
    const buffer = await writeSpongeSchematic(session.spec, session.volume, {
      version,
      blockEntities: session.blockEntities
    });
    session.schematicCache.set(version, buffer);
    return buffer;
  }
  previewFor(session) {
    if (!session.volume) return { size: EMPTY_SIZE, instances: {} };
    return {
      size: { x: session.volume.x, y: session.volume.y, z: session.volume.z },
      instances: session.volume.toInstanceGroups()
    };
  }
  statsFor(session) {
    return {
      blockCount: session.blockCount,
      palette: session.palette,
      size: session.volume ? { x: session.volume.x, y: session.volume.y, z: session.volume.z } : EMPTY_SIZE
    };
  }
  previewUrl() {
    return `${this.config.baseUrl}/`;
  }
};

// apps/server/src/index.ts
function isPortFree(host, port) {
  return new Promise((resolve2) => {
    const probe = createServer();
    probe.once("error", () => resolve2(false));
    probe.once("listening", () => probe.close(() => resolve2(true)));
    probe.listen(port, host);
  });
}
async function findOpenPort(host, start, attempts = 20) {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(host, port)) return port;
  }
  return start;
}
async function main() {
  const config = loadConfig();
  const port = await findOpenPort(config.host, config.port);
  config.port = port;
  config.baseUrl = `http://${config.host}:${port}`;
  const git = new GitProjectService();
  const sessionManager = new SessionManager(config, git);
  const app = await createHttpServer(sessionManager, config);
  await app.listen({ host: config.host, port: config.port });
  if (config.mcpMode) {
    await startMcpServer({ sessionManager, config });
    const note = existsSync4(config.webDist) ? "" : ' (run "pnpm build" once to enable the browser viewer)';
    process.stderr.write(
      `minecraft-schematic-lab: MCP stdio ready; viewer + API on ${config.baseUrl}${note}
`
    );
  } else {
    app.log.info(`minecraft-schematic-lab listening on ${config.baseUrl}`);
  }
}
main().catch((error) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`Fatal: ${detail}
`);
  process.exit(1);
});
