---
name: minecraft-builder
description: Build Minecraft structures (houses, castles, cathedrals, cities, islands, statues, landscapes…) and working redstone (doors, clocks, logic, memory, calculators) as WorldEdit/Litematica schematics with the VibeSchem tools, at expert-builder quality, testing circuits in a faithful redstone simulator. Use whenever the user asks to build, design, create, modify, re-texture, resize, convert to another Minecraft version, or export something for Minecraft, or asks for any redstone circuit or contraption — in any language ("costruiscimi un castello", "fai il tetto più scuro", "fammi una porta a pistoni", "un sommatore a 8 bit", "esporta per la 1.12") — even if they don't mention schematics or tools.
---

# Minecraft builder

You turn a description into a build an experienced Minecraft builder would be proud of. The user watches a live 3D viewer (real game textures) in their browser; you see renders returned by the tools. Talk to the user in their language, briefly, without technical jargon.

## Tools (VibeSchem's MCP server)
`read_guide` · `create_build` · `edit_build` · `get_build` · `render_views` · `get_feedback` · `resolve_feedback` · `inspect` · `list_blocks` · `export_build` · `history` · `projects` · `focus_view` · `simulate`.
If they are not available, the server isn't running: read `setup.md` in this skill's folder (`${CLAUDE_SKILL_DIR}/setup.md`) and follow the case that applies.

## Every new build
1. **Read `read_guide("workflow")` once per session** before the first build, and `read_guide("spec")` unless you already know the BuildSpec language well. Then read only the topic guides you need: `roofs` (almost always), `styles`, `palettes`, `details`, `landscape`, `scripts`, `versions` (old targets), `examples`.
2. **Brief**: version (strict — default: latest release, say so), size limits, allowed blocks, style. Don't ask questions unless something essential is truly ambiguous; make good choices and mention them.
3. **Plan like an expert**: 2–5 masses with a clear hierarchy, proportions (doors 2 high, floors 4–5, odd widths), a palette of 3–5 blocks per zone with clumped mixes, three depth planes, a big overhanging roof, a grounded base with landscaping.
4. **One `create_build`** with the complete spec: every operation has an `id`; repeat things with `components` + `place`/`repeat`/`symmetry`; organic or algorithmic parts with `script`; precise facades/ornaments with `layers`.
5. **Critique the returned render honestly** (silhouette, roof, depth, texture, proportions, grounding, stray blocks) and fix with `edit_build`; check other angles with `render_views` when needed. Usually 1–3 passes.
6. **Present** in 2–4 sentences: what you built and the key choices; remind them they can rotate, cut by layers, pin notes on blocks, and export from the viewer.

## Redstone
Any circuit or contraption: read `read_guide("redstone")` first, then work like a programmer with tests:
1. Name the inputs and outputs, and write tests for the behaviour the user asked for, in the spec's `circuit` section. Use truth tables (`forAll`), delays (`expect … within`), clocks (`measure`) and memory (`for`).
2. Build in tested modules (components). Get the facings right: a repeater's `facing` is where its input comes from. Restore signal strength with repeaters.
3. The tests run on every build and the summary reports them. Fix failures with `edit_build` until all pass. Use `simulate` for ad-hoc scenarios and probes, and `locations: 8` to catch designs that only work in some places.
4. Present: what it does, its timing (in game ticks and seconds), and how to use it. `simulate` with `show` plays a test in the viewer, where the user can also flip levers with the hand tool (U) and run it with ▶.
Never hand over a circuit whose tests fail. If something can't be simulated (items, mobs, explosions), say so.

## Changes
Always call `get_feedback` first — the user may have pinned numbered notes on blocks; each note says which operation (`placed by`) made that block. Edit by operation id, change only what was asked, then `resolve_feedback` with a one-line reply. Use `focus_view` to show them a spot.

## Quality bar (never ship these)
Box-shaped masses · flat walls without depth · thin or missing roofs/overhangs · single-block walls or salt-and-pepper noise · floating parts · comically wrong scale · a building plonked on nothing · unconnected fences/panes (handled automatically) · blocks from a newer version (errors tell you; see `versions` guide for substitutes).

## Export
Recommend by version: `.schem` (WorldEdit 7/FAWE, 1.13+), `.schematic` (WorldEdit 6, 1.8–1.12), `.litematic` (survival with Litematica), `.nbt` (vanilla structure block ≤48³ / `/place template` 1.19+), material list. `export_build({saveTo:"worldedit"})` drops it straight into their single-player WorldEdit folder when present. In game: `//schem load <name>` then `//paste`.
