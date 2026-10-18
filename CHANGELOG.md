# Changelog

Installed plugins update when `version` changes (root `package.json`, synced into the plugin and the
desktop extension by `pnpm bundle`).

## 0.4.0

- **Redstone simulator.** A new engine (`packages/redstone`) runs Minecraft Java redstone the way
  the game's code does, with the mechanics of the build's version (1.8 → newest):
  - game ticks, neighbour updates (W, E, down, up, N, S) and shape updates;
  - scheduled-tick priorities and block events;
  - pistons and sticky pistons with slime, honey, the 12-block limit and dropped blocks on short
    pulses;
  - quasi-connectivity, observers, comparators (compare/subtract, containers, through a block) and
    torch burnout;
  - doors, rails, note blocks, copper bulbs and more.
  Dust update order depends on world position, like in the game.
- **Circuits with tests.** A BuildSpec can have a `circuit` with named inputs and outputs (single
  blocks or buses) and tests: truth tables with `forAll`, delays with `expect … within`, clock
  periods with `measure`, memory with `for`. The tests run on every build and show in the summary.
  The rest state is saved into the build, so exports paste working.
- **`simulate` tool**: run stored or ad-hoc tests, add probes, check that results don't depend on
  where the build sits (`locations`), and play a test live in the viewer (`show`).
- **Live simulation in the viewer**:
  - a hand tool (U) for levers, buttons and repeaters;
  - run, pause, one tick, speed from ¼× to max;
  - a Redstone panel with inputs, outputs, tests and events, and labels on the blocks;
  - redstone dust coloured by its power, like in the game.
- New guide `read_guide("redstone")`: tick timing, which way blocks face, power rules, the test
  language, verified building blocks (AND, latch, clock, pulse, piston door, a generated chaser) and
  how to scale up. Every example in it is tested.
- Dust connects like placing it by hand (a lone dust is a "+" from 1.16), and repeaters get their
  `locked` state.
- **The viewer tab is reused.** Edits no longer open a new browser tab: the server waits for the tab
  that's already open to reconnect (after a new session too), and only opens one when there is none.
  A hidden tab shows a dot in its title when a change arrives.

## 0.3.1

- Fix: Claude dropped the `focus_view`, `inspect` and `render_views` tools, because their `[x, y, z]`
  coordinates were described as a JSON Schema draft-07 tuple, which the Claude API (JSON Schema
  2020-12) rejects. A test now checks every tool's schema against 2020-12.

## 0.3.0

- **New name: VibeSchem**, "AI builder for Minecraft". Plugin `vibeschem@vibeschem`, desktop
  extension `vibeschem.mcpb`. Coming from `minecraft-schematic-lab`? Uninstall it first (see the
  README); your builds stay in `~/.minecraft-schematic-lab`.
- **Windows** support for the plugin: one launch command for every OS (`scripts/start-server`, with
  `start-server.cmd` on Windows), and Node is downloaded when missing, without admin rights.
- Ready for **Anthropic's plugin directory**: listing page (`plugin/README.md`), icon, privacy
  policy, documentation and support links, third-party notices.
- **Security**: build scripts run in a sandbox that can't reach Node; the local server answers only
  its own viewer (no DNS rebinding or cross-site requests) and binds to `127.0.0.1` only; a stray
  promise rejection no longer stops it; fastify, @fastify/static and the MCP SDK updated past their
  advisories; Node downloads pinned to v24.22.0 with SHA-256 sums; exports never overwrite a file.
  See [SECURITY.md](SECURITY.md) to report a problem.
- MCP tools carry titles and read-only/destructive annotations, and say they are for Minecraft.
- **License: GNU AGPL v3** (`AGPL-3.0-only`) instead of MIT. The name and logo are reserved
  ([TRADEMARKS.md](TRADEMARKS.md)). Versions up to 0.2.0 stay available under MIT.

## 0.2.0

- Rewrite: expert building guides and BuildSpec, live 3D viewer with the real game textures and
  block models, strict Minecraft versions from 1.8 to the newest, exports for WorldEdit, Litematica
  and structure blocks.
- Claude Code plugin, and a Claude Desktop extension for the chat.

## 0.1.0

- First version: build Minecraft schematics by chatting with Claude.
