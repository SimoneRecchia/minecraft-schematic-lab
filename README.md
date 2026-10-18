# VibeSchem

**AI builder for Minecraft.** Describe a build to Claude — a cottage, a fantasy castle on a floating
island, a gothic cathedral, a whole village — and Claude designs it automatically, shows it in 3D
with the real game textures, and exports an expert-quality schematic for WorldEdit, Litematica or
structure blocks that you can paste into your world.

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

[Changelog](CHANGELOG.md) · [Privacy](PRIVACY.md) · [Security](SECURITY.md) ·
[Contributing](CONTRIBUTING.md) · [License](#license)

## Install the plugin

Requirements: macOS, Windows 10/11 or Linux, and Claude Code (terminal or desktop app) or the Claude
desktop app. Nothing else: Node 22+ is used if you have it, otherwise downloaded once (no admin
rights). The plugin runs a small server on your computer, so it works in Claude Code and in
desktop-app tasks that run on your computer, not in a browser or phone chat without a computer.

**From Anthropic's plugin directory** (once VibeSchem is listed there): in the Claude app open
**Customize → Plugins → Discover**, search for VibeSchem and click **Add**. In Claude Code, run
`/plugin` and look under **Discover**. A plugin added on claude.ai also reaches Claude Code.

**From this repository**, in Claude Code:

```
/plugin marketplace add SimoneRecchia/minecraft-schematic-lab
/plugin install vibeschem@vibeschem
```

On Claude Code 2.1.275 or later one line is enough:

```
/plugin install vibeschem --marketplace SimoneRecchia/minecraft-schematic-lab
```

In the Claude app you can also open **Customize → Plugins → Add → Add marketplace** and enter
`SimoneRecchia/minecraft-schematic-lab`. Or from a terminal:

```bash
claude plugin marketplace add SimoneRecchia/minecraft-schematic-lab
```

```bash
claude plugin install vibeschem@vibeschem
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

Update or remove it from the `/plugin` menu (or **Customize → Plugins**), or in a terminal with
`claude plugin update vibeschem@vibeschem` / `claude plugin uninstall vibeschem@vibeschem`. Your
builds stay in `~/.minecraft-schematic-lab`.

**Coming from `minecraft-schematic-lab`** (the old name)? Remove it first, so the tools don't appear
twice: `/plugin uninstall minecraft-schematic-lab@minecraft-schematic-lab`, then
`/plugin marketplace remove minecraft-schematic-lab`, then install as above. Your builds are kept.
Set the tools up by hand before (`scripts/setup.sh` or `npx github:…`)? Remove that connector too:
`claude mcp remove --scope user minecraft-schematic-lab`.

Windows support is new: if the tools don't start there, please
[open an issue](https://github.com/SimoneRecchia/minecraft-schematic-lab/issues) with what Claude
shows in `/mcp`.

## Use it in a Claude desktop chat (extension)

A chat can't start a plugin's server, but it can run a desktop extension. Requirements: the
[Claude desktop app](https://claude.ai/download) on macOS (Apple Silicon or Intel) or Windows
(Windows not tested yet). Nothing else to install: the extension runs on the app's own Node.

1. Download **`vibeschem.mcpb`** from the
   [latest release](https://github.com/SimoneRecchia/minecraft-schematic-lab/releases/latest).
2. Double-click it (or drag it onto **Settings → Extensions** in the app) and click **Install**.
3. Open a new chat and ask, in any language:

   > Costruiscimi un castello fantasy su un'isola fluttuante, per la 1.20.1, massimo 100×100.

The viewer opens in your browser, exactly as with the plugin. To update, install the newer `.mcpb`
the same way; to remove it, use **Settings → Extensions**. Your builds stay in
`~/.minecraft-schematic-lab`, shared with the plugin. Installed the old **Minecraft Schematic Lab**
extension? Remove it in **Settings → Extensions**.

**Optional, for better builds: the building skill.** The plugin brings a skill that makes Claude
follow the expert workflow on every build request; an extension can't carry it. To add it to a chat,
download **`minecraft-builder-skill.zip`** from the same release, then in the app go to
**Customize → Skills**, upload the zip and turn the skill on. Skills need **Code execution** turned on
(**Settings → Capabilities**). Without the skill, Claude still gets the building guides from the
extension's `read_guide` tool.

Also using the plugin? Extensions load in the desktop app's Code tab too, so there you'd get the
tools twice (two servers, two viewer tabs). Keep just one of them: turn the extension off in
**Settings → Extensions** while you work in the Code tab, or uninstall the plugin.

### From a clone (to work on the code)

```bash
git clone https://github.com/SimoneRecchia/minecraft-schematic-lab.git
cd minecraft-schematic-lab
bash scripts/setup.sh
```

Restart Claude Code once and open it in this folder: the setup registers a connector that runs the
sources directly, and the skill in `.claude/skills` loads from the project.

## Privacy and security

- **Nothing leaves your computer** except downloads: the Minecraft client from Mojang (only for game
  versions your launcher doesn't have), Node.js from nodejs.org and the server's npm packages (only
  on the first start, if missing). No account, analytics or telemetry. Details in
  [PRIVACY.md](PRIVACY.md); `MSL_OFFLINE=1` turns the Mojang download off.
- **The local server answers only its own viewer**: it listens on `127.0.0.1` and refuses requests
  from other websites (foreign `Host`, `Origin` or `Sec-Fetch-Site`).
- **Build scripts run in a sandbox**: the JavaScript Claude writes for `script` operations runs in an
  isolated V8 context with a time limit and no way back to Node (files, network, processes).
- **Downloads are verified**: Node.js is pinned to an exact version with SHA-256 sums in the
  launchers, the Minecraft client is checked against Mojang's SHA-1, npm packages come from the
  lockfile. Exports never overwrite an existing file.

Found a vulnerability? Report it privately, as [SECURITY.md](SECURITY.md) explains.

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
pnpm mcpb             # bundle + the desktop extension in dist/ (.mcpb + skill zip), smoke-tested
PORT=8790 pnpm --dir apps/server start   # standalone server for development
claude plugin validate .                 # check the plugin and marketplace manifests
claude --plugin-dir ./plugin             # try the plugin from this checkout without installing it
```

`plugin/` is committed — it's what players install — so run `pnpm bundle` before committing changes
to the server, viewer, guides or skill. Installed plugins only update when the version changes: bump
`version` in `package.json` (and `packages/shared/src/version.ts`), then `pnpm bundle`.

### Anthropic's plugin directory

`plugin/` is also what the directory lists. Its `README.md` is the listing page (it must say what the
plugin runs, downloads and stores), and `plugin.json` gives the name, description, keywords, icon
(`mcpb/icon.svg`, rendered to `mcpb/icon.png` and copied by `pnpm bundle`) and the documentation,
support and privacy links. The `name` `vibeschem` is permanent; `apps/server/src/plugin.test.ts`
checks the directory's blocking rules.

To submit or follow a submission, open the [developer portal](https://claude.ai/directory/manage)
(paid Claude plan, GitHub account connected) → **Submit new** → **Plugin bundle**: repository
`SimoneRecchia/minecraft-schematic-lab`, plugin path `plugin`, tracked branch `main`, then
**Validate**. Expect a reviewer on every version: the directory always holds plugins that install
npm packages from a lockfile, run launcher scripts from a repository subfolder, or ship files over
256 KiB or bundled code. After the first listing, every version merged into `main` is scanned and
published, so bump `version` for each release (and add it to [CHANGELOG.md](CHANGELOG.md)). See
[Submit your plugin](https://claude.com/docs/plugins/submit) and the
[pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).

### Desktop extension

The extension is built from the same bundle by `pnpm mcpb` (manifest and icon in `mcpb/`): one
`.mcpb` for macOS and Windows that runs on Claude Desktop's built-in Node and carries the native
`@napi-rs/canvas` binary for each OS/CPU. It isn't committed: pushing a version tag (`v0.3.0`, …)
runs `.github/workflows/release.yml`, which builds both files and publishes them in the GitHub
release with that version's CHANGELOG section. The directory no longer lists desktop extensions, so
they're installed from the release. `node scripts/mcpb.mjs --check [file] [--node <binary>]` re-runs
the smoke test (an Electron binary works as `--node`, to try the app's runtime).

### Releasing a version

1. Bump `version` in `package.json` and `packages/shared/src/version.ts`, run `pnpm bundle`, and
   add a `## <version>` section to [CHANGELOG.md](CHANGELOG.md).
2. Merge into `main`: Claude Code users and, after its review, Anthropic's directory pick it up.
3. Push the tag `v<version>` on that commit: the release with the desktop extension follows.

See [CLAUDE.md](CLAUDE.md) for the architecture, API and the protocol Claude follows.

## License

Copyright © 2026 SimoneRecchia.

VibeSchem is free software: you can redistribute it and/or modify it under the terms of the
[GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, version 3
(`AGPL-3.0-only`). It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
license for details.

In short: everyone can install, use, study and change it, and share it, as long as every copy and
every changed version stays under the AGPL with its source code available, also when it is offered
as an online service. Versions up to 0.2.0 were released under the MIT license and stay available
under it.

Additional term under section 7(e) of the AGPL: the license grants no rights to the name VibeSchem
or its logo; see [TRADEMARKS.md](TRADEMARKS.md). Contributions are accepted under the same license
([CONTRIBUTING.md](CONTRIBUTING.md)).

Third-party code shipped in the plugin: `plugin/THIRD_PARTY_NOTICES.md`. Block data from
[PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) (MIT). Minecraft
textures and models are © Mojang and are read from your own game files at runtime.

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
