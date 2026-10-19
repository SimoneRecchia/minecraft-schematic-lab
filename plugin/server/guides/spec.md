# BuildSpec reference

A BuildSpec is JSON. The compiler turns it into blocks, validates every block against the chosen Minecraft version, fixes block states the way the game would (connections, stair corners…), and the viewer shows it with the real textures.

```json
{
  "name": "Fantasy Castle",
  "minecraftVersion": "1.21.4",
  "description": "optional, shown to the user",
  "palette": { "wall": { "mix": { "stone_bricks": 6, "cracked_stone_bricks": 2, "mossy_stone_bricks": 1 }, "scale": 3 } },
  "components": { "tower": { "operations": [ … ] } },
  "operations": [ { "id": "keep", "type": "box", "from": [0,0,0], "to": [20,15,20], "block": "wall", "walls": true } ],
  "seed": 7,
  "anchor": [10, 0, 0],
  "size": { "x": 64, "y": 48, "z": 64 }
}
```

| Field | |
|---|---|
| `name` | Required. Also the file name on export. |
| `minecraftVersion` | Required, strict: `"1.21.4"`, `"1.20.1"`, `"1.16.5"`, `"1.12.2"`, `"1.8.9"`, `"26.1"`… (`list_blocks({versions:true})`). Blocks that don't exist in it are errors. |
| `palette` | Named blocks/materials (see Palette). Use keys for every material so the user can ask "make the roof darker" and you change one line. |
| `components` | Reusable sub-builds, placed with `place` (rotated, mirrored, repeated). |
| `operations` | Executed in order; later operations overwrite earlier ones (use that: build mass, then carve, then detail). |
| `seed` | Changes every random choice (mixes, trees, terrain) deterministically. Same spec = same build. |
| `anchor` | The spec point that lands at the player's feet on `//paste`. Default: horizontal centre at y=0. |
| `size` | Optional hard bounds (0..size-1). Usually omit it: bounds are computed from the content and may be negative. |
| `site` | `{ "id": "site_…" }`: build on a piece of the player's world or of a schematic, imported with `import_site`. Coordinates become relative to the chosen point, the site's blocks are the starting volume and exports go back to the same world position. See read_guide("terrain"). |

## Coordinates

- Integer block positions `[x, y, z]`. **+X = east, +Y = up, +Z = south (north = −Z).** The viewer's "front" view looks at the south face.
- **y = 0 is ground level by convention**: buildings start at y=0, terrain goes below (e.g. terrain top at y=-1).
- Every `from`/`to` box is **inclusive** at both ends: `from [0,0,0] to [4,0,0]` is 5 blocks.
- Every position is an array `[x,y,z]` — never an object.
- Centres (`center`) may end in `.5` for even widths: diameter is `2r+1` around an integer centre, `2r` around a `.5` centre.

## Blocks

A block reference is a **palette key** or a **block id**, optionally with properties:

- `"stone_bricks"`, `"minecraft:oak_log[axis=x]"`, `"spruce_stairs[facing=north,half=top]"`
- `"roof[facing=east]"` — properties applied to a palette entry (to every member of a mix).
- `"air"` carves.

Unspecified properties get the game's defaults. Properties are validated: wrong names/values are errors listing the allowed ones. Use modern ids for every version (e.g. `white_terracotta`, `oak_planks`, `short_grass`); renamed blocks (`grass`↔`short_grass`, `grass_path`↔`dirt_path`, `sign`↔`oak_sign`, `chain`↔`iron_chain`) are mapped automatically with a note.

**Automatic block states** (what the game does when you place blocks, which WorldEdit does not do on paste):
- fences, walls, glass panes and iron bars connect to neighbours (skip by writing any of `north/east/south/west` yourself);
- stairs get their corner shape (`inner_*`/`outer_*`) from neighbouring stairs (skip by writing `shape`);
- doors, tall flowers, tall grass get their upper half; beds get their head (`part=head` in the `facing` direction); a door claims the block above it (so it cuts its own doorway);
- leaves are `persistent=true` (they won't decay after pasting); grass under snow is `snowy`; gates next to walls are `in_wall`.

**Orientation cheat sheet**
- Stairs `facing` = the side of the tall back; you walk up toward `facing`. Roof stairs face the ridge. `half=top` = upside-down (eaves, corbels, sills).
- Logs/pillars `axis=x|y|z` along their length (beams along X use `axis=x`).
- Trapdoors: closed `half=top` sits at the top of its cell (sills, ledges); `open=true` stands against the side **opposite** `facing` — shutters on a south wall are placed one block south of the wall with `facing=south`.
- Wall-mounted blocks (`wall_torch`, `ladder`, `*_wall_sign`, `*_wall_banner`, `lantern` is not one) have `facing` pointing away from their support.
- `lantern[hanging=true]` hangs under a block; `chain`/`iron_chain[axis=y]`.
- Slabs `type=bottom|top|double`.

## Palette

```json
"palette": {
  "wall":  { "mix": { "stone_bricks": 6, "cracked_stone_bricks": 2, "mossy_stone_bricks": 1, "andesite": 1 }, "scale": 3 },
  "base":  { "gradient": { "axis": "y", "from": 0, "to": 6, "blocks": ["mossy_cobblestone", "cobblestone", "stone_bricks"], "jitter": 0.4 } },
  "roof":  { "mix": { "dark_oak_stairs": 4, "spruce_stairs": 1 } },
  "trim":  "stripped_spruce_log",
  "beam":  "trim[axis=x]"
}
```

- **mix** — weighted random per block. `scale` (default 1) makes clumps of that size: use 2–4 for natural texture (never pure salt-and-pepper on big surfaces). Optional `seed`.
- **gradient** — bands along an axis between `from` and `to` (world coordinates), with dithered edges (`jitter` 0–1, default 0.35). Members can be mixes.
- An entry can point to another entry, and props can be added on use: `"roof[facing=north]"`.
- Mixes of stairs used by `roof` automatically get matching slab/full-block mixes.
- Choice depends on world position, so rotated/repeated copies still look varied.

## Operations

Every operation may have:
- `id` — a short unique name. **Always set it**: edits, feedback and inspection refer to operations by id.
- `note` — free text for yourself.
- `mask` — where it may write: `"air"` (only empty cells — e.g. add details without breaking walls), `"solid"` (only over existing blocks — e.g. re-texture), or a list of blocks it may replace: `["stone_bricks", "cobblestone"]`.

### box
`{type:"box", from, to, block, hollow?, walls?, thickness?, inner?}` — filled cuboid. `hollow`: 6-sided shell. `walls`: only the 4 vertical sides (rooms, towers). `thickness` (default 1). `inner`: fill the inside too (e.g. `"air"` to clear it).

### line
`{type:"line", from, to, block, radius?}` or `{points:[[x,y,z],…]}` — 3D line/polyline; `radius` makes it a round brush (beams, braces, cables, tree branches, bridges' chains).

### cylinder / cone
`{type:"cylinder", center, radius, height, block, axis?, hollow?, thickness?, radius2?, radiusTop?}` — `center` is the centre of the base disc; it extends `height` blocks along `axis` (default `y`). `radius2` makes an ellipse (second radius). `radiusTop` makes a frustum (taper). Hollow rings are clean 1-block walls.
`{type:"cone", center, radius, height, block, axis?, hollow?}` — tapers to a single-block tip.

### sphere / dome
`{type:"sphere", center, radius | radii:[rx,ry,rz], block, hollow?, thickness?, half?}` — `half`: `top|bottom|north|south|east|west` keeps one half.
`{type:"dome", center, radius, height?, block, hollow?}` — upper half-ellipsoid standing on `center` (the base centre); `height` = vertical radius.

### polygon
`{type:"polygon", points:[[x,z],…], y, height, block, hollow?, thickness?}` — vertical prism of any footprint (irregular courtyards, star forts, L-shaped houses). `hollow` = only the outline walls.

### roof
The single most important operation for good houses.
```json
{ "id":"roof", "type":"roof", "shape":"gable", "from":[0,6,0], "to":[12,6,8],
  "block":"roof", "pitch":1, "overhang":1, "gable":"spruce_planks", "eaves":"spruce_stairs" }
```
- `from`/`to`: **x,z = the outer faces of the walls; `from[1]` = the first layer above the wall top.** The roof surface sits directly on the walls and overhangs `overhang` blocks (default 1) on every side, dropping one row lower per step.
- `shape`: `gable` (ridge along `axis`, default the longer side), `hip` (slopes on 4 sides, corners shaped automatically), `shed` (one slope rising toward `rise`: north/south/east/west), `flat` (one layer of `block`; `eaves` adds a 1-block border on top), `cone` (round towers: `center:[x,y,z]` + `radius` of the wall circle instead of from/to).
- `block`: stairs (or a palette key of stairs). A full block gives a stepped roof.
- `pitch`: rise per horizontal block — `1` = 45° (stairs), `0.5` = shallow (slab, stairs, slab…), `2` = steep (full block + stairs), `3`–`4` spires. Or `profile:[…]` = the rise of each row from the eave inward, e.g. `[0.5,0.5,1,1,2,2]` for a concave East-Asian/bell curve, `[2,2,2,1,0.5]` for a gambrel/mansard.
- `slab` / `full`: override the derived half-step slab and solid filler (default: the same material as the stairs).
- `gable`: fills the triangular end walls (gable and shed only).
- `fill`: fills the whole volume under the roof (solid attic).
- `eaves`: block put under the outer row as upside-down stairs facing the wall — the shadow line that makes roofs read as thick. Use a stairs block.
- `ridge`: caps the ridge (odd widths get a slab cap by default) — e.g. a slab, or `"stripped_dark_oak_log"` for a log ridge beam; on `cone` it is the finial on the tip (`lightning_rod`, `end_rod`, a wall).
- Odd widths (5, 7, 9, 11…) give a single ridge row; even widths give two stairs back to back.
- Cross-gables / L-shaped houses: one roof per wing; build the larger wing's roof last so its slope cleanly cuts the other, or carve the valley.

### arch
`{type:"arch", from, to, block, style?, rise?, width?, cut?, fill?}` — an arch in a vertical plane. The longer horizontal side of from/to is the span, the shorter the depth (wall thickness); `from[1]` is where the curve starts (springing line). `style`: `round` (default, semicircle/ellipse), `pointed` (gothic), `segmental` (flat bridge arch), `flat` (lintel). `rise` = curve height (default: half the span for round). `width` = ring thickness. `cut:true` carves the opening below the ring; `fill` fills the spandrels above the ring up to `to[1]`.

### blocks
`{type:"blocks", block, at:[[x,y,z],…], nbt?, ground?}` — individual blocks (details, lamps, flowers). `ground:true` counts each y from the ground at its x/z (0 = on it). `nbt` = block entity data for every placed block (chest items, sign text, banner patterns). Numbers become int, decimals double, booleans byte; strings like `"1b"`, `"5s"`, `"12L"`, `"0.5f"` keep that exact NBT type.

### layers
Draw small detailed parts as ASCII — the most precise way to place a facade, a statue, furniture, a pixel-art emblem.
```json
{ "id":"door_frame", "type":"layers", "origin":[4,0,8], "plane":"xy",
  "legend": { "#":"stone_bricks", "s":"stone_brick_stairs[facing=south,half=top]", "D":"spruce_door[facing=south]", "|":"stripped_spruce_log" },
  "layers": [[ "#sss#",
               "#|.|#",
               "#|D|#" ]] }
```
- `plane:"xz"` (default): each layer is a floor plan; layers stack upward; rows go +z, characters go +x.
- `plane:"xy"`: front elevation; each layer is a vertical slice, layers stack toward +z (south); **rows are listed top to bottom**, characters go +x.
- `plane:"zy"`: side elevation; layers stack toward +x; rows top to bottom; characters go +z.
- `" "` and `"."` leave the cell untouched unless mapped; map a character to `"air"` to carve.

### terrain
`{type:"terrain", from, to, shape?, height?, amplitude?, scale?, surface?, subsurface?, depth?, core?, waterLevel?, water?, edgeFalloff?, seed?}` — ground under/around a build. x,z = extent; `from[1]` = base level; columns are filled from the base up to `base + height ± amplitude·noise`. Shapes: `hills` (default), `flat`, `mountain` (peak in the middle), `plateau` (terraced), `island` (floating island with a rocky underside). Steep spots automatically show `core` (rock) instead of grass. `waterLevel` floods everything below it with `water`. Defaults: grass_block / dirt (depth 3) / stone.

### tree
`{type:"tree", at, kind, height?, radius?, log?, leaves?, seed?}` — procedural trees with branches, logs along their branch direction and ragged leaf canopies (persistent). Kinds: `oak`, `big_oak`, `birch`, `spruce`, `pine`, `dark_oak` (2×2), `jungle` (2×2, tall), `acacia`, `cherry`, `willow` (hanging strands), `palm`, `dead`, `bush`, `fantasy` (huge, twisted, mixed azalea leaves). `at` = the block above the ground; `ground:true` puts it on the ground under `at` (at.y = height above it). Change `seed` for a different tree.

### scatter
`{type:"scatter", from, to, density, block | component | tree, on?, spacing?, seed?}` — finds the top surface of every column in the box and places on it with probability `density`: flowers and grass (use a palette mix), bushes, rocks (a component), or trees (`tree:"oak"`). `on` limits the surfaces (e.g. `["grass_block"]`); `spacing` keeps placements apart. Components are rotated randomly.

### replace
`{type:"replace", target, block, from?, to?, chance?, seed?}` — swap blocks, keeping orientation (stairs stay stairs facing the same way). With `chance` it weathers: `{target:"stone_bricks", block:"mossy_stone_bricks", chance:0.15, from:[0,0,0], to:[30,3,30]}`. No region = the whole build so far.

### flatten / foundation / path (ground shaping)
For builds on real terrain (a `site`) or on `terrain`; see read_guide("terrain").
- `{type:"flatten", from, to, level?, blend?, shape?, clear?, surface?, subsurface?, depth?, core?}` — levels the x/z plot so its ground ends at `level − 1` (default: the plot's median), easing the ground around it over `blend` blocks (default 4) and clearing what stands on the plot.
- `{type:"foundation", from, to, block, style?, spacing?, depth?, shape?}` — fills under a footprint (top layer at the higher y) down `depth` blocks into the ground; `style:"pillars"` only at corners and every `spacing` blocks on the edges.
- `{type:"path", points:[[x,z],…], width?, block?, edge?, clear?}` — a path that follows the ground, replacing its top block (dirt_path; gravel before 1.17) and the plants on it.

### group
`{type:"group", operations:[…], offset?, rotate?, mirror?, repeat?, symmetry?}` — operations in a local frame. Transform order: `mirror` (`x` flips east↔west, `z` flips north↔south, around local 0) → `rotate` (0/90/180/270, clockwise seen from above: east→south) → `offset`. Then `repeat:{count, offset:[dx,dy,dz]}` makes copies shifted in the parent frame, and `symmetry:{x?:c, z?:c}` adds a mirrored copy across the plane x=c and/or z=c (c may be `.5`). Block states (facing, axis, sign rotation, connections, stair shapes, hinges) rotate and mirror with the copies.

### place
`{type:"place", component, at, ground?, rotate?, mirror?, repeat?, symmetry?}` — places `components[component]` with its local origin at `at`; `ground:true` stands every copy on the ground under it (at.y = height above it). Build components around their local origin (e.g. a window frame from [0,0,0]), then place them many times. Components can place other components.

### script
`{type:"script", code, args?}` — JavaScript for procedural work: spiral stairs, ring walls with crenels, rose windows, organic shapes, city blocks, anything repetitive. Runs inside the current group transform. On ground: `ground(x,z)`, `surface(x,z)`, `water(x,z)`, `SITE`. See read_guide("scripts").

## circuit (redstone)
Optional top-level `"circuit": {inputs, outputs, tests, settleTicks?}`. It names a circuit's inputs and outputs and holds tests that the redstone simulator runs on every build. Read read_guide("redstone").

## Workflow tips for specs
- Build in passes: masses → structure (frames, pillars, floors) → roofs → openings (carve with `air`) → detail (`mask:"air"` so you don't break walls) → weathering (`replace` with `chance`) → landscape.
- Palette keys + ids make edits one-liners: `edit_build({edits:[{op:"palette", set:{"roof":"deepslate_tile_stairs"}}]})`.
- Errors come back all at once with the operation path, e.g. `operations[3] "east_tower": minecraft:tuff_bricks does not exist in 1.20.1 (added in 1.21). Closest blocks…` — fix them all, then call again.
- Limits: ~100 million cells of bounding space, 65 000 distinct block states, scripts 20 s.
