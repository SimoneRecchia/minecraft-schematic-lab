# Roofs

A roof decides whether a build looks amateur or expert. Make it big, thick, overhanging and well finished.

## The roof operation
```json
{ "id":"main_roof", "type":"roof", "shape":"gable", "from":[0,7,0], "to":[10,7,14],
  "block":"roof", "pitch":1, "overhang":1, "gable":"wall_planks", "eaves":"dark_oak_stairs", "ridge":"dark_oak_slab" }
```
- from/to x,z = the **outer faces of the walls**; from[1] = **wall top + 1**. The roof rests on the walls; the overhang row sits one lower, just outside the walls.
- Width across the slope: odd → single ridge row (slab cap); even → two stairs back to back.
- `gable`: closes the triangular end walls — use the wall material or a contrasting plank for timber styles.
- `eaves`: upside-down stairs tucked under the overhang (the soffit shadow). Almost always add it.
- `fill`: solid mass under the slopes (needed when the roof is open below and you want no attic).

## Pitch
| pitch | look | use |
|---|---|---|
| 0.5 | shallow 27°, slab-stair rhythm | Mediterranean, modern villas, sheds, Japanese upper hip |
| 1 | classic 45° | most houses |
| 1.5–2 | steep 63° | medieval, Nordic, gothic, fantasy |
| 3–4 | spire | towers (cone), church steeples |

`profile` = rise of each row from the eave inward, for curves:
- **Bell / East-Asian / pagoda** (concave): `[0.5, 0.5, 1, 1, 1.5, 2, 2]` with `overhang: 2–3`.
- **Gambrel (barn)**: `[2, 2, 2, 1, 0.5]`.
- **Mansard** (big buildings only): `[3, 3, 3, 0.5, 0.5]` + dormers in the steep part.
- **Fantasy swoop**: `[0.5, 1, 1, 2, 2, 3, 3]`.

## Shapes and when to use them
- **gable**: houses, halls, longhouses. Ridge along the long side (`axis` defaults to it).
- **hip**: manors, pavilions, Japanese/Chinese halls, towers with square plans (pyramid when square).
- **shed**: lean-tos, porches, sheds against a taller wall (`rise` toward the wall).
- **flat**: modern, desert, castle towers/curtain walls — add a parapet (wall ring) and crenels.
- **cone**: round towers. `{"shape":"cone","center":[cx, top+1, cz],"radius":R,"pitch":2.5,"overhang":1,"ridge":"lightning_rod"}` — the radius is the wall circle's radius; overhang flares it out. Witch-hat: steep `profile` ending in a 1-block spire, or offset the top rings with a script.
- **dome**: `{"type":"dome","center":[cx,y,cz],"radius":R,"hollow":true}` on a windowed drum; ribs with 4–8 `line`s of a contrasting block; a lantern cupola on top.

## Composite roofs
- **Cross-gable / L / T plans**: one roof per wing. Order: smaller wing first, main wing last (its slopes overwrite and form a clean valley). If the smaller ridge sticks through the main slope, lower it (smaller wings should have ridges ≥2 below the main ridge).
- **Dormers**: a small gable roof (3 or 5 wide) on a box that pokes out of the main slope, every 3–5 blocks, ridge ≥2 below the main ridge. Build the dormer box after the main roof, carve the window, then its own `roof` with `overhang:0` or 1.
- **Hip + gable (irimoya)**: hip roof, then a small gable at the top ends.
- **Tiered pagoda**: stacked hip roofs with `profile` curves, each tier 2 narrower and 4–6 higher, deep overhangs (2–3).

## Finishing
- Overhang ≥1 on every edge, 2–3 on big, Nordic or Asian roofs; support overhangs ≥2 with brackets (fence + upside-down stairs, logs).
- Ridge: slab cap, log ridge beam (`ridge:"stripped_spruce_log"` gets `axis` along the ridge), or walls blocks; finials at the ends (walls block + `lightning_rod`/`end_rod`/lantern).
- Roof texture: mix a related stair 15–25% (`dark_oak_stairs` + `spruce_stairs`; `deepslate_tile_stairs` + `cobbled_deepslate_stairs`), darker/mossier near the eaves (`replace` with `chance` on the lowest 2 rows).
- Thatch: `hay_block` body with `bamboo_mosaic_stairs`/`birch_stairs`, 2 layers thick (`fill`), eyebrow dormers.
- Copper: waxed cut copper stairs in 3–4 oxidation stages mixed 40/30/20/10.
- Chimneys pierce the roof: build them after the roof, ≥2 blocks above the ridge, capped with a slab/wall and a lit `campfire` for smoke.
