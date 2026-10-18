# VibeSchem

**AI builder for Minecraft.** Describe a build in your own words, in any language: a cottage, a
fantasy castle on a floating island, a gothic cathedral, a whole village. Claude designs it
automatically, shows it in a live 3D preview with the real game textures, and exports it as a
schematic for **WorldEdit**, **Litematica** or vanilla **structure blocks**, ready to paste into your
world.

## What you get

- **Builds like an experienced builder.** Claude follows building guides distilled from expert
  practice: massing, depth, palettes and gradients, real roofs, styles, details and landscaping.
- **Live 3D viewer** in your browser with the real Minecraft textures and block models: orbit, pan,
  zoom, cut layer by layer, inspect blocks, see the material list and the version history.
- **Claude sees what you see.** It renders the build from any angle, with close-ups and sections.
  Pin a note on a block ("make this roof steeper") and Claude knows exactly which part to change.
- **Every Java Edition version from 1.8 to the newest.** Only blocks that exist in the version you
  choose are used, with suggestions for substitutes.
- **Schematic export**: WorldEdit `.schem` (Sponge v2/v3), MCEdit `.schematic` (1.8 to 1.12),
  Litematica `.litematic`, structure block `.nbt`, and a material list with stacks and shulker
  boxes. Files can be saved straight into your WorldEdit or Litematica folder.

## How to use it

1. Add VibeSchem from **Customize → Plugins** in the Claude app, or with `/plugin` in Claude Code.
   From its GitHub repository instead, run this in Claude Code:
   `/plugin install vibeschem --marketplace SimoneRecchia/minecraft-schematic-lab`
2. Ask for a build, for example:

   > Build me a fantasy castle on a floating island for 1.20.1, at most 100×100.

3. The 3D viewer opens in your browser. Ask for changes in the chat, or pin notes on blocks with the
   Note tool (N) and tell Claude to look at them.
4. Export with the **Export** button in the viewer, or ask Claude ("export it for WorldEdit"). With
   WorldEdit, put the `.schem` file in `config/worldedit/schematics`, then run `//schem load <name>`
   and `//paste` in game.

## Where it works

VibeSchem starts a small server on your own computer, so it works where Claude can run programs on
your computer: Claude Code (terminal, IDE extensions, or the desktop app's Code tab) and tasks in the
Claude desktop app that run on your computer. A chat in a web browser or on a phone, with no computer
attached, can't start it. Supported systems: macOS and Linux.

The very first start prepares the builder once, which takes about a minute and needs internet. It
uses Node.js 22 or newer if you have it; otherwise it downloads the official Node.js into your home
folder, with no administrator password. If the tools don't show up the first time, open a new
session.

## What it runs, downloads and stores

Everything runs on your computer. VibeSchem has no account, no analytics and no telemetry, and it
never sends your builds, notes or prompts anywhere. Claude sees your conversation as usual.

**Programs.** The plugin starts `scripts/start-server.sh`, which finds Node.js 22+, installs the
server's open-source dependencies if Claude didn't already install them, and starts
`server/server.mjs`. The server listens only on your own computer (`127.0.0.1`, port 8765 or the
next free one) and opens the viewer in your default browser.

**Downloads**, each only when needed:

- **Mojang** (`piston-meta.mojang.com` and the official download links it lists): the Minecraft
  client for the version you build for, once per version, to read its textures and block models.
  Skipped when your Minecraft launcher already has that version. Checked against Mojang's checksum,
  kept on your computer, never redistributed.
- **Node.js** (`nodejs.org`): the official Node.js LTS, only if no Node.js 22+ is installed.
  Checked against the published checksum.
- **npm** (`registry.npmjs.org`): the exact package versions pinned in `package-lock.json`, only if
  Claude didn't already install them.

**Files it reads**: your Minecraft launcher folder (`~/.minecraft`, or
`~/Library/Application Support/minecraft` on macOS), to reuse a game version you already installed
and to find your WorldEdit and Litematica folders.

**Files it writes**: its own folder `~/.minecraft-schematic-lab` (your builds and their history, the
extracted textures, downloaded game clients and Node.js). Exported schematics go only where you ask:
a download from the viewer, your `Downloads` folder, or your WorldEdit or Litematica folder.

To remove everything, uninstall the plugin and delete `~/.minecraft-schematic-lab`.

Privacy policy:
[PRIVACY.md](https://github.com/SimoneRecchia/minecraft-schematic-lab/blob/main/PRIVACY.md).

## Support and source

Questions and bug reports:
[GitHub issues](https://github.com/SimoneRecchia/minecraft-schematic-lab/issues). The full source
code, including the server bundled here, is at
[SimoneRecchia/minecraft-schematic-lab](https://github.com/SimoneRecchia/minecraft-schematic-lab).

MIT license. Block data from
[PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) (MIT). Minecraft
textures and models are © Mojang and are read from your own copy of the game at run time.

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
