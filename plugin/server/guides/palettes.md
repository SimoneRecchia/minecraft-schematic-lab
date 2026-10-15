# Palettes

Define materials as palette keys with clumped mixes (`scale` 2–4). Order every gradient dark → light.

## Proven sequences (dark → light)
| Use | Sequence |
|---|---|
| Rock | `blackstone` → `cobbled_deepslate` → `tuff` → `andesite` → `stone` → `diorite` → `calcite` |
| Wood | `dark_oak_planks` → `spruce_planks` → `oak_planks` → `birch_planks` |
| Masonry | `mossy_cobblestone`+`cobblestone` → `andesite` → `stone_bricks` (+15% `cracked_stone_bricks`) |
| Desert | `packed_mud` → `smooth_sandstone` → `sandstone` → `cut_sandstone` → `birch_planks` |
| Copper roof | `waxed_cut_copper` → `waxed_exposed_` → `waxed_weathered_` → `waxed_oxidized_cut_copper` |
| Terrain | `stone` → `andesite` → `gravel` → `coarse_dirt` → `podzol`/`rooted_dirt` → `grass_block` (+`moss_block`) |
| Snow line | `stone` → `andesite` → `diorite` → `calcite` → `snow_block` |

## Named palettes (minimum version)
| Palette | Blocks and roles | Min |
|---|---|---|
| Warm Timber | frame `stripped_dark_oak_log`; infill `white_terracotta`/`calcite`; base `cobblestone`+`andesite`; roof `spruce_stairs`; shutters `spruce_trapdoor` | 1.13 (calcite 1.17) |
| Weathered Stone | `stone_bricks` 55, `cracked_stone_bricks` 15, `mossy_stone_bricks` 15, `andesite`/`cobblestone` 15; trim `polished_andesite`, `smooth_stone_slab` | 1.14 |
| Deepslate Gothic | walls `deepslate_bricks`; base `cobbled_deepslate`; trim `polished_deepslate`, `chiseled_deepslate`; contrast `tuff_bricks`; roof `deepslate_tile_stairs`; `soul_lantern` | 1.17 / tuff bricks 1.21 |
| Nordic Dark Wood | `spruce_log`, `stripped_spruce_log`, `dark_oak_planks`, `spruce_planks`; base `cobbled_deepslate`; roof `dark_oak_stairs` + `moss_block` | 1.17 |
| Sandstone Oasis | `smooth_sandstone`, `sandstone`, `cut_sandstone`, `chiseled_sandstone`; beams `stripped_jungle_log`; tiles `cyan_terracotta` | 1.13 |
| Adobe Pueblo | `mud_bricks`, `packed_mud`, `terracotta`; vigas `stripped_jungle_log` poking out of walls | 1.19 |
| Mediterranean White | `white_concrete`/`calcite`/`smooth_quartz`; roof `granite_stairs`/`brick_stairs`; shutters `warped_trapdoor` | 1.16 |
| Verdigris Copper | four oxidation stages of `waxed_*_cut_copper(_stairs)` mixed 40/30/20/10 on roofs and domes | 1.17 |
| Cherry Garden | `cherry_log`, `stripped_cherry_log`, `cherry_planks`, `cherry_leaves`, `pink_petals`; `calcite` walls | 1.20 |
| Pale Grove | `pale_oak_log`, `pale_oak_planks`, `pale_moss_block`, `pale_hanging_moss`; `resin_bricks` accent | 1.21.4 |
| Blackstone Fortress | `polished_blackstone_bricks`, `blackstone`, `cracked_polished_blackstone_bricks`, `gilded_blackstone`; `basalt` columns; crimson wood | 1.16 |
| Brick Townhouse | `bricks` + `granite` flecks; trim `smooth_stone`/`polished_andesite`; roof `deepslate_tile_stairs`; dark oak windows | 1.17 |
| Elven Moonstone | `calcite`, `diorite`, `stripped_birch_log`, `birch_planks`; `amethyst_block`; roof `oxidized_cut_copper_stairs` | 1.17 |
| Industrial Steampunk | `bricks`, cut copper variants, `iron_bars`, `chain`, `copper_grate`, `polished_blackstone`, dark oak | 1.21 |
| Clean Modern | `white_concrete`, `light_gray_concrete`, `smooth_stone`, `stripped_oak_log`, `tinted_glass`, `sea_lantern` | 1.17 |
| Ruin Overgrowth | `mossy_stone_bricks`, `cracked_stone_bricks`, `mossy_cobblestone`, `moss_block`, `moss_carpet`, `vine`, `azalea_leaves` | 1.17 |
| Dwarven Forge | `deepslate_tiles`, `polished_deepslate`, `gold_block`, `raw_gold_block`, `magma_block`, `polished_basalt`, `lava` behind `iron_bars` | 1.17 |
| Thatch Cottage | `oak_log`, `oak_planks`, `cobblestone`, `mossy_cobblestone`, `hay_block` + `bamboo_mosaic_stairs` thatch | 1.20 |
| Cinnabar & Sulfur | red and yellow stone sets (stairs, slabs, walls, polished, bricks, chiseled) | 26.2 |
| Concrete & wool stairs | concrete and wool stairs/slabs for clean modern and soft fantasy roofs | 26.3 |

## Example palette block
```json
"palette": {
  "base":   { "mix": { "cobblestone": 5, "mossy_cobblestone": 3, "andesite": 2 }, "scale": 2 },
  "wall":   { "mix": { "white_terracotta": 6, "calcite": 3, "smooth_sandstone": 1 }, "scale": 3 },
  "frame":  "stripped_dark_oak_log",
  "planks": "spruce_planks",
  "roof":   { "mix": { "dark_oak_stairs": 4, "spruce_stairs": 1 }, "scale": 3 },
  "trim":   "spruce_stairs",
  "accent": "red_wool",
  "window": "gray_stained_glass_pane"
}
```
Dark stained glass panes (`gray_`, `brown_`, `black_stained_glass_pane`) read better than clear glass on old styles; tinted or light-blue glass for modern/sci-fi.
