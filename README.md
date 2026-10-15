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

## Quick start

Requirements: macOS, Linux or Windows with [Claude Code](https://claude.com/claude-code). Node 22+ and
pnpm are installed for you if missing (no admin rights).

```bash
git clone https://github.com/SimoneRecchia/minecraft-schematic-lab.git
cd minecraft-schematic-lab
bash scripts/setup.sh
```

Restart Claude Code once, open it in this folder and ask, in any language:

> Costruiscimi un castello fantasy su un'isola fluttuante, per la 1.20.1, massimo 100×100.

The viewer opens in your browser. Ask for changes in chat or pin notes on blocks with the Note tool
(N), then tell Claude "guarda le note". Export with the **Export** button.

In game (WorldEdit): put the file in `config/worldedit/schematics` (single player) or
`plugins/WorldEdit/schematics` (server), then `//schem load <name>` and `//paste`.

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
pnpm bundle           # bundle/server.mjs + viewer + guides, for npx / a Claude plugin
PORT=8790 pnpm --dir apps/server start   # standalone server for development
```

See [CLAUDE.md](CLAUDE.md) for the architecture, API and the protocol Claude follows.

## License

MIT. Block data from [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data)
(MIT). Minecraft textures and models are © Mojang and are read from your own game files at runtime.
