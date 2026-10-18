# VibeSchem privacy policy

Last updated: 18 October 2026

VibeSchem (the Claude plugin and desktop extension built from this repository) runs entirely on your
computer. It has no accounts, no analytics and no telemetry, and its author receives no data from it.

## What VibeSchem collects

Nothing. It does not collect, store or share personal data, and it never sends your builds, notes,
prompts or files to its author or to any other service.

Claude, the assistant you use VibeSchem with, sees your conversation and the results of VibeSchem's
tools (such as build summaries and preview images) as in any conversation. That is covered by
Anthropic's own privacy policy, not by this one.

## What it downloads

Only when needed, and without sending any of your data:

- the official Minecraft client for the game version you build for, from Mojang's servers
  (`piston-meta.mojang.com` and the download links it lists), to read textures and block models.
  Skipped when your Minecraft launcher already has that version;
- the official Node.js runtime, from `nodejs.org`, only if no Node.js 22 or newer is installed (Claude
  Code plugin only);
- the server's open-source dependencies, from `registry.npmjs.org`, only if Claude didn't install
  them already (Claude Code plugin only).

These downloads are ordinary requests to those services, which see your IP address like any website
does.

## What it stores on your computer

- `~/.minecraft-schematic-lab`: your builds and their history, extracted textures and models, the
  downloaded game clients and, if needed, Node.js;
- exported schematics, only where you ask: a browser download, your `Downloads` folder, or your
  WorldEdit or Litematica folder.

It reads your Minecraft launcher folder to reuse game versions you already installed and to find the
WorldEdit and Litematica folders. Its local viewer listens only on your own computer (`127.0.0.1`).

To delete everything, uninstall VibeSchem and delete the `~/.minecraft-schematic-lab` folder.

## Contact

[github.com/SimoneRecchia/minecraft-schematic-lab/issues](https://github.com/SimoneRecchia/minecraft-schematic-lab/issues)
