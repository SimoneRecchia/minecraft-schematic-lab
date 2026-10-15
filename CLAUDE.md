# minecraft-schematic-lab — operating protocol for Claude Code

You are operating inside **minecraft-schematic-lab**. The end user is a **Minecraft player, not a
programmer**: they say things like "costruiscimi un castello fantasy" or "fai il tetto più scuro".
Your job is to make that work — including the one-time technical setup, explained in plain language
(match their language; they often write Italian).

## What this project is

A local pnpm/TypeScript monorepo (Node 22+, ESM). One Node process serves:

- the **MCP server** (stdio) with the building tools Claude uses;
- an **HTTP API + live 3D viewer** on **port 8765** (or the next free port): real Minecraft textures and
  block models, orbit/pan/zoom, layer cut, notes pinned on blocks, version picker, export sheet.

You write a **BuildSpec** (JSON); it is compiled to blocks, validated strictly against the chosen
Minecraft version (1.8 → newest), and exported as WorldEdit `.schem` (v2/v3), MCEdit `.schematic`
(1.8–1.12), Litematica `.litematic`, vanilla structure `.nbt`, or a material list. Everything is
local; the only network access is downloading the official Minecraft client jar from Mojang once per
version for textures (skipped when the player's launcher already has that version).

**How to build well**: the skill `.claude/skills/minecraft-builder/SKILL.md` and the guides served by
the `read_guide` tool (`apps/server/guides/*.md`). Always follow them for build requests.

Players normally don't clone this repo: they install the **Claude Code plugin** in `plugin/` (marketplace
`.claude-plugin/marketplace.json` at the repo root), which brings the server, the guides and the skill.

`<REPO>` = the directory containing this file.

## The golden rule: check setup state FIRST on any build/modify request

If the plugin's tools are loaded (names start with `mcp__plugin_minecraft-schematic-lab_`), nothing
needs setting up: build with them. Otherwise "set up" means all of:

1. `node` ≥ 22 (`node -p 'process.versions.node.split(".")[0]'`).
2. `pnpm` resolves.
3. `<REPO>/node_modules` exists.
4. `<REPO>/apps/web/dist/index.html` exists and is newer than the viewer sources (dist is git-ignored).
5. The MCP connector `minecraft-schematic-lab` points at `<REPO>/scripts/mcp-launch.sh`.

If anything is missing:

1. Tell the user, plainly: "È la prima volta: preparo lo strumento una volta sola (un minuto, niente
   password di amministratore), poi costruisco la tua build."
2. Run `bash <REPO>/scripts/setup.sh`. It is idempotent: installs Node via nvm if needed (no sudo),
   enables pnpm via corepack, `pnpm install` + `pnpm build`, writes a PATH-safe wrapper
   (`scripts/mcp-launch.sh`) and registers the connector (replacing older registrations with the same
   name, e.g. `npx github:…`). Read its output; it prints any manual step left.
3. Never `sudo`. Never delete `node_modules`/`dist`. If offline, say the first setup needs internet.

## If the MCP tools are not loaded in this session

Claude Code loads MCP servers at session start, so right after setup the tools aren't available yet.
Build over HTTP for now:

1. Start the server from the server package, detached, and remember its PID:
   ```
   PORT=8765 pnpm --dir <REPO>/apps/server start >/tmp/msl-server.log 2>&1 &
   echo $! > /tmp/msl-server.pid
   ```
   Poll `curl -s http://127.0.0.1:8765/api/health` until `{"ok":true,...}`. If 8765 is taken by our
   own server (health answers), reuse it. There is no `start` script at the repo root.
2. Open the viewer: `open http://127.0.0.1:8765/` (macOS; `xdg-open` / `start` elsewhere).
3. Read the guides directly from `apps/server/guides/` (workflow, spec, roofs, …).
4. `curl -s -X POST http://127.0.0.1:8765/api/build -H 'content-type: application/json' -d '{"spec": <BuildSpec>}'`
   → `{ok, summary}` or HTTP 422 `{errors:[…]}`. Edits: `POST /api/build/edit` with
   `{"edits":[…]}`. Look at it: `curl -o /tmp/view.png 'http://127.0.0.1:8765/api/render.png?views=iso,iso_nw'`
   (rendered by the open viewer with real textures) and read the PNG.
5. Tell the user to restart Claude Code once so the tools load next time, and **stop your server
   before that** (`kill "$(cat /tmp/msl-server.pid)"`): the connector starts its own server and two
   servers would fight over the port.

When the tools **are** loaded, use them and never start a second server.

## MCP tools

| Tool | Use |
|---|---|
| `read_guide` | Building guides + BuildSpec reference (`workflow`, `spec`, `roofs`, `styles`, `palettes`, `details`, `landscape`, `scripts`, `versions`, `examples`). |
| `create_build` | Compile a full spec; new project with history; returns summary + rendered preview. |
| `edit_build` | Edit by operation id (`add`/`replace`/`update`/`remove`/`palette`/`component`/`meta`) or JSON Patch. |
| `get_build` | Summary, and the full spec to continue work from another session. |
| `render_views` | Real-texture renders from the viewer: angles, close-ups (`focus`), sections (`cutY`). |
| `get_feedback` / `resolve_feedback` | Notes the user pinned on blocks in the viewer (with the operation that placed them). |
| `inspect` | Exact text slices of a region, with which operation placed what. |
| `list_blocks` | Block availability/properties per version; supported versions. |
| `export_build` | `.schem`, `.schematic`, `.litematic`, `.nbt`, materials CSV; can save into the WorldEdit/Litematica folders. |
| `history` / `projects` | Saved versions (restore) and projects (open/rename). |
| `focus_view` | Move the user's camera to a region with a message. |

## HTTP API (base `http://127.0.0.1:8765`)

`GET /api/health` · `POST /api/build` · `POST /api/build/edit` · `GET /api/build` (header) ·
`GET /api/build/volume` (gzip Uint16 YZX) · `GET /api/build/inspect?x&y&z` · `GET /api/build/spec` ·
`POST /api/build/version` · `GET /api/render.png?views=&size=&cutY=&from=x,y,z&to=x,y,z` ·
`GET /api/versions` · `GET|POST /api/history[/restore]` · `GET /api/projects`, `POST /api/projects/:id/open|rename`, `DELETE /api/projects/:id` ·
`GET|POST /api/feedback`, `POST /api/feedback/:id/resolve`, `DELETE /api/feedback/:id` ·
`GET /api/export`, `GET /api/export/:format`, `POST /api/export/:format/save` ·
`GET /api/assets/:version/{status,manifest,atlas.png}`, `POST /api/assets/:version/models` ·
`GET /api/events` (SSE to the viewer) · `POST /api/capture/:id` (viewer → server renders).

## Developer notes

- Layout: `packages/catalog` (block catalog per version, generated by `pnpm catalog` from
  PrismarineJS/minecraft-data), `packages/build-spec` (Zod schema), `packages/block-compiler`
  (operations, transforms, palettes, auto block states, scripts), `packages/formats` (NBT writers),
  `packages/shared` (API + baked-model types), `apps/server` (Fastify + MCP + assets + projects),
  `apps/web` (React UI + three.js engine with a worker mesher).
- Data lives in `~/.minecraft-schematic-lab` (override `MSL_HOME`): `projects/`, `assets/<version>/`
  (extracted textures/models), `jars/`. `MSL_NO_BROWSER=1` stops the server from opening tabs.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`. The guides' JSON snippets are
  validated by `apps/server/src/guides.test.ts`.
- The plugin (`plugin/`) is generated by `pnpm bundle`: `plugin/server/server.mjs` (workspace inlined,
  npm deps external) + `server/web/dist` + `server/guides`, the skill copied from `.claude/skills/`,
  and `plugin/package.json` + `package-lock.json` with the runtime deps (Claude Code `npm ci`s them
  when it caches the plugin). `.mcp.json` runs `plugin/scripts/start-server.sh`, which finds Node 22+
  (or downloads it into `~/.minecraft-schematic-lab/runtime/node`, no admin) and installs the deps
  itself when Claude Code didn't. `plugin/` is committed: run `pnpm bundle` after changing the server,
  viewer, guides or skill (`apps/server/src/plugin.test.ts` fails on a stale copy). Installed plugins
  only update when `version` changes: bump it in the root `package.json` (and
  `packages/shared/src/version.ts`), then `pnpm bundle`. Check with `claude plugin validate .`.
- Never run `pnpm dev`/`dev:server`/`start` while the MCP server owns the port; use another `PORT`
  for development (`PORT=8790 pnpm --dir apps/server start`, viewer dev: `API_TARGET=… pnpm dev:web`).

## Hard rules

- No `sudo`, ever. Keep the user informed in plain language; relay validation errors in their words.
- Local-only: no extra network ports beyond loopback, no cloud services.
- Desktop-app PATH caveat: Claude Code Desktop doesn't inherit the shell PATH, so the connector must
  run `scripts/mcp-launch.sh` (absolute node/pnpm paths), never a bare `pnpm`; the plugin runs
  `/bin/sh plugin/scripts/start-server.sh`, which searches the usual Node install places itself.
