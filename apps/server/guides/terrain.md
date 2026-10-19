# Terrain — building on the player's world

Use this when the player wants a build **in their own world** ("costruiscimi un castello qui", "at 120 70 -340, radius 60", "where I'm standing", "on this schematic"): you read that piece of the world, build on its real ground, and hand it back at the same coordinates — as a copy of their world, a vanilla data pack, or a schematic.

## 1. Import the site

- `worlds` lists their Minecraft Java worlds (official launcher, Prism, MultiMC, CurseForge, Modrinth) with version, last played and where the player stands. Pick the one they mean; if they give a folder path, `import_site` takes it too.
- `import_site({world, center?, radius?})`: `center` is `[x, z]` (or `[x, y, z]`) in **world** coordinates, default where the player stands; `radius` is the half-size of the square area (default 48, max 128). Take the build's footprint plus 15–25 blocks around it for blending and landscaping.
- A schematic as the base: `import_site({file:"/path/base.schem"})` (.schem, .schematic, .litematic, .nbt). The player can also import from the viewer (Import button, or drop the file on it).
- The world is only read. Ask the player to **Save and Quit** first, so the area is on disk as they last saw it.
- It opens a new project whose spec has `"site": {"id": …}` and the site's `minecraftVersion` (keep both). Build with `edit_build` ({op:"add"}), or `create_build` with a full spec that keeps `site`.

## 2. Read the ground

- **Coordinates are relative to the chosen point**: BuildSpec (0,0,0) is the block above the ground there; `world = spec + origin` (the report prints the origin). Talk to the player in world coordinates.
- The `terrain` report (also returned by `import_site`): height map with the spec y of the **top ground block** of each column (so a building on it starts one higher), `~` water, `T` trees, flattest open spots, existing player builds ("not natural") and the site's bounds — blocks outside them are dropped.
- Zoom with `terrain({from, to, step: 1})`; exact blocks with `inspect`; looks with `render_views` (`top` for layout). In the viewer the player can press **C** to see only what you changed.

## 3. Shape the ground

"Ground" means the site's natural ground plus what `terrain`, `flatten` and `path` make; buildings, trees, plants and water are not ground.

**flatten** levels a plot and blends it into the slope around it (digging or filling with the area's own blocks, clearing trees and plants on the plot):

```json
{
  "id": "plot",
  "type": "flatten",
  "from": [-12, 0, -10],
  "to": [12, 0, 10],
  "level": 0,
  "blend": 5
}
```

`level` is where you build (the ground's top ends at level − 1; default the plot's median). `shape: "circle"` for round plazas; `surface`/`subsurface`/`core` override the materials; `clear: false` keeps what stands on it.

**foundation** fills under a footprint down into the ground, so nothing floats on a slope — solid, or `pillars` (corners and every `spacing` blocks: stilts, piers, docks):

```json
{
  "id": "base",
  "type": "foundation",
  "from": [-8, -1, -6],
  "to": [8, -1, 6],
  "block": "cobblestone",
  "depth": 2
}
```

**path** follows the ground between `[x, z]` points, replacing its top block (dirt_path by default) and the grass on it; it skips water:

```json
{
  "id": "road",
  "type": "path",
  "points": [
    [0, 8],
    [10, 20],
    [26, 31]
  ],
  "width": 3,
  "edge": "coarse_dirt"
}
```

**ground: true** on `tree`, `place` and `blocks` measures `y` from the ground under each position (0 = standing on it), for every copy of a `repeat`:

```json
{
  "id": "lamps",
  "type": "place",
  "component": "lamp_post",
  "at": [4, 0, 12],
  "ground": true,
  "repeat": { "count": 5, "offset": [6, 0, 4] }
}
```

```json
{ "id": "big_oak", "type": "tree", "kind": "big_oak", "at": [-20, 0, 14], "ground": true }
```

**Scripts** get `ground(x, z)` (top ground block, or null), `surface(x, z)` (top block of any kind), `water(x, z)` (water surface above the ground, or null) in the script's local coordinates, and `SITE.min` / `SITE.max` (spec bounds):

```json
{
  "id": "fence_line",
  "type": "script",
  "code": "for (let x = -20; x <= 20; x++) { const g = ground(x, -18); if (g !== null && water(x, -18) === null) set(x, g + 1, -18, 'oak_fence'); }"
}
```

`scatter` works on the site's surface too (it looks through grass and flowers).

## 4. Design for the place

- **Read the land first**: put the main building on a flat spot or a terrace you cut into the slope; on steep ground prefer a foundation or stilts over flattening half a hill. Keep `blend` ≥ 4 so cuts and fills look natural.
- **Keep what's there**: don't clear more trees than the build needs, keep the player's existing builds unless they ask, follow the coastline and the contour lines with walls and roads.
- **Orient to the site**: entrances toward paths and views, gardens on the sunny/open side, docks and bridges where `~` water is.
- Check the edges of every flatten in a render (no cliffs of dirt, no floating trees) and fix with a wider blend or a foundation.

## 5. Give it back

Say which of these fits; all use the site's real coordinates.

- **A copy of their world with the build** — `export_build({format: "world"})`: a new world next to the original in their saves ("World (VibeSchem v3)"), the original untouched. Single player, Minecraft 1.14+, every chunk of the area generated. Light is recomputed when the area loads.
- **Vanilla data pack**, no mods — `export_build({format: "datapack", saveTo: "world"})` installs it in the site's world (or the .zip for a server's world). In the game, with cheats: `/reload`, then `/function vibeschem:<id>/build`; `…/undo` puts back exactly what was there; `…/tp` takes them to it. It builds over a few ticks, force-loading the chunks.
- **Schematics** hold only the changed area and remember where it goes: WorldEdit `//schem load <name>` then `//paste -o`; Litematica: put the placement's origin at the world position the export prints, paste with "Replace: All"; `.nbt` holds only the changed blocks for `/place template`.
- The material list counts only the blocks the build places.
- Without a site, the data pack builds where the player stands (like `//paste`) and `…/undo` removes it.
