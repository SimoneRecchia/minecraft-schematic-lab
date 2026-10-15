# minecraft-schematic-lab

Describe a Minecraft build to Claude — a cottage, a fantasy castle on a floating island, a gothic
cathedral, a whole village — and get an expert-quality schematic you can paste into your world.

- **Builds like an experienced builder.** Claude follows a building guide distilled from expert
  practice (massing, depth, palettes and gradients, roofs, styles, landscaping) and writes a compact
  BuildSpec with real roof generators, arches, procedural trees, terrain, reusable components,
  symmetry and scripts.
- **Live 3D viewer** in your browser with the **real Minecraft textures and block models**, smooth
  lighting like the game, orbit/pan/zoom (Blender-style shortcuts), layer-by-layer cut, block
  inspector, material list, version history — a macOS-style glass interface, light and dark.
- **Claude sees what you see.** It renders the build from any angle, close-ups and sections; you can
  pin numbered notes on blocks ("make this roof steeper") and Claude knows exactly which part of the
  spec made that block.
- **Strict Minecraft versions** from 1.8 to the newest release: only blocks that exist in the chosen
  version are accepted (experimental ones excluded), with suggestions for substitutes.
- **Export**: WorldEdit `.schem` (Sponge v2/v3), MCEdit `.schematic` for 1.8–1.12, Litematica
  `.litematic`, vanilla structure `.nbt`, and a material list with stacks and shulker boxes. Files can
  be saved straight into your WorldEdit or Litematica folder.

Everything runs locally. The textures come from the official Minecraft client: from your launcher if
that version is installed, otherwise downloaded once from Mojang's servers into
`~/.minecraft-schematic-lab` — they are never redistributed.

## Install (Claude Code plugin)

Requirements: [Claude Code](https://claude.com/claude-code) — the desktop app or the CLI — on macOS
or Linux. Nothing else: Node 22+ is used if you have it, otherwise downloaded once (no admin rights).

In Claude Code, type:

```
/plugin marketplace add SimoneRecchia/minecraft-schematic-lab
/plugin install minecraft-schematic-lab@minecraft-schematic-lab
```

On Claude Code 2.1.275 or later one line is enough:

```
/plugin install minecraft-schematic-lab --marketplace SimoneRecchia/minecraft-schematic-lab
```

In the desktop app you can also click **+ → Plugins → Add plugin** and enter
`SimoneRecchia/minecraft-schematic-lab`. Or from a terminal:

```bash
claude plugin marketplace add SimoneRecchia/minecraft-schematic-lab
```

```bash
claude plugin install minecraft-schematic-lab@minecraft-schematic-lab
```

Then open a new session (or restart Claude Code) and ask, in any language:

> Costruiscimi un castello fantasy su un'isola fluttuante, per la 1.20.1, massimo 100×100.

The very first start prepares the builder once (about a minute, needs internet): it uses your Node
22+ if you have one, otherwise it downloads the official Node from nodejs.org into
`~/.minecraft-schematic-lab/runtime` — no admin password, nothing else on your computer changes. If
the tools don't show up the first time, open a new session.

The viewer opens in your browser. Ask for changes in chat or pin notes on blocks with the Note tool
(N), then tell Claude "guarda le note". Export with the **Export** button.

In game (WorldEdit): put the file in `config/worldedit/schematics` (single player) or
`plugins/WorldEdit/schematics` (server), then `//schem load <name>` and `//paste`.

Update or remove it from the `/plugin` menu, or in a terminal with
`claude plugin update minecraft-schematic-lab@minecraft-schematic-lab` /
`claude plugin uninstall minecraft-schematic-lab@minecraft-schematic-lab`. Your builds stay in
`~/.minecraft-schematic-lab`.

Already set the tools up by hand before (`scripts/setup.sh` or `npx github:…`)? Remove that connector
so the tools don't appear twice: `claude mcp remove --scope user minecraft-schematic-lab`.

Windows isn't supported by the plugin yet.

### From a clone (to work on the code)

```bash
git clone https://github.com/SimoneRecchia/minecraft-schematic-lab.git
cd minecraft-schematic-lab
bash scripts/setup.sh
```

Restart Claude Code once and open it in this folder: the setup registers a connector that runs the
sources directly, and the skill in `.claude/skills` loads from the project.

## Viewer shortcuts

| | |
|---|---|
| Drag / right-drag or Shift-drag / scroll | orbit / pan / zoom (toward the cursor) |
| Double-click | orbit around that block |
| `1` `3` `7` (`Ctrl` = opposite) · `0` | front, right, top · 3D view |
| `4` `6` `8` `2` · `5` | orbit in steps · orthographic |
| `Home` / `F` | frame everything / the selection |
| `L` + `↑` `↓` | layer cut |
| `V` / `N` | navigate / pin a note (Shift-click a second block for an area) |
| `G` · `S` · `Esc` | grid · sidebar · clear |

## Development

```bash
pnpm install
pnpm build            # web viewer (apps/web/dist)
pnpm test             # unit + integration tests
pnpm typecheck && pnpm lint
pnpm catalog          # regenerate the per-version block catalog from minecraft-data
pnpm bundle           # rebuild the plugin in plugin/ (server bundle, viewer, guides, skill)
PORT=8790 pnpm --dir apps/server start   # standalone server for development
claude plugin validate .                 # check the plugin and marketplace manifests
claude --plugin-dir ./plugin             # try the plugin from this checkout without installing it
```

`plugin/` is committed — it's what players install — so run `pnpm bundle` before committing changes
to the server, viewer, guides or skill. Installed plugins only update when the version changes: bump
`version` in `package.json` (and `packages/shared/src/version.ts`), then `pnpm bundle`.

See [CLAUDE.md](CLAUDE.md) for the architecture, API and the protocol Claude follows.

## License

MIT. Block data from [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data)
(MIT). Minecraft textures and models are © Mojang and are read from your own game files at runtime.
