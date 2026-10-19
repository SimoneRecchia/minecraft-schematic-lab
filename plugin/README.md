# VibeSchem

**AI builder for Minecraft.** Describe a build in your own words, in any language: a cottage, a
fantasy castle on a floating island, a gothic cathedral, a whole village. Claude designs it
automatically, shows it in a live 3D preview with the real game textures, and exports it as a
schematic for **WorldEdit**, **Litematica** or vanilla **structure blocks**, ready to paste into your
world.

## What you get

- **Builds on your own world.** Give Claude a world and a spot (or a starting schematic): it reads
  that area, builds on the real terrain (levelled plots that blend into the slopes, foundations,
  paths that follow the ground) and gives it back in place: as a copy of your world with the build
  already in it, as a vanilla data pack (no mods: `/function` builds it, another undoes it), or as a
  schematic that pastes at the same coordinates. Your original world is only read.
- **Working redstone, tested before you build it.** Ask for a piston door, a clock, a calculator or
  a whole redstone computer. VibeSchem simulates Minecraft Java redstone for your version: game
  ticks, update order, pistons and quasi-connectivity. Claude writes tests for the circuit (truth
  tables, delays, clock periods) and fixes the design until every test passes. In the viewer you
  flip levers, press ▶ to run the circuit at any speed, and replay its tests in 3D.

- **Builds like an experienced builder.** Claude follows building guides distilled from expert
  practice: massing, depth, palettes and gradients, real roofs, styles, details and landscaping.
- **Live 3D viewer** in your browser with the real Minecraft textures and block models: orbit, pan,
  zoom, cut layer by layer, inspect blocks, see the material list and the version history.
- **Claude sees what you see.** It renders the build from any angle, with close-ups and sections.
  Pin a note on a block ("make this roof steeper") and Claude knows exactly which part to change.
- **Every Java Edition version from 1.8 to the newest.** Only blocks that exist in the version you
  choose are used, with suggestions for substitutes.
- **Export**: WorldEdit `.schem` (Sponge v2/v3), MCEdit `.schematic` (1.8 to 1.12), Litematica
  `.litematic`, structure block `.nbt`, a vanilla data pack (1.13+, works without any mod), and a
  material list with stacks and shulker boxes. Files can be saved straight into your WorldEdit or
  Litematica folder, and data packs into a world.

## How to use it

1. Add VibeSchem from **Customize → Plugins** in the Claude app, or with `/plugin` in Claude Code.
   From its GitHub repository instead, run this in Claude Code 2.1.275 or later:
   `/plugin install vibeschem --marketplace SimoneRecchia/minecraft-schematic-lab`
2. In Claude Code, or in a Claude desktop app task on your computer (see
   [Where it works](#where-it-works)), ask for a build. The 3D viewer opens in your browser.
3. Ask for changes in the chat, or pin notes on blocks with the Note tool (N) and tell Claude to
   look at them.
4. Export with the **Export** button in the viewer, or ask Claude. With WorldEdit, put the `.schem`
   file in `config/worldedit/schematics`, then run `//schem load <name>` and `//paste` in game.

### Try these

> Build me a fantasy castle on a floating island for 1.20.1, at most 100×100.

> Costruiscimi una casa giapponese per la 1.20.1, solo legni scuri, con un giardino zen.

> A gothic cathedral for 1.12.2 in stone bricks, very detailed, with flying buttresses.

> Make the roof darker and add a chimney, then export it for Litematica.

> Fammi una porta a pistoni 2×2 nascosta per la 1.21, che si apre con un pulsante.

> An 8-bit adder with levers for the inputs and lamps for the result, with tests.

## Where it works

VibeSchem starts a small server on your own computer, so it works where Claude can run programs on
your computer: Claude Code (terminal, IDE extensions, or the desktop app's Code tab) and tasks in the
Claude desktop app that run on your computer. A chat in a web browser or on a phone, with no computer
attached, can't start it. Supported systems: macOS, Windows 10 and 11, and Linux.

The very first start prepares the builder once, which takes about a minute and needs internet. It
uses Node.js 22 or newer if you have it; otherwise it downloads the official Node.js into your user
folder, with no administrator password. If the tools don't show up the first time, open a new
session.

## What it runs, downloads and stores

Everything runs on your computer. VibeSchem has no account, no analytics and no telemetry, and it
never sends your builds, notes or prompts anywhere. Claude sees your conversation as usual.

**Programs.** The plugin starts `scripts/start-server` (on Windows, `scripts/start-server.cmd`),
which finds Node.js 22+ or downloads it, then runs `scripts/launch.mjs`. That installs the server's
open-source dependencies if Claude didn't already install them, and starts `server/server.mjs`. The
server listens only on your own computer (`127.0.0.1`, port 8765 or the next free one), answers only
its own viewer (requests from other websites are refused), and opens the viewer in your default
browser.

**Build scripts.** For organic shapes Claude can write small JavaScript snippets inside a build
(`script` operations). The server runs them in an isolated sandbox with a time limit: they can only
place and read blocks of the build, with no access to your files, the network or other programs.

**Downloads**, each only when needed:

- **Mojang** (`piston-meta.mojang.com` for the version list, `piston-data.mojang.com` for the file):
  the Minecraft client for the version you build for, once per version, to read its textures and
  block models. Skipped when your Minecraft launcher already has that version. Checked against
  Mojang's SHA-1, kept on your computer, never redistributed.
- **Node.js** (`nodejs.org`): Node.js v24.22.0 (LTS), only if no Node.js 22+ is installed. Checked
  against SHA-256 sums written in the launcher scripts.
- **npm** (`registry.npmjs.org`): the exact package versions pinned in `package-lock.json`, only if
  Claude didn't already install them.

**Files it reads**: your Minecraft launcher folder (`%APPDATA%\.minecraft` on Windows,
`~/Library/Application Support/minecraft` on macOS, `~/.minecraft` on Linux), to reuse a game
version you already installed and to find your WorldEdit and Litematica folders; and your saved
worlds (in that folder and in the Prism, MultiMC, CurseForge and Modrinth instances), only to list
them and to read the area you ask to build on, or a schematic file you choose.

**Files it writes**:

- its own folder `.minecraft-schematic-lab` in your user folder: your builds and their history, the
  extracted textures, downloaded game clients and Node.js;
- inside the plugin's own folder, when it installs the dependencies itself: `node_modules`,
  `.install.log` and a temporary `.install-lock`;
- exported schematics, only where you ask: a download from the viewer, your `Downloads` folder, or
  your WorldEdit or Litematica folder. An existing file is never overwritten: the new one gets a
  number, like `castle (2).schem`;
- when you ask for them: a **copy** of a world with the build in it, as a new world next to the
  original (`World (VibeSchem v3)`), and data pack folders in a world's `datapacks` folder. The
  files of an existing world are never changed.

**Switches**, as environment variables: `MSL_OFFLINE=1` never downloads the Minecraft client (the
preview then needs that version installed in your launcher), `MSL_NO_BROWSER=1` doesn't open the
browser, `MSL_HOME` moves the `.minecraft-schematic-lab` folder, `MSL_SAVES` adds saves folders to
look for worlds in (separated like `PATH`).

To remove everything, uninstall the plugin and delete the `.minecraft-schematic-lab` folder in your
user folder.

## Privacy Policy

VibeSchem collects no personal data and sends nothing about you or your builds to anyone. The full
policy, with what it stores and the services it downloads from:
[PRIVACY.md](https://github.com/SimoneRecchia/minecraft-schematic-lab/blob/main/PRIVACY.md).

## Troubleshooting

- **The tools don't appear after installing.** The first start may still be preparing. Open a new
  session, or ask Claude to run `start-server --check`: it finishes the preparation and says what is
  missing. In Claude Code, `/mcp` shows the server's state and its last error.
- **No internet on the first start.** It needs internet once, for Node.js (if missing) and the
  dependencies. Later starts work offline; each new Minecraft version needs one download unless your
  launcher has it.
- **The dependency install failed.** Its log is `.install.log` in the plugin's folder.
- **The viewer doesn't open.** Open `http://127.0.0.1:8765` yourself (or the port Claude mentions).
  If 8765 is busy, the server takes the next free port.
- **The tools appear twice.** You also have the old `minecraft-schematic-lab` plugin or the desktop
  extension: keep one.

## Support and source

Questions and bug reports:
[GitHub issues](https://github.com/SimoneRecchia/minecraft-schematic-lab/issues). Security
problems: report them privately as
[SECURITY.md](https://github.com/SimoneRecchia/minecraft-schematic-lab/blob/main/SECURITY.md)
explains. The full source code, including the server bundled here, is at
[SimoneRecchia/minecraft-schematic-lab](https://github.com/SimoneRecchia/minecraft-schematic-lab).

## License

Copyright © 2026 SimoneRecchia. VibeSchem is free software: you can use, change and share it under
the GNU Affero General Public License v3 (`LICENSE`), as long as changed versions stay under the same
license with their source code. The name VibeSchem and its logo are not covered by the license
([TRADEMARKS.md](https://github.com/SimoneRecchia/minecraft-schematic-lab/blob/main/TRADEMARKS.md)).
Third-party code shipped in the plugin is listed in `THIRD_PARTY_NOTICES.md`; block data from
[PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) (MIT). Minecraft
textures and models are © Mojang and are read from your own copy of the game at run time.

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
