# Details — walls, openings, towers, interiors, light

Recipes with spec snippets. Coordinates are local: wrap them in a component and `place` them, or in a `group` with `offset`/`rotate`.

## Foundations
- Plinth 1–3 high, proud of the wall by 1, dark stone mix (`cobblestone`, `cobbled_deepslate`, `andesite`, `stone_bricks` + mossy). Cap it with a stairs line facing the wall (water table) or a slab line.
- Sink it 1 below grade and pile coarse dirt / grass / ferns against it. On slopes step it down or let it grow into a retaining wall — never float.

## Walls
- **Timber frame**: posts (`stripped_dark_oak_log`, `axis=y`) at corners and every 3–5 blocks, proud by 1 if the wall is thick enough; floor beams along the wall (`axis=x|z`); braces as `line`s or stairs; light infill inset 0–1.
```json
{ "id":"posts", "type":"group", "repeat":{"count":4,"offset":[4,0,0]}, "operations":[
  {"type":"box","from":[0,1,0],"to":[0,4,0],"block":"frame"} ]},
{ "id":"beam", "type":"line", "from":[0,5,0], "to":[12,5,0], "block":"frame[axis=x]" }
```
- **Jetty**: upper floor 1 block out, sitting on upside-down stairs (corbels) under its beam.
- **String course** at each floor: a slab or stairs line; **quoins**: alternating 1–2-long contrasting blocks on masonry corners.
- **Pilasters/buttresses** every 4–8 blocks on long walls; on stone buildings make buttresses step back with stairs.
- Thin elements: walls blocks, fences, `chain`/`iron_chain`, `end_rod`, `lightning_rod`, iron bars — for mullions, railings, columns.

## Windows (make a component and place it everywhere)
```json
"components": { "window": { "operations": [
  {"type":"box","from":[0,0,0],"to":[1,1,0],"block":"window"},
  {"type":"blocks","block":"spruce_trapdoor[half=top,facing=south]","at":[[0,-1,1],[1,-1,1]]},
  {"type":"blocks","block":"spruce_trapdoor[open=true,facing=south]","at":[[-1,0,1],[-1,1,1],[2,0,1],[2,1,1]]},
  {"type":"blocks","block":"spruce_stairs[half=top,facing=north]","at":[[0,2,1],[1,2,1]]}
]}}
```
Glass (palette key `window`, e.g. a stained glass pane) in the wall plane z=0, sill (closed top trapdoors) and shutters (open trapdoors) one block south, lintel above. For depth, set the glass 1 behind the wall face instead. `place` it with `rotate` for other facades (south-facing component rotated 90 faces west, 180 north, 270 east). Gothic: tall 1–3-wide lancets with `arch` `pointed`; bay windows push out 1–2 on corbels with their own small roof.

## Doors and entrances
The entrance is the focal point: recess it 1–2, add a stoop of stairs, frame it with posts or a stone surround, a small gabled hood on brackets or a lean-to, and a lantern each side. Grand: an `arch` with `cut:true` in a thick wall, double doors (`hinge=left` + `hinge=right`), steps.

## Chimneys
1×1–2×2 of bricks / stone bricks / cobblestone / mud bricks, on a gable end or at the ridge, off the central axis; ≥2 above the ridge; taper with stairs; cap with a slab or wall and a lit `campfire[lit=true]` for smoke (`signal_fire=true` on a hay bale = taller smoke).

## Balconies and porches
Floor of slabs or trapdoors on upside-down-stair corbels; railing of fences, walls blocks, open trapdoors or iron bars; a small roof/awning. Porches: `shed` roof on posts against the wall.

## Arches
`arch` op: `round` for Romanesque/bridges, `pointed` for gothic, `segmental` for bridges/cellars, `flat` for lintels. Hand-made: 3-wide = upside-down stairs in both top corners; 5-wide adds a keystone 1 higher.

## Towers
Good diameters: odd 7, 9, 11, 13, 15, 17, 21, 25 (integer centre, radius 3–12). Wall thickness 1 up to ⌀9, 2 for ⌀11–17. Taper by 1 every 8–12 blocks behind a ring of upside-down stairs. Rise 5–10 above the curtain wall.
Top of a tower — machicolations, parapet, crenels:
```json
{ "id":"tower_top", "type":"script", "args": {"r":6, "y":20}, "code":
  "const {r,y}=args; for (let x=-r-1;x<=r+1;x++) for (let z=-r-1;z<=r+1;z++){ const d=Math.hypot(x,z); if (d>=r+1.5||d<r+0.5) continue; const f=Math.abs(x)>=Math.abs(z)?(x>0?'west':'east'):(z>0?'north':'south'); set(x,y,z,`stone_brick_stairs[half=top,facing=${f}]`); set(x,y+1,z,'wall'); if ((Math.round(Math.atan2(z,x)*r))%2===0) set(x,y+2,z,'wall'); }" }
```
Arrow slits 1×2–3 carved with `air`. Turrets (⌀3–7) corbelled out from wall corners on stairs.

## Fortifications
Curtain walls 3–5 thick, 10–20 high, wall-walk 2–3 wide, crenels 2-on/1-off; battered base (2–3 rows of stairs); buttresses every 8–10; towers every 15–30 projecting ~half their diameter. Gatehouse: two flanking towers, a 3–4 × 4–5 arch, `iron_bars` portcullis, a murder-hole slot above.

## Bridges
Stone: piers every 7–15 with pointed cutwaters upstream, `segmental` arches, walls-block parapets, lamps on the piers. Rope: slab deck, fences/chains as rails, slight sag (`line` points).

## Paths and roads
Alleys 2–3, streets 4–5, main roads 7–11. Rural: `dirt_path`/`coarse_dirt`/`gravel`/`packed_mud` mix with ragged grassy edges (scatter or a mix with `grass_block`). Urban: `cobblestone`/`stone_bricks`/`andesite`/`polished_andesite` with 10–20% wear and slab kerbs. Never dead-straight uniform strips.

## Lighting (moody, purposeful)
Hostile mobs only spawn at block light 0 (1.18+), so light lightly. Visible: `lantern[hanging=true]` under eaves or on chains, `soul_lantern` for cold/magic, candles on tables, `end_rod`, copper bulbs (1.21+). Hidden: `glowstone`, `shroomlight`, `*_froglight`, `sea_lantern` under carpet/moss carpet, behind leaves, in ceilings; `light[level=N]` is invisible.

## Interiors (only when visible or requested)
- Table: fence + pressure plate/carpet, or top slabs on fences. Chair: stairs (back away from the table) with signs/trapdoors as arms. Sofa: stairs row capped with trapdoors.
- Shelves: `bookshelf`, `chiseled_bookshelf`, barrels, upside-down stairs, trapdoors. Counter: barrels/planks with trapdoor fronts and a `smooth_stone_slab` top. Kitchen: smoker under an upside-down-stair hood. Fireplace: bricks + campfire.
- Ceilings: beams of stripped logs every 3–4 with upside-down-stair knee braces; chandeliers of chain + fences + lanterns/candles. Floors bordered with stripped logs or `*_wood`, carpet rugs.
- Avoid entities (item frames, paintings, armor stands): schematics here are blocks only.
