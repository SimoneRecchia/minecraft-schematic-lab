---
name: minecraft-builder
description: Build Minecraft structures (houses, castles, cathedrals, cities, islands, statues, landscapes…) as WorldEdit/Litematica schematics with the minecraft-schematic-lab tools, at expert-builder quality. Use whenever the user asks to build, design, create, modify, re-texture, resize, convert to another Minecraft version, or export something for Minecraft — in any language ("costruiscimi un castello", "fai il tetto più scuro", "esporta per la 1.12") — even if they don't mention schematics or tools.
---

# Minecraft builder

You turn a description into a build an experienced Minecraft builder would be proud of. The user watches a live 3D viewer (real game textures) in their browser; you see renders returned by the tools. Talk to the user in their language, briefly, without technical jargon.

## Tools (MCP server `minecraft-schematic-lab`)
`read_guide` · `create_build` · `edit_build` · `get_build` · `render_views` · `get_feedback` · `resolve_feedback` · `inspect` · `list_blocks` · `export_build` · `history` · `projects` · `focus_view`.
If they are not available, the server isn't loaded:
- **Inside the minecraft-schematic-lab repository** (its CLAUDE.md is loaded): follow CLAUDE.md (one-time setup, first build over HTTP).
- **Installed as the plugin**: the first start prepares Node and the server's parts once (internet, about a minute) and may have outlasted Claude Code's wait. Tell the user it's a one-time preparation, run `sh "${CLAUDE_SKILL_DIR}/../../scripts/start-server.sh" --check` (it finishes the job, or says in its last lines what is missing), then ask them to open a new session or restart Claude Code so the tools load.
- **Neither**: ask them to install the plugin — `/plugin marketplace add SimoneRecchia/minecraft-schematic-lab`, then `/plugin install minecraft-schematic-lab@minecraft-schematic-lab` — and restart Claude Code once.

## Every new build
1. **Read `read_guide("workflow")` once per session** before the first build, and `read_guide("spec")` unless you already know the BuildSpec language well. Then read only the topic guides you need: `roofs` (almost always), `styles`, `palettes`, `details`, `landscape`, `scripts`, `versions` (old targets), `examples`.
2. **Brief**: version (strict — default: latest release, say so), size limits, allowed blocks, style. Don't ask questions unless something essential is truly ambiguous; make good choices and mention them.
3. **Plan like an expert**: 2–5 masses with a clear hierarchy, proportions (doors 2 high, floors 4–5, odd widths), a palette of 3–5 blocks per zone with clumped mixes, three depth planes, a big overhanging roof, a grounded base with landscaping.
4. **One `create_build`** with the complete spec: every operation has an `id`; repeat things with `components` + `place`/`repeat`/`symmetry`; organic or algorithmic parts with `script`; precise facades/ornaments with `layers`.
5. **Critique the returned render honestly** (silhouette, roof, depth, texture, proportions, grounding, stray blocks) and fix with `edit_build`; check other angles with `render_views` when needed. Usually 1–3 passes.
6. **Present** in 2–4 sentences: what you built and the key choices; remind them they can rotate, cut by layers, pin notes on blocks, and export from the viewer.

## Changes
Always call `get_feedback` first — the user may have pinned numbered notes on blocks; each note says which operation (`placed by`) made that block. Edit by operation id, change only what was asked, then `resolve_feedback` with a one-line reply. Use `focus_view` to show them a spot.

## Quality bar (never ship these)
Box-shaped masses · flat walls without depth · thin or missing roofs/overhangs · single-block walls or salt-and-pepper noise · floating parts · comically wrong scale · a building plonked on nothing · unconnected fences/panes (handled automatically) · blocks from a newer version (errors tell you; see `versions` guide for substitutes).

## Export
Recommend by version: `.schem` (WorldEdit 7/FAWE, 1.13+), `.schematic` (WorldEdit 6, 1.8–1.12), `.litematic` (survival with Litematica), `.nbt` (vanilla structure block ≤48³ / `/place template` 1.19+), material list. `export_build({saveTo:"worldedit"})` drops it straight into their single-player WorldEdit folder when present. In game: `//schem load <name>` then `//paste`.
