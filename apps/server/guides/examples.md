# Worked examples

Complete specs that compile as-is. Read them for structure and idioms, not as templates to copy: every build should be designed for its own brief.

## 1. Timber-framed cottage (small, 30×17×27)
Plinth + framed walls + shuttered windows mirrored to both long sides with `symmetry`, a mixed dark-oak gable roof with eaves and gable ends, an outside chimney with a campfire, a path, two trees and scattered flowers on a flat terrain patch.

```json
{
  "name": "Medieval Cottage",
  "minecraftVersion": "1.21.4",
  "metadata": {"style":"medieval","prompt":"a cozy timber-framed cottage with a dark oak roof"},
  "palette": {
    "plinth": {"mix":{"cobblestone":6,"mossy_cobblestone":2,"andesite":1},"scale":2},
    "infill": {"mix":{"white_terracotta":5,"calcite":2},"scale":2},
    "post": "stripped_spruce_log",
    "roof": {"mix":{"dark_oak_stairs":4,"spruce_stairs":1},"scale":3},
    "flowers": {"mix":{"short_grass":8,"poppy":1,"dandelion":1,"oxeye_daisy":1,"cornflower":1,"fern":2}}
  },
  "operations": [
    {"id":"ground","type":"terrain","from":[-8,-3,-8],"to":[18,-3,15],"shape":"flat","height":2,"edgeFalloff":false},
    {"id":"path","type":"box","from":[4,-1,7],"to":[6,-1,15],"block":"dirt_path"},
    {"id":"plinth","type":"box","from":[0,0,0],"to":[10,0,6],"block":"plinth"},
    {"id":"walls","type":"box","from":[0,1,0],"to":[10,4,6],"block":"infill","walls":true},
    {"id":"frame","type":"group", "operations": [
      {"type":"blocks","block":"post","at":[[0,1,0],[0,2,0],[0,3,0],[10,1,0],[10,2,0],[10,3,0],[0,1,6],[0,2,6],[0,3,6],[10,1,6],[10,2,6],[10,3,6],[5,1,0],[5,2,0],[5,3,0]]},
      {"type":"line","from":[0,4,0],"to":[10,4,0],"block":"post[axis=x]"},
      {"type":"line","from":[0,4,6],"to":[10,4,6],"block":"post[axis=x]"},
      {"type":"line","from":[0,4,0],"to":[0,4,6],"block":"post[axis=z]"},
      {"type":"line","from":[10,4,0],"to":[10,4,6],"block":"post[axis=z]"}
    ]},
    {"id":"windows","type":"group","symmetry":{"z":3}, "operations": [
      {"type":"box","from":[2,2,6],"to":[3,3,6],"block":"glass_pane"},
      {"type":"box","from":[7,2,6],"to":[8,3,6],"block":"glass_pane"},
      {"type":"blocks","block":"spruce_trapdoor[open=true,facing=south,half=top]","at":[[1,2,7],[1,3,7],[4,2,7],[4,3,7],[6,2,7],[6,3,7],[9,2,7],[9,3,7]]},
      {"type":"blocks","block":"spruce_trapdoor[facing=north,half=top]","at":[[2,1,7],[3,1,7],[7,1,7],[8,1,7]]}
    ]},
    {"id":"door","type":"blocks","block":"spruce_door[facing=north]","at":[[5,1,6]]},
    {"id":"roof","type":"roof","shape":"gable","from":[0,5,0],"to":[10,5,6],"block":"roof","overhang":1,"gable":"spruce_planks","eaves":"spruce_stairs"},
    {"id":"chimney","type":"box","from":[11,0,2],"to":[12,10,3],"block":"bricks"},
    {"id":"chimney_cap","type":"blocks","block":"campfire[lit=true,signal_fire=false]","at":[[11,11,2]]},
    {"id":"tree_west","type":"tree","kind":"oak","at":[-5,0,10],"seed":4},
    {"id":"tree_east","type":"tree","kind":"big_oak","at":[15,0,-4],"seed":9},
    {"id":"flowers","type":"scatter","from":[-8,-1,-8],"to":[18,0,15],"on":["grass_block"],"block":"flowers","density":0.18}
  ]
}
```

## 2. Round watchtower (small, scripts + cone roof)
Battered plinth, hollow shaft, arrow slits carved with `symmetry`, a script for machicolations and crenels, a steep cone roof with a lightning-rod finial.

```json
{
  "name": "Stone Watchtower",
  "minecraftVersion": "1.21.4",
  "metadata": {"style":"medieval"},
  "palette": {
    "masonry": {"mix":{"stone_bricks":6,"cracked_stone_bricks":2,"mossy_stone_bricks":1,"andesite":1},"scale":2},
    "base": {"mix":{"cobblestone":3,"mossy_cobblestone":2,"cobbled_deepslate":1},"scale":2}
  },
  "operations": [
    {"id":"plinth","type":"cylinder","center":[0,0,0],"radius":5,"height":2,"block":"base"},
    {"id":"shaft","type":"cylinder","center":[0,2,0],"radius":4,"height":14,"block":"masonry","hollow":true},
    {"id":"slits","type":"group","repeat":{"count":1,"offset":[0,0,0]},"symmetry":{"x":0,"z":0}, "operations": [
      {"type":"box","from":[0,6,-4],"to":[0,8,-4],"block":"air"},
      {"type":"box","from":[-4,11,0],"to":[-4,13,0],"block":"air"}
    ]},
    {"id":"machicolations","type":"script","code":"const r = 5;\nfor (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {\n  const d = Math.hypot(x, z);\n  if (d >= r + 0.5 || d < r - 0.5) continue;\n  const facing = Math.abs(x) >= Math.abs(z) ? (x > 0 ? \"west\" : \"east\") : (z > 0 ? \"north\" : \"south\");\n  set(x, 15, z, `stone_brick_stairs[half=top,facing=${facing}]`);\n  set(x, 16, z, \"masonry\");\n  if ((x + z) % 2 === 0) set(x, 17, z, \"masonry\");\n}"},
    {"id":"floor","type":"cylinder","center":[0,16,0],"radius":4,"height":1,"block":"spruce_planks"},
    {"id":"roof","type":"roof","shape":"cone","center":[0,18,0],"radius":3,"block":"deepslate_tile_stairs","pitch":2,"overhang":1,"ridge":"lightning_rod"}
  ]
}
```

## 3. Fantasy castle on a floating island (large, ~90³, components)
A `tower` component (battered base, banded shaft, slits, corbelled gallery, witch-hat cone roof with a curved `profile`) placed in all four corners with one `place` + `symmetry`; curtain walls 3 thick with a script for crenels; a gatehouse with an arch, portcullis and banners; a keep with buttresses (`repeat`), arched windows, string courses and a hip roof; a tall spire tower; a reusable `house` component placed twice with `rotate`; a well; weathering with `replace`; an `island` terrain with trees, bushes and flowers.

```json
{
  "name": "Castello di Nuvolaria",
  "description": "Fantasy castle on a floating island: four witch-hat towers, a keep with a tall spire, gatehouse, courtyard houses.",
  "minecraftVersion": "1.21.4",
  "seed": 11,
  "palette": {
    "masonry": {"mix":{"stone_bricks":7,"cracked_stone_bricks":2,"mossy_stone_bricks":1,"andesite":1},"scale":3},
    "base": {"mix":{"cobblestone":4,"mossy_cobblestone":3,"cobbled_deepslate":2},"scale":2},
    "trim": "polished_andesite",
    "trim_stairs": "stone_brick_stairs",
    "roof": {"mix":{"dark_prismarine_stairs":5,"prismarine_brick_stairs":2},"scale":3},
    "wood": "spruce_planks",
    "frame": "stripped_dark_oak_log",
    "plaster": {"mix":{"white_terracotta":5,"calcite":2},"scale":2},
    "house_roof": {"mix":{"dark_oak_stairs":4,"spruce_stairs":1},"scale":3},
    "window": "gray_stained_glass_pane",
    "ground": {"mix":{"grass_block":14,"coarse_dirt":2,"podzol":1,"moss_block":2},"scale":3},
    "court": {"mix":{"cobblestone":3,"gravel":1,"andesite":2,"stone":1},"scale":2},
    "flora": {"mix":{"short_grass":10,"fern":3,"poppy":1,"dandelion":1,"azure_bluet":1,"cornflower":1}}
  },
  "components": {
    "tower": { "description": "Round tower, local origin = centre of the base; witch-hat roof", "operations": [
      {"id":"batter","type":"cylinder","center":[0,0,0],"radius":8,"radiusTop":6,"height":4,"block":"base"},
      {"id":"shaft","type":"cylinder","center":[0,4,0],"radius":6,"height":17,"block":"masonry","hollow":true},
      {"id":"band","type":"cylinder","center":[0,12,0],"radius":6,"height":1,"block":"trim","hollow":true},
      {"id":"slits","type":"group","symmetry":{"x":0,"z":0}, "operations": [
        {"type":"box","from":[0,7,-6],"to":[0,9,-6],"block":"air"},
        {"type":"box","from":[-6,14,0],"to":[-6,16,0],"block":"air"}
      ]},
      {"id":"corbels","type":"script","args":{"r":7,"y":21},"code":"const {r,y}=args; for (let x=-r;x<=r;x++) for (let z=-r;z<=r;z++){ const d=Math.hypot(x,z); if (d>=r+0.5||d<r-0.5) continue; const f=Math.abs(x)>=Math.abs(z)?(x>0?'west':'east'):(z>0?'north':'south'); set(x,y,z,`trim_stairs[half=top,facing=${f}]`); }"},
      {"id":"gallery","type":"cylinder","center":[0,22,0],"radius":7,"height":4,"block":"masonry","hollow":true},
      {"id":"gallery_windows","type":"group","symmetry":{"x":0,"z":0}, "operations": [
        {"type":"box","from":[-1,23,-7],"to":[1,24,-7],"block":"window"},
        {"type":"box","from":[-7,23,-1],"to":[-7,24,1],"block":"window"}
      ]},
      {"id":"gallery_floor","type":"cylinder","center":[0,21,0],"radius":6,"height":1,"block":"wood"},
      {"id":"roof","type":"roof","shape":"cone","center":[0,26,0],"radius":7,"block":"roof","profile":[1,1,1.5,2,2,3,3,4],"overhang":1,"ridge":"lightning_rod"}
    ]},
    "house": { "description": "Timber house against a wall, 9x7, door facing south", "operations": [
      {"type":"box","from":[0,0,0],"to":[8,0,6],"block":"base"},
      {"type":"box","from":[0,1,0],"to":[8,3,6],"block":"plaster","walls":true},
      {"type":"box","from":[0,1,0],"to":[0,3,0],"block":"frame"},
      {"type":"box","from":[8,1,0],"to":[8,3,0],"block":"frame"},
      {"type":"box","from":[0,1,6],"to":[0,3,6],"block":"frame"},
      {"type":"box","from":[8,1,6],"to":[8,3,6],"block":"frame"},
      {"type":"line","from":[0,4,6],"to":[8,4,6],"block":"frame[axis=x]"},
      {"type":"line","from":[0,4,0],"to":[8,4,0],"block":"frame[axis=x]"},
      {"type":"box","from":[-1,5,-1],"to":[9,5,7],"block":"wood","mask":"air"},
      {"type":"box","from":[-1,5,-1],"to":[9,8,7],"block":"plaster","walls":true,"mask":"air"},
      {"type":"roof","shape":"gable","axis":"x","from":[-1,9,-1],"to":[9,9,7],"block":"house_roof","pitch":1.5,"overhang":1,"gable":"plaster","eaves":"spruce_stairs"},
      {"type":"blocks","block":"trim_stairs[half=top,facing=north]","at":[[1,4,7],[3,4,7],[5,4,7],[7,4,7]]},
      {"type":"blocks","block":"spruce_door[facing=north]","at":[[4,1,6]]},
      {"type":"box","from":[1,2,6],"to":[2,3,6],"block":"window"},
      {"type":"box","from":[6,2,6],"to":[7,3,6],"block":"window"},
      {"type":"box","from":[2,6,7],"to":[3,7,7],"block":"window"},
      {"type":"box","from":[5,6,7],"to":[6,7,7],"block":"window"},
      {"type":"blocks","block":"spruce_trapdoor[open=true,facing=south]","at":[[0,2,7],[0,3,7],[3,2,7],[3,3,7],[5,2,7],[5,3,7],[8,2,7],[8,3,7]]},
      {"type":"blocks","block":"lantern[hanging=true]","at":[[4,4,8]]},
      {"type":"box","from":[6,5,2],"to":[7,13,3],"block":"bricks"},
      {"type":"blocks","block":"campfire[lit=true]","at":[[6,14,2]]}
    ]}
  },
  "operations": [
    {"id":"island","type":"terrain","shape":"island","from":[-44,-3,-44],"to":[44,-3,44],"height":2,"amplitude":2,"surface":"ground","subsurface":"dirt","core":"stone","seed":5},
    {"id":"mound","type":"cylinder","center":[0,-3,0],"radius":27,"height":3,"block":"base"},
    {"id":"courtyard","type":"box","from":[-18,0,-18],"to":[18,0,18],"block":"court"},
    {"id":"curtain","type":"box","from":[-20,1,-20],"to":[20,12,20],"block":"masonry","walls":true,"thickness":3},
    {"id":"curtain_base","type":"box","from":[-21,0,-21],"to":[21,2,21],"block":"base","walls":true,"thickness":1},
    {"id":"walk","type":"box","from":[-19,12,-19],"to":[19,12,19],"block":"trim","walls":true,"thickness":2},
    {"id":"crenels","type":"script","code":"for (let i=-20;i<=20;i++){ const on=(i+20)%3!==2; if(!on) continue; for (const [x,z] of [[i,-20],[i,20],[-20,i],[20,i]]) { set(x,13,z,'masonry'); set(x,14,z,'stone_brick_wall'); } }"},
    {"id":"corner_towers","type":"place","component":"tower","at":[20,0,20],"symmetry":{"x":0,"z":0}},
    {"id":"gatehouse","type":"group", "operations": [
      {"type":"box","from":[-8,0,17],"to":[-3,18,23],"block":"masonry"},
      {"type":"box","from":[3,0,17],"to":[8,18,23],"block":"masonry"},
      {"type":"box","from":[-3,12,18],"to":[3,18,22],"block":"masonry"},
      {"type":"box","from":[-2,1,17],"to":[2,9,23],"block":"air"},
      {"type":"arch","from":[-3,9,17],"to":[3,12,23],"block":"trim","style":"round","rise":3,"fill":"stone"},
      {"type":"box","from":[-2,4,23],"to":[2,9,23],"block":"iron_bars"},
      {"type":"box","from":[-9,18,16],"to":[9,18,24],"block":"trim"},
      {"type":"script","code":"for (let x=-9;x<=9;x++) for (const z of [16,24]) if ((x+9)%2===0) set(x,19,z,'masonry'); for (let z=16;z<=24;z++) for (const x of [-9,9]) if ((z-16)%2===0) set(x,19,z,'masonry');"},
      {"type":"blocks","block":"red_wall_banner[facing=south]","at":[[-5,15,24],[5,15,24]]},
      {"type":"blocks","block":"lantern","at":[[-3,8,24],[3,8,24]]}
    ]},
    {"id":"keep","type":"group", "operations": [
      {"type":"box","from":[-11,0,-16],"to":[11,2,2],"block":"base"},
      {"type":"box","from":[-10,3,-15],"to":[10,22,1],"block":"masonry","walls":true,"thickness":2},
      {"type":"box","from":[-10,9,-15],"to":[10,9,1],"block":"trim","walls":true},
      {"type":"box","from":[-10,16,-15],"to":[10,16,1],"block":"trim","walls":true},
      {"type":"group","repeat":{"count":4,"offset":[5,0,0]}, "operations": [
        {"type":"box","from":[-8,4,2],"to":[-8,21,2],"block":"masonry"},
        {"type":"blocks","block":"trim_stairs[facing=north]","at":[[-8,3,3]]}
      ]},
      {"type":"group","repeat":{"count":4,"offset":[5,0,0]}, "operations": [
        {"type":"box","from":[-6,11,1],"to":[-5,14,1],"block":"window"},
        {"type":"arch","from":[-6,14,1],"to":[-5,15,1],"block":"trim","style":"round","rise":1},
        {"type":"box","from":[-6,18,1],"to":[-5,20,1],"block":"window"}
      ]},
      {"type":"arch","from":[-2,3,1],"to":[2,8,2],"block":"trim","style":"pointed","rise":4,"cut":true},
      {"type":"blocks","block":"dark_oak_door[facing=north,hinge=left]","at":[[-1,3,1]]},
      {"type":"blocks","block":"dark_oak_door[facing=north,hinge=right]","at":[[0,3,1]]},
      {"type":"roof","shape":"hip","from":[-10,23,-15],"to":[10,23,1],"block":"roof","pitch":1.5,"overhang":1,"eaves":"trim_stairs"}
    ]},
    {"id":"keep_spire","type":"group","offset":[8,0,-13], "operations": [
      {"type":"cylinder","center":[0,0,0],"radius":5,"height":36,"block":"masonry","hollow":true},
      {"type":"cylinder","center":[0,24,0],"radius":5,"height":1,"block":"trim","hollow":true},
      {"type":"group","symmetry":{"x":0,"z":0}, "operations": [
        {"type":"box","from":[0,28,-5],"to":[0,31,-5],"block":"window"},
        {"type":"box","from":[-5,28,0],"to":[-5,31,0],"block":"window"}
      ]},
      {"type":"script","args":{"r":6,"y":35},"code":"const {r,y}=args; for (let x=-r;x<=r;x++) for (let z=-r;z<=r;z++){ const d=Math.hypot(x,z); if (d>=r+0.5||d<r-0.5) continue; const f=Math.abs(x)>=Math.abs(z)?(x>0?'west':'east'):(z>0?'north':'south'); set(x,y,z,`trim_stairs[half=top,facing=${f}]`); }"},
      {"type":"cylinder","center":[0,36,0],"radius":6,"height":3,"block":"masonry","hollow":true},
      {"type":"roof","shape":"cone","center":[0,39,0],"radius":6,"block":"roof","profile":[1,1.5,2,2,3,3,4],"overhang":1,"ridge":"lightning_rod"}
    ]},
    {"id":"house_west","type":"place","component":"house","at":[-17,1,4],"rotate":90},
    {"id":"house_east","type":"place","component":"house","at":[17,1,12],"rotate":270},
    {"id":"well","type":"group","offset":[0,1,10], "operations": [
      {"type":"cylinder","center":[0,0,0],"radius":2,"height":2,"block":"base","hollow":true},
      {"type":"blocks","block":"water","at":[[0,0,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]},
      {"type":"blocks","block":"spruce_fence","at":[[-2,2,0],[-2,3,0],[2,2,0],[2,3,0]]},
      {"type":"roof","shape":"gable","axis":"x","from":[-2,4,-1],"to":[2,4,1],"block":"house_roof","overhang":1}
    ]},
    {"id":"weathering","type":"replace","from":[-22,0,-22],"to":[22,4,22],"target":"stone_bricks","block":"mossy_stone_bricks","chance":0.25},
    {"id":"court_trees","type":"group", "operations": [
      {"type":"tree","kind":"oak","at":[-12,1,12],"seed":3},
      {"type":"tree","kind":"cherry","at":[12,1,4],"seed":8}
    ]},
    {"id":"island_trees","type":"group", "operations": [
      {"type":"tree","kind":"big_oak","at":[-32,0,14],"seed":2},
      {"type":"tree","kind":"spruce","at":[30,0,-20],"seed":4},
      {"type":"tree","kind":"spruce","at":[34,0,-12],"seed":6},
      {"type":"tree","kind":"birch","at":[-28,0,-28],"seed":7},
      {"type":"tree","kind":"oak","at":[26,0,30],"seed":9}
    ]},
    {"id":"flora","type":"scatter","from":[-44,-4,-44],"to":[44,4,44],"on":["grass_block"],"block":"flora","density":0.18},
    {"id":"bushes","type":"scatter","from":[-44,-4,-44],"to":[44,4,44],"on":["grass_block"],"tree":"bush","density":0.012,"spacing":5}
  ]
}
```
