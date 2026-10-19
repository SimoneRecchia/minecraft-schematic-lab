# Landscape — ground, trees, water

A build is only as good as the ground it stands on. Give every build a believable site unless the user wants a bare schematic. Building on the player's own world (real terrain, `flatten`, `foundation`, `path`, `ground: true`)? See read_guide("terrain").

## Terrain
```json
{ "id":"ground", "type":"terrain", "from":[-20,-6,-20], "to":[60,-6,50], "shape":"hills", "height":5, "amplitude":2, "edgeFalloff":true,
  "surface":"ground_top", "subsurface":"dirt", "core":"stone", "waterLevel":-3 }
```
- Put terrain below y=0 so the building sits on y=0: base at e.g. y=-6 with `height` 5 → surface around y=-1.
- Flat building pad + rolling surroundings: a `flat` terrain under the building, then `hills` around it with `mask:"air"` so it doesn't overwrite the pad.
- Shapes: `hills`, `mountain` (castle on a peak), `plateau` (terraced), `island` (floating island with stalactite underside — great for fantasy), `flat`.
- Surface texture: a mix palette, e.g. `"ground_top": {"mix": {"grass_block": 14, "coarse_dirt": 2, "podzol": 1, "moss_block": 1}, "scale": 3}`. Steep slopes already show rock.
- Use the rock gradient on cliffs; put moss and coarse dirt where water would collect.

## Trees
`{"type":"tree","kind":"big_oak","at":[x,0,z],"seed":3}` — kinds: oak, big_oak, birch, spruce, pine, dark_oak, jungle, acacia, cherry, willow, palm, dead, bush, fantasy. Vary `seed` and `height` between copies; mix 2–3 kinds; group them (clusters of 3–5, never a grid). A huge `fantasy` tree is a great focal point for elven/fairy builds. Override `leaves` with a palette mix for colour variation (e.g. oak + azalea).

## Ground cover and flowers
```json
"palette": { "flora": { "mix": { "short_grass": 10, "fern": 2, "poppy": 1, "dandelion": 1, "oxeye_daisy": 1, "cornflower": 1 } } },
…
{ "id":"flora", "type":"scatter", "from":[-20,-3,-20], "to":[60,2,50], "on":["grass_block"], "block":"flora", "density":0.2 }
```
Flowers look best in single-species clusters: several scatters with small regions and one flower each. `tall_grass`, `large_fern`, `rose_bush`, `lilac`, `peony` get their upper half automatically. Bushes: `scatter` with `tree:"bush"` and `spacing` 3.

## Rocks
Make a `rock` component (a small `sphere` or a few boxes of stone/andesite/cobblestone/tuff mixed with mossy tops, sunk 1 into the ground) and scatter it with `spacing` 6–10.

## Paths
On uneven ground, `{"type":"path","points":[[x,z],…],"width":3}` follows the surface (it works on `terrain` too). Otherwise: `box` strips of a path mix 1 block below the grass surface level (paths are slightly lower), widths 2–5, curving (use `line` with `radius` 1–2 through several points, or `polygon`).

## Water
Ponds 1 deep at the edges and 2–4 in the middle (carve with `sphere`/`dome` half `bottom` then fill water with `mask`), banks of sand/clay/gravel/mud, lily pads, `seagrass`, `kelp`. Fountains need a basin ≥5×5. Waterlogged edge blocks: `stone_brick_slab[waterlogged=true]`.
