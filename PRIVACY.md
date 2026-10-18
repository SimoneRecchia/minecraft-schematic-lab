# VibeSchem privacy policy

Last updated: 18 October 2026

VibeSchem (the Claude plugin and desktop extension built from this repository) runs entirely on your
computer. It has no accounts, no analytics and no telemetry, and its author receives no data from it.

## What VibeSchem collects

Nothing. It does not collect, store or share personal data, and it never sends your builds, notes,
prompts or files to its author or to any other service.

Claude, the assistant you use VibeSchem with, sees your conversation and the results of VibeSchem's
tools (such as build summaries and preview images) as in any conversation. That is covered by
[Anthropic's privacy policy](https://www.anthropic.com/legal/privacy), not by this one.

## What it uses on your computer

- It stores, in the `.minecraft-schematic-lab` folder in your user folder: your builds, their
  version history and the notes you pin in the viewer, extracted textures and models, the downloaded
  game clients and, if needed, Node.js.
- It reads your Minecraft launcher folder to reuse game versions you already installed and to find
  the WorldEdit and Litematica folders. It does not read your Minecraft account or saves.
- It writes exported schematics only where you ask: a browser download, your `Downloads` folder, or
  your WorldEdit or Litematica folder.
- Its local viewer listens only on your own computer (`127.0.0.1`) and refuses requests from other
  websites.

## Retention

Everything stays on your computer until you delete it: projects from the viewer, or the whole
`.minecraft-schematic-lab` folder. Downloaded game clients and Node.js are kept there so they are not
downloaded again. Uninstalling VibeSchem and deleting that folder removes everything it stored.

## Third-party services

VibeSchem shares no data with third parties. Only when needed, it downloads files from these
services; each request carries no information about you or your builds, though the service sees your
IP address and the request, like any website does:

- **Mojang** (`piston-meta.mojang.com`, `piston-data.mojang.com`): the official Minecraft client for
  the game version you build for, to read its textures and block models; skipped when your launcher
  already has that version. [Microsoft privacy statement](https://privacy.microsoft.com/privacystatement).
- **Node.js** (`nodejs.org`, OpenJS Foundation): the Node.js runtime, only if no Node.js 22 or newer
  is installed (plugin only). [OpenJS Foundation privacy policy](https://openjsf.org/privacy).
- **npm** (`registry.npmjs.org`, GitHub): the server's open-source dependencies, only if Claude
  didn't install them already (plugin only).
  [GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

Setting the environment variable `MSL_OFFLINE=1` stops the Mojang download.

## Children

VibeSchem is meant for people who can use Claude, which requires being 18 or older (or the minimum
age in your country, if higher).

## Changes and contact

Changes to this policy are published in this file, with its date. Questions:
[github.com/SimoneRecchia/minecraft-schematic-lab/issues](https://github.com/SimoneRecchia/minecraft-schematic-lab/issues).
