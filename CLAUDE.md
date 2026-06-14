# minecraft-schematic-lab — operating protocol for Claude Code

You are operating inside **minecraft-schematic-lab**. Read this file as your instructions for this
project. The end user is a **Minecraft player, not a programmer** — they will just say things like
"build me a fantasy castle" or "make the roof brick". Your job is to make that work, including doing
the one-time technical setup yourself, in plain language, the first time.

## What this project is

A fully-local pnpm/TypeScript monorepo (Node 22+, ESM). One Node process, on **port 8765**, serves
three things at once: the HTTP API, a minimal **browser viewer** (3D preview + Export button), and the
**MCP stdio server**. You compile a **BuildSpec** (JSON) into a WorldEdit **Sponge `.schem`** and show
it live in the browser. Nothing leaves the machine — no cloud, no account, no database. The server is
run through `tsx` at runtime (it is **not** compiled); the only build artifact that matters is the web
viewer at `apps/web/dist`.

The repo root is the directory that contains this file. Throughout, `<REPO>` = that absolute path.

## The golden rule: check setup state FIRST on any build/modify request

When the user asks you to **build, change, render, export, or version** a schematic, before anything
else determine whether the project is set up. "Set up" means **all** of these are true:

1. `node` resolves and its major version is **>= 22** (`node -p 'process.versions.node.split(".")[0]'`).
2. `pnpm` resolves.
3. `<REPO>/node_modules` exists.
4. `<REPO>/apps/web/dist/index.html` exists (the built viewer). NOTE: `dist/` is git-ignored, so a
   fresh checkout never has it — the build step below must run at least once.
5. The MCP connector `minecraft-schematic-lab` is registered (only relevant for *subsequent* builds —
   see "MCP not live yet" below; the **first** build does not need it).

If any of 1–4 is missing, the project is **not set up**. Do this, in order:

1. **Explain to the user, in plain language** (match their language — they often write Italian), e.g.:
   "This is the first time you're building something, so I need to set up the tool once. It will take a
   minute: I'll install what's needed locally (no admin password required) and then build your
   schematic. After this it just works." Do not dump technical jargon on them.
2. **Run the setup helper**: `bash <REPO>/scripts/setup.sh`. It is idempotent and safe to re-run; it
   installs Node via **nvm** if missing (no sudo), enables **pnpm** via corepack, runs
   `pnpm install` + `pnpm build`, and — if the `claude` CLI is available — registers the MCP connector
   using a PATH-safe wrapper. Read its output: it prints clear progress and, at the end, a summary plus
   any **manual command** you still need to run (e.g. connector registration if `claude` isn't on PATH).
3. If `scripts/setup.sh` is missing for some reason, perform the equivalent steps yourself:
   detect/install Node 22+ via nvm without sudo, `corepack enable pnpm && corepack prepare pnpm@11.6.0
   --activate`, `pnpm --dir <REPO> install`, `pnpm --dir <REPO> build`.
4. Never use `sudo`. Never `rm -rf node_modules` or `dist`. If a network step fails (offline), tell the
   user plainly that the first-time setup needs internet, then stop.

## Building the schematic (do it in the SAME turn as setup — the first build)

The browser auto-open only fires from the **MCP** tools, and a freshly-registered MCP connector is
**not visible in the current session** (Claude Code loads MCP servers at session start). So for the
**first** build, drive it over **HTTP** — it needs no MCP handshake and works immediately:

1. Make sure the server is running on 8765. Check `curl -s http://127.0.0.1:8765/api/health` (it
   answers `{"ok":true,...}`). If it's not up, start it **from the server package** in the background:

   ```
   PORT=8765 pnpm --dir <REPO>/apps/server start >/tmp/msl-server.log 2>&1 &
   echo $! > /tmp/msl-server.pid
   ```

   (`pnpm --filter @minecraft-schematic-lab/server start` is equivalent.) There is **no** `start`
   script at the repo root — `pnpm --dir <REPO> start` fails with `ERR_PNPM_NO_SCRIPT_OR_SERVER`, so
   always target `apps/server`. Run it detached so it keeps serving; never block your turn on it. Poll
   `/api/health` until it answers. Record the PID (above) — you will stop this server later (step 5).
2. Compose a **BuildSpec** (see "BuildSpec shape" below) and POST it:
   `curl -s -X POST http://127.0.0.1:8765/api/session/build -H 'content-type: application/json' -d '<BuildSpec JSON>'`.
   A default session already exists at startup, so you do **not** need to create one first. On success
   you get `{ "valid": true, "buildId": "...", "blockCount": N, "palette": [...], ... }`. The build
   endpoint always returns **HTTP 200**; on an invalid spec it returns HTTP 200 with
   `{ "valid": false, "errors": [...] }` (it does **not** return 422). When `valid` is false, relay the
   errors to the user in plain language and fix the spec.
3. **Open the preview yourself** (the HTTP build does not auto-open): macOS `open http://127.0.0.1:8765/`,
   Linux `xdg-open ...`, Windows `start ...`. Tell the user the 3D preview is now in their browser and
   updates by itself (it polls the server).
4. **Register the MCP connector for next time** if not already done (setup.sh does this when `claude`
   is on PATH). If you had to register it now, tell the user: "Next time, restart Claude Code once so
   the schematic tools load — after that I'll build straight into the preview."
5. **Stop the standalone HTTP server before the handover.** The MCP connector starts its OWN server on
   port 8765 when Claude Code restarts, and the server exits fatally if the port is already taken
   (`EADDRINUSE`). If your detached first-build server is still holding 8765 at restart, the connector
   crashes on launch and the tools silently never appear. So once the preview is open and the user is
   happy, stop the server you started: `kill "$(cat /tmp/msl-server.pid)" 2>/dev/null` (or
   `kill "$(lsof -ti:8765)"`). Do **not** leave a standalone server on 8765 running across a Claude
   Code restart. If, after a restart, the MCP tools fail to appear, check for and kill any stray
   process on 8765 (`lsof -ti:8765 | xargs kill`), then restart again.

Once the MCP connector is live (a session started **after** registration), prefer the **MCP tools** —
`create_build` and `apply_patch` open/refresh the browser automatically, so you don't POST or `open`
manually, and the MCP server owns port 8765 for you.

## MCP not live yet — decision rule

- **First build, this session, connector just registered or absent** → use the **HTTP path** above.
  Do not call MCP tools; they aren't loaded in this session and calls will fail or hang.
- **MCP tools are present in your tool list** → use them directly; ignore the HTTP path, and do not
  start a second server (the MCP server already holds 8765).
- If the user added the connector but tools aren't showing, tell them to **exit and restart Claude
  Code once** (servers load at session start; `/mcp` shows status but tools appear only after restart).

## MCP tools (available once the connector is live)

| Tool | What it does |
| --- | --- |
| `create_build` | Compile a BuildSpec, replace the current build, auto-open/refresh the browser. |
| `apply_patch` | Apply an RFC 6902 JSON Patch to the current spec and rebuild (incremental edits); auto-refreshes. |
| `validate_build` | Validate a spec without changing the current build. |
| `get_current_build` | Current spec, stats, warnings, preview URL, project status. |
| `render_preview` | Compact size + per-block-state counts + URLs. |
| `render_image` | Isometric **PNG** returned as an image so you can actually see the result. |
| `export_schematic` | Export `.schem` (v2 default, v3 optional); returns a download URL. |
| `init_git_project` / `save_version` / `git_branch` / `git_push` | Optional git versioning (needs git installed). |
| `list_sessions` / `select_session` | Manage independent in-memory builds. |

## HTTP endpoints you can use directly (no MCP needed)

Base URL `http://127.0.0.1:8765`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + version (use to detect the server is up). |
| POST | `/api/session/build` | Compile a BuildSpec (the **first-build** path). Always HTTP 200; check the `valid` field. |
| POST | `/api/session/validate` | Validate only. |
| POST | `/api/session/apply-patch` | RFC 6902 patch + rebuild. Returns **HTTP 422** if the patched spec is invalid. |
| GET | `/api/session/current` | Current spec + stats + project. |
| GET | `/api/session/preview-data` | Instanced positions per block state. |
| GET | `/api/session/preview.png` | Server-rendered isometric PNG. |
| GET | `/api/session/export.schem?version=2` | Download `.schem` (pass `version=3` for v3). |
| POST/GET | `/api/session/create` · `list` · `select` · `delete` | Session management. |
| GET/POST | `/api/project/status` · `init-local` · `init-git` · `save-version` · `branches` · `branch` · `push` | Project / git ops. |

## BuildSpec shape

A BuildSpec is JSON with: `id`, `name`, `minecraftVersion` (e.g. `"1.21"`), `size`, optional `origin`,
a `palette` (friendly key → block id like `minecraft:stone`), `operations`, and optional `metadata`.

**Coordinate convention (this trips you up if you get it wrong — the schema is strict):**

- `size` and `origin` are **objects**: `{ "x": 21, "y": 16, "z": 19 }`.
- **Every operation position** (`from`, `to`, `center`, `pos`) is an **array** `[x, y, z]` — NOT an
  object. Using `{x,y,z}` for an operation position is rejected with
  `"... Expected array, received object"`.

Operation types and their required fields:

- `box` — `from`, `to`, `block`
- `hollow_box` — `from`, `to`, `block`, optional `thickness`
- `wall_rect` — `from`, `to`, `block`, optional `hollow`
- `gable_roof` — `from`, `to`, `axis` (`"x"`|`"z"`), `block`, optional `overhang`
- `cylinder` — `center`, `radius`, `height`, `block`, optional `hollow`
- `sphere` — `center`, `radius`, `block`, optional `hollow`
- `pyramid` — `from`, `to`, `block`, optional `hollow`
- `ramp` — `from`, `to`, `axis` (`"x"`|`"z"`), `block`
- `replace` — `from`, `to`, `target` (block to replace), `block`
- `window_pattern` — `side` (`north`|`south`|`east`|`west`), `y`, `positions` (number[]), `width`,
  `height`, `glassBlock`, optional `frameBlock`. (Note: uses `glassBlock`/`frameBlock`, NOT `block`.)
- `block_entity` — `pos`, `block`, optional `data`

`block` (and `target`/`glassBlock`/`frameBlock`) may be a literal id (`minecraft:spruce_planks`) or a
palette key. Out-of-bounds writes are skipped and reported as warnings. The schema is strict (Zod):
invalid specs return `valid:false` (HTTP 200) with detailed errors — fix them, don't paper over them.

A minimal **verified-valid** spec:

```json
{
  "id": "demo",
  "name": "Demo",
  "minecraftVersion": "1.21",
  "size": { "x": 3, "y": 3, "z": 3 },
  "palette": { "s": "minecraft:stone" },
  "operations": [
    { "type": "box", "from": [0, 0, 0], "to": [2, 2, 2], "block": "s" }
  ]
}
```

Read `packages/build-spec/src/examples.ts` for complete worked specs (fantasy cottage, watchtower, log
cabin, feature showcase) before composing anything non-trivial — they show the array-coordinate form in
context.

## Hard rules

- **Never run `pnpm dev` (or `pnpm dev:server`, or the server's `start` script) while the MCP server is
  running** — they all bind 8765 and will clash; the server exits fatally on `EADDRINUSE`. If you need
  the server for the HTTP first-build path and the MCP server isn't already holding the port, start
  exactly one (`pnpm --dir <REPO>/apps/server start`), and stop it before a Claude Code restart hands
  the port to the MCP connector. To hack on the viewer use `pnpm dev:web` (port 5173) only when nothing
  else owns 8765.
- If port 8765 is already taken, check whether it's our own server (`/api/health` answers
  `{"ok":true}`) and reuse it; do not start a second one. Only override `PORT` if the user explicitly
  wants a different port.
- No `sudo`, ever. Prefer nvm + corepack so setup needs no admin rights.
- Keep the user informed in plain language at each step; surface validation errors and missing-tool
  messages in their own words.
- This is a local-only, Claude/MCP-only tool: no double-click launchers, no Electron, no opening
  network ports beyond loopback 8765.

## Desktop-app PATH caveat

Claude Code Desktop launches from the GUI and does **not** inherit the interactive shell PATH, so a
connector registered as a bare `pnpm --dir ... mcp` can silently fail to spawn when pnpm/node live in
nvm or Homebrew dirs. `scripts/setup.sh` handles this by registering a small generated wrapper
(`scripts/mcp-launch.sh`) that exports the absolute node and pnpm directories onto PATH and execs the
absolute pnpm. If you ever register the connector by hand, point it at that wrapper (an absolute path),
not at a bare `pnpm`.

