# Design principles of expert builders

A viewer reads a build in this order: **silhouette → light/dark pattern → hue → depth/shadow → texture → small details.** Fix problems in that order.

## Shape and massing
- **Break the box.** Compose 2–5 overlapping volumes: main mass, wing, porch, bay, tower, chimney. L, T, U and cross plans beat rectangles.
- **Hierarchy.** One dominant element (keep, crossing tower, central hall) ≥1.5× the secondary masses; secondary masses ~0.6× the primary; many small tertiary ones. Skyline peaks in odd groups.
- **Offset heights.** Neighbouring eaves differ by ≥2 blocks. Give each cluster one vertical accent (tower, chimney, spire).
- **Footprints ~1:1.6** (5×8, 7×11, 9×15, 13×21). Avoid cubes. Towers ≥2.5× as tall as wide.
- **Roofs are big.** On traditional styles the roof is 30–60% of the visible facade, about as tall as the wall under it (taller for fantasy). A thin or flat roof is the #1 amateur tell. Above ~15 blocks wide, split the roof into sections each rising 5–7.

## Depth — the three-plane rule
Every facade needs at least three planes:
1. **Structure** (posts, beams, pilasters, corner quoins, buttresses): proud by 1.
2. **Infill wall**: at 0.
3. **Openings** (glass, doors): inset by 1.
Large builds use 2–4 blocks of depth and 2×2 / 3×3 pillars. Put a **shadow line under every horizontal break** (floor line, sill, eave, cornice): upside-down stairs or top slabs. Cheapest → richest: contrasting frame colour → partial blocks (stairs, slabs, trapdoors, walls, fences, buttons: ¼–½ block of relief) → 1-block insets → structural layers (jetties, bay windows, buttresses, balconies, porches, 1–2 overhangs). Leave calm areas — depth everywhere becomes noise.

## Texture and gradients
- 3–5 blocks per zone. A house uses ~6–12 blocks in total, a large build 12–20.
- Mix ≈ 60–70% main / 20–30% secondary / 5–15% flecks. **Clump** minor blocks in patches of 2–4 (`mix` with `scale` 2–4); never salt-and-pepper a big wall.
- **Weathering follows logic**: cracked/mossy/dark blocks near the ground, at corners, near water, on north faces, under eaves (`replace` with `chance` in those regions, or a `gradient` on y).
- Gradients: 3–5 steps ordered by lightness, bands 2–4 rows, dark at the bottom → light at the top.
- Keep colour temperature consistent: cool greys (cobbled_deepslate, andesite, stone) and warm greys (tuff, gravel, packed_mud) look dirty mixed on one surface.

## Colour and value
- At a distance only light and dark survive: use **three values** — dark (roof, frame or base), mid (walls), light (trim/infill). Traditional default: dark roof, light walls, mid-dark base.
- 60-30-10: 60% dominant (walls), 30% secondary (roof, frame), 10% accent (doors, shutters, banners, flowers, copper, gold).
- Complementary accents: warm wood/sandstone + teal (oxidized copper, warped, prismarine, cyan terracotta); grey stone + warm wood + red (bricks, mangrove, banners); green landscape + red/orange roofs (granite, bricks, acacia).
- Saturated blocks (concrete, wool, glazed terracotta, stained glass) are accents — except in modern and sci-fi.
- Match the biome: no warm palettes in snow; the landscape is part of the palette.

## Proportions (a player is 1.8 tall)
| Element | Size |
|---|---|
| Door | 1×2 cottage; 2×3 or 3-wide arch for a manor; gates 3–5 wide × 4–7 tall |
| Clear ceiling | never 2; 3 minimum, 4 typical, 5–6 halls, 8–14 great halls |
| Floor-to-floor | 4–5 houses, 5–6 manors, 6–8 palaces |
| Windows | 1×2, 1×3, 2×3; sill ~1 above the floor; tops aligned with door heads; ≥1 from corners |
| Widths | odd (5/7/9/11) → centred door and single-block ridge; even → central double door |

## Symmetry, rhythm, framing
- Symmetric: formal and sacred buildings (temples, cathedrals, palaces, East-Asian halls). Asymmetric balance: vernacular, fantasy, ruins. "Symmetric core, asymmetric additions" works for most houses.
- Rule of 3: odd groups of windows/dormers/towers; facades in 3 bands (plinth / body / roof-cornice); 3 depth planes; 3 detail scales (big shapes, medium windows/balconies, small trapdoors/buttons/lanterns).
- Rhythm: regular bays 3–5 wide; break it on purpose every 3rd–5th bay (entrance, gable, tower).
- Frame every opening; frame each facade with corner posts and an eave line; frame views of the build with trees and arches.

## Big builds
- Modules: design one bay (e.g. buttress + lancet + clerestory + pinnacle) or one house type, repeat it, vary every copy a little (mirror, height ±1–3, palette swap, gable turned to the street).
- Detail density follows view distance: far (>100 blocks) only silhouette and big value masses read; mid (30–100) rhythm, depth, roof texture; near (<30) block states, trapdoors, interiors. Spend detail at entrances, eye level and skyline tops.
- Scale details up at monumental size: 1-block depth looks flat — use 2–4-block insets, 2×2/3×3 pillars, multi-row cornices.
- Cities: streets main 7–11, secondary 4–5, alleys 2–3; districts of 15–25 buildings; landmark order square → town hall → church → tavern/smithy/mills → walls and towers; richer stone centre, wooden edges; follow the terrain.

## Amateur mistakes → expert fixes
| Mistake | Fix |
|---|---|
| Box mass | 2–5 volumes, L/T plans, heights differ ≥2 |
| Flat walls | three planes, sills, lintels, string courses, pillars |
| Flat/thin roof, no overhang | pitched roof ≥ wall height, overhang 1–2, eaves trim |
| One-block walls or rainbow walls | 3–5 blocks per zone, 60-30-10, value contrast |
| Salt-and-pepper texture | clumped mixes, logical weathering, banded gradients |
| Random windows | regular bays, aligned across floors, ≥1 from corners |
| 2-high ceilings, giant doors | proportion table |
| Floating overhangs/balconies | corbels, brackets, posts under them |
| Detail everywhere | calm areas around focal points |
| House plonked on flat grass | plinth, terrain, paths, trees, bushes |
| Torch spam | lanterns, hidden light, purposeful pools of light |
| Jaggy circles | odd diameters; use cylinder/cone/sphere ops |
| Copy-pasted houses | modules + variations |
