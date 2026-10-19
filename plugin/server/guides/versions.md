# Minecraft versions

`minecraftVersion` is strict: a block that doesn't exist in that release is an error (with the release it was added in and the closest alternatives). Experimental blocks that were behind a toggle (cherry in 1.19.4, crafter in 1.20.3, pale oak in 1.21.2) count as not existing. `list_blocks({names:[…]})` checks a list, `list_blocks({query:"stairs"})` searches, `list_blocks({versions:true})` lists every supported release (1.8 → newest).

Always write modern ids; renamed blocks are mapped automatically (`grass`↔`short_grass` 1.20.3, `grass_path`↔`dirt_path` 1.17, `sign`↔`oak_sign` 1.14, `chain`↔`iron_chain` 1.21.9).

## When blocks arrived
| Version | Notable building blocks |
|---|---|
| 1.8 | granite/diorite/andesite (+polished), prismarine set, sea lantern, red sandstone, slime, wood-specific fences/gates/doors (oak…dark oak), iron trapdoor, banners |
| 1.9 | purpur set, end rod, end stone bricks, grass path, chorus |
| 1.10 | magma, nether wart block, red nether bricks, bone block |
| 1.11 | observer, shulker boxes |
| 1.12 | concrete, concrete powder, glazed terracotta, coloured beds |
| 1.13 | stripped logs and wood, wood-specific trapdoors/buttons/pressure plates, prismarine stairs/slabs, coral, kelp, sea pickle, blue ice, plain shulker box |
| 1.14 | stone/granite/andesite/diorite/sandstone… stairs, slabs and walls; brick/stone brick walls; lantern, barrel, smoker, blast furnace, bell, campfire, scaffolding, grindstone, composter, lectern; per-wood signs. `stone_slab` before 1.14 = smooth stone slab |
| 1.15 | bee nest, beehive, honey and honeycomb blocks |
| 1.16 | blackstone set, basalt, crimson/warped woods, nether gold ore, chain, soul lantern/torch, target, respawn anchor, lodestone |
| 1.17 | deepslate sets, tuff, calcite, dripstone, copper (cut, stairs, oxidation, waxed), moss, azalea, amethyst, candles, tinted glass, glow lichen, rooted dirt, lightning rod, powder snow |
| 1.19 | mud, packed mud, mud bricks, mangrove, sculk, froglights |
| 1.20 | cherry, bamboo wood + mosaic, chiseled bookshelf, hanging signs, suspicious sand/gravel, pink petals, decorated pot |
| 1.21 | tuff stairs/slabs/walls + polished/bricks/chiseled tuff, chiseled copper, copper grate/bulb/door/trapdoor, crafter, trial spawner, vault, heavy core |
| 1.21.4 | pale oak set, pale moss, resin and resin bricks, creaking heart |
| 1.21.5 | leaf litter, wildflowers, bush, firefly bush, cactus flower, dry grass |
| 1.21.6 | dried ghast |
| 1.21.9 | copper lantern/torch/bars/chain, shelves, copper golem statue; `chain` → `iron_chain` |
| 26.2 | cinnabar and sulfur stone sets |
| 26.3 | concrete and wool stairs and slabs |

## Substitutes for older versions
| Missing | Use |
|---|---|
| deepslate bricks/tiles | stone bricks, `cobblestone`, gray wool (≤1.16), `polished_andesite` (1.8+) |
| tuff, tuff bricks | andesite, stone bricks |
| calcite | `diorite`, `quartz_block`, white wool |
| mud bricks / packed mud | brown/terracotta, granite, `bricks` |
| cherry | birch + pink terracotta / pink wool |
| stripped logs (≤1.12) | planks or bark logs |
| lantern (≤1.13) | glowstone, sea lantern, torches on fences |
| concrete (≤1.11) | wool, stained terracotta (`white_terracotta` = stained hardened clay), `quartz_block`, `snow_block` |
| stone/andesite stairs & slabs & walls (≤1.13) | cobblestone/stone brick stairs, smooth stone slab, cobblestone wall |
| copper | terracotta (orange/cyan), prismarine |
| moss block | `mossy_cobblestone`, leaves, `grass_block` |
| chain (≤1.15) | iron bars, fences |

## Export by version
- 1.8–1.12: MCEdit `.schematic` (WorldEdit 6). Block states are converted to numeric ids automatically.
- 1.13+: Sponge `.schem` v2 (any WorldEdit 7 / FAWE), v3 for WorldEdit 7.3+ (1.20.4+), `.litematic`, structure `.nbt`, and a vanilla data pack (`/function`, no mods; the pack format and folder names follow the version).
- 1.14+, builds on a site from a world: a copy of that world with the build in it.
- Newer releases than the bundled data (e.g. 26.2, 26.3) get their extra blocks from the game files when the textures load.
