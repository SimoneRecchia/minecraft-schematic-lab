#!/usr/bin/env node

// apps/server/src/index.ts
import { existsSync as existsSync8 } from "node:fs";
import { createServer } from "node:net";

// apps/server/src/assets/AssetStore.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";

// apps/server/src/paths.ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function appHome() {
  const dir = process.env.MSL_HOME || join(homedir(), ".minecraft-schematic-lab");
  mkdirSync(dir, { recursive: true });
  return dir;
}
function appDir(...parts) {
  const dir = join(appHome(), ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function minecraftDir() {
  if (process.env.MINECRAFT_DIR) return process.env.MINECRAFT_DIR;
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "minecraft");
  if (process.platform === "win32")
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), ".minecraft");
  return join(homedir(), ".minecraft");
}

// apps/server/src/assets/buildPack.ts
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { strFromU8, unzipSync } from "fflate";
var ATLAS_COLUMNS = 64;
var TILE = 16;
var PREFIX = "assets/minecraft/";
function wanted(name) {
  if (!name.startsWith(PREFIX)) return false;
  const rest = name.slice(PREFIX.length);
  return rest.startsWith("blockstates/") && rest.endsWith(".json") || rest.startsWith("models/block/") && rest.endsWith(".json") || rest.startsWith("textures/block/") && rest.endsWith(".png");
}
function alphaClass(data) {
  let cut = false;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a > 0 && a < 255) return 2;
    if (a === 0) cut = true;
  }
  return cut ? 1 : 0;
}
function averageColor(data) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return 8421504;
  return Math.round(r / n) << 16 | Math.round(g / n) << 8 | Math.round(b / n);
}
async function buildPack(version, jar, progress) {
  progress(`Reading Minecraft ${version} block models and textures\u2026`);
  const files = unzipSync(jar, { filter: (f) => wanted(f.name) });
  const blockstates = {};
  const models = {};
  const textureFiles = [];
  for (const [path, bytes] of Object.entries(files)) {
    const rest = path.slice(PREFIX.length);
    if (rest.startsWith("blockstates/")) {
      blockstates[rest.slice(12, -5)] = JSON.parse(strFromU8(bytes));
    } else if (rest.startsWith("models/")) {
      models[rest.slice(7, -5)] = JSON.parse(strFromU8(bytes));
    } else {
      textureFiles.push([rest.slice(15, -4), bytes]);
    }
  }
  if (Object.keys(blockstates).length === 0) {
    throw new Error(`The Minecraft ${version} client has no flattened block models (needs 1.13+).`);
  }
  textureFiles.sort((a, b) => a[0].localeCompare(b[0]));
  const names = ["missing", ...textureFiles.map(([n]) => n)];
  const rows = Math.ceil(names.length / ATLAS_COLUMNS);
  const atlas = createCanvas(ATLAS_COLUMNS * TILE, rows * TILE);
  const actx = atlas.getContext("2d");
  actx.imageSmoothingEnabled = false;
  const alpha = [0];
  const avg = [16711935];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      actx.fillStyle = x < 8 !== y < 8 ? "#f800f8" : "#000000";
      actx.fillRect(x, y, 1, 1);
    }
  }
  const tile = createCanvas(TILE, TILE);
  const tctx = tile.getContext("2d");
  tctx.imageSmoothingEnabled = false;
  for (let i = 0; i < textureFiles.length; i++) {
    const [, bytes] = textureFiles[i];
    const layer = i + 1;
    try {
      const img = await loadImage(Buffer.from(bytes));
      const frame = Math.min(img.width, img.height);
      tctx.clearRect(0, 0, TILE, TILE);
      tctx.drawImage(img, 0, 0, img.width, frame, 0, 0, TILE, TILE);
      const pixels = tctx.getImageData(0, 0, TILE, TILE);
      alpha.push(alphaClass(pixels.data));
      avg.push(averageColor(pixels.data));
      actx.putImageData(
        pixels,
        layer % ATLAS_COLUMNS * TILE,
        Math.floor(layer / ATLAS_COLUMNS) * TILE
      );
    } catch {
      alpha.push(0);
      avg.push(16711935);
    }
  }
  progress(`Packed ${names.length} textures.`);
  return {
    data: {
      manifest: { version, textures: names, alpha, avg, columns: ATLAS_COLUMNS },
      blockstates,
      models
    },
    atlas: await atlas.encode("png")
  };
}

// apps/server/src/assets/clientJar.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
function findLocalJar(version) {
  const candidates = [
    join2(appDir("jars"), `${version}.jar`),
    join2(minecraftDir(), "versions", version, `${version}.jar`)
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3e4) });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return await res.json();
}
async function downloadClientJar(version, progress) {
  progress(`Fetching the Minecraft ${version} version list\u2026`);
  const manifest = await fetchJson(MANIFEST);
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) throw new Error(`Mojang does not list a version "${version}".`);
  const meta = await fetchJson(entry.url);
  const { url, sha1, size } = meta.downloads.client;
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 6e4) });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const chunks = [];
  let received = 0;
  const reader = res.body.getReader();
  let lastReport = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received - lastReport > 1e6) {
      lastReport = received;
      progress(
        `Downloading Minecraft ${version} textures\u2026 ${Math.round(received / size * 100)}%`,
        received / size
      );
    }
  }
  const buffer = Buffer.concat(chunks);
  const digest = createHash("sha1").update(buffer).digest("hex");
  if (digest !== sha1) throw new Error("The downloaded client jar failed its checksum; try again.");
  const target = join2(appDir("jars"), `${version}.jar`);
  writeFileSync(`${target}.part`, buffer);
  renameSync(`${target}.part`, target);
  return target;
}
async function obtainClientJar(version, progress) {
  const local = findLocalJar(version);
  if (local) {
    progress(`Using the Minecraft ${version} install found on this computer.`);
    return readFileSync(local);
  }
  if (process.env.MSL_OFFLINE === "1")
    throw new Error(`Minecraft ${version} is not installed and downloads are disabled.`);
  return readFileSync(await downloadClientJar(version, progress));
}

// packages/catalog/data/catalog.json
var catalog_default = { source: "PrismarineJS/minecraft-data (master)", generatedAt: "2026-10-15", versions: [{ id: "26.3", dataVersion: 5023, dataset: "pc/26.1" }, { id: "26.2", dataVersion: 4903, dataset: "pc/26.1" }, { id: "26.1.2", dataVersion: 4790, dataset: "pc/26.1" }, { id: "26.1.1", dataVersion: 4788, dataset: "pc/26.1" }, { id: "26.1", dataVersion: 4786, dataset: "pc/26.1" }, { id: "1.21.11", dataVersion: 4671, dataset: "pc/1.21.11" }, { id: "1.21.10", dataVersion: 4556, dataset: "pc/1.21.9" }, { id: "1.21.9", dataVersion: 4554, dataset: "pc/1.21.9" }, { id: "1.21.8", dataVersion: 4440, dataset: "pc/1.21.8" }, { id: "1.21.7", dataVersion: 4438, dataset: "pc/1.21.6" }, { id: "1.21.6", dataVersion: 4435, dataset: "pc/1.21.6" }, { id: "1.21.5", dataVersion: 4325, dataset: "pc/1.21.5" }, { id: "1.21.4", dataVersion: 4189, dataset: "pc/1.21.4" }, { id: "1.21.3", dataVersion: 4082, dataset: "pc/1.21.3~released" }, { id: "1.21.2", dataVersion: 4080, dataset: "pc/1.21.1~released" }, { id: "1.21.1", dataVersion: 3955, dataset: "pc/1.21.1" }, { id: "1.21", dataVersion: 3953, dataset: "pc/1.21.1" }, { id: "1.20.6", dataVersion: 3839, dataset: "pc/1.20.5~released" }, { id: "1.20.5", dataVersion: 3837, dataset: "pc/1.20.5~released" }, { id: "1.20.4", dataVersion: 3700, dataset: "pc/1.20.4~released" }, { id: "1.20.3", dataVersion: 3698, dataset: "pc/1.20.3~released" }, { id: "1.20.2", dataVersion: 3578, dataset: "pc/1.20.2" }, { id: "1.20.1", dataVersion: 3465, dataset: "pc/1.20" }, { id: "1.20", dataVersion: 3463, dataset: "pc/1.20" }, { id: "1.19.4", dataVersion: 3337, dataset: "pc/1.19.4~released" }, { id: "1.19.3", dataVersion: 3218, dataset: "pc/1.19.3~released" }, { id: "1.19.2", dataVersion: 3120, dataset: "pc/1.19.2" }, { id: "1.19.1", dataVersion: 3117, dataset: "pc/1.19" }, { id: "1.19", dataVersion: 3105, dataset: "pc/1.19" }, { id: "1.18.2", dataVersion: 2975, dataset: "pc/1.18" }, { id: "1.18.1", dataVersion: 2865, dataset: "pc/1.18" }, { id: "1.18", dataVersion: 2860, dataset: "pc/1.18" }, { id: "1.17.1", dataVersion: 2730, dataset: "pc/1.17" }, { id: "1.17", dataVersion: 2724, dataset: "pc/1.17" }, { id: "1.16.5", dataVersion: 2586, dataset: "pc/1.16.2" }, { id: "1.16.4", dataVersion: 2584, dataset: "pc/1.16.2" }, { id: "1.16.3", dataVersion: 2580, dataset: "pc/1.16.2" }, { id: "1.16.2", dataVersion: 2578, dataset: "pc/1.16.2" }, { id: "1.16.1", dataVersion: 2567, dataset: "pc/1.16.1" }, { id: "1.16", dataVersion: 2566, dataset: "pc/1.16.1" }, { id: "1.15.2", dataVersion: 2230, dataset: "pc/1.15.2" }, { id: "1.15.1", dataVersion: 2227, dataset: "pc/1.15.2" }, { id: "1.15", dataVersion: 2225, dataset: "pc/1.15.2" }, { id: "1.14.4", dataVersion: 1976, dataset: "pc/1.14.4" }, { id: "1.14.3", dataVersion: 1968, dataset: "pc/1.14.4" }, { id: "1.14.2", dataVersion: 1963, dataset: "pc/1.14.4" }, { id: "1.14.1", dataVersion: 1957, dataset: "pc/1.14.4" }, { id: "1.14", dataVersion: 1952, dataset: "pc/1.14.4" }, { id: "1.13.2", dataVersion: 1631, dataset: "pc/1.13.2" }, { id: "1.13.1", dataVersion: 1628, dataset: "pc/1.13" }, { id: "1.13", dataVersion: 1519, dataset: "pc/1.13" }, { id: "1.12.2", dataVersion: 1343, dataset: "pc/1.12" }, { id: "1.12.1", dataVersion: 1241, dataset: "pc/1.12" }, { id: "1.12", dataVersion: 1139, dataset: "pc/1.12" }, { id: "1.11.2", dataVersion: 922, dataset: "pc/1.11" }, { id: "1.11.1", dataVersion: 921, dataset: "pc/1.11" }, { id: "1.11", dataVersion: 819, dataset: "pc/1.11" }, { id: "1.10.2", dataVersion: 512, dataset: "pc/1.10" }, { id: "1.10.1", dataVersion: 511, dataset: "pc/1.10" }, { id: "1.10", dataVersion: 510, dataset: "pc/1.10" }, { id: "1.9.4", dataVersion: 184, dataset: "pc/1.9" }, { id: "1.9.3", dataVersion: 183, dataset: "pc/1.9" }, { id: "1.9.2", dataVersion: 176, dataset: "pc/1.9" }, { id: "1.9.1", dataVersion: 175, dataset: "pc/1.9" }, { id: "1.9", dataVersion: 169, dataset: "pc/1.9" }, { id: "1.8.9", dataVersion: 95, dataset: "pc/1.8" }, { id: "1.8.8", dataVersion: 94, dataset: "pc/1.8" }, { id: "1.8.7", dataVersion: 93, dataset: "pc/1.8" }, { id: "1.8.6", dataVersion: 92, dataset: "pc/1.8" }, { id: "1.8.5", dataVersion: 91, dataset: "pc/1.8" }, { id: "1.8.4", dataVersion: 90, dataset: "pc/1.8" }, { id: "1.8.3", dataVersion: 89, dataset: "pc/1.8" }, { id: "1.8.2", dataVersion: 88, dataset: "pc/1.8" }, { id: "1.8.1", dataVersion: 80, dataset: "pc/1.8" }, { id: "1.8", dataVersion: 74, dataset: "pc/1.8" }], names: ["acacia_button", "acacia_door", "acacia_fence", "acacia_fence_gate", "acacia_hanging_sign", "acacia_leaves", "acacia_log", "acacia_planks", "acacia_pressure_plate", "acacia_sapling", "acacia_shelf", "acacia_sign", "acacia_slab", "acacia_stairs", "acacia_trapdoor", "acacia_wall_hanging_sign", "acacia_wall_sign", "acacia_wood", "activator_rail", "air", "allium", "amethyst_block", "amethyst_cluster", "ancient_debris", "andesite", "andesite_slab", "andesite_stairs", "andesite_wall", "anvil", "attached_melon_stem", "attached_pumpkin_stem", "azalea", "azalea_leaves", "azure_bluet", "bamboo", "bamboo_block", "bamboo_button", "bamboo_door", "bamboo_fence", "bamboo_fence_gate", "bamboo_hanging_sign", "bamboo_mosaic", "bamboo_mosaic_slab", "bamboo_mosaic_stairs", "bamboo_planks", "bamboo_pressure_plate", "bamboo_sapling", "bamboo_shelf", "bamboo_sign", "bamboo_slab", "bamboo_stairs", "bamboo_trapdoor", "bamboo_wall_hanging_sign", "bamboo_wall_sign", "barrel", "barrier", "basalt", "beacon", "bedrock", "bee_nest", "beehive", "beetroots", "bell", "big_dripleaf", "big_dripleaf_stem", "birch_button", "birch_door", "birch_fence", "birch_fence_gate", "birch_hanging_sign", "birch_leaves", "birch_log", "birch_planks", "birch_pressure_plate", "birch_sapling", "birch_shelf", "birch_sign", "birch_slab", "birch_stairs", "birch_trapdoor", "birch_wall_hanging_sign", "birch_wall_sign", "birch_wood", "black_banner", "black_bed", "black_candle", "black_candle_cake", "black_carpet", "black_concrete", "black_concrete_powder", "black_glazed_terracotta", "black_shulker_box", "black_stained_glass", "black_stained_glass_pane", "black_terracotta", "black_wall_banner", "black_wool", "blackstone", "blackstone_slab", "blackstone_stairs", "blackstone_wall", "blast_furnace", "blue_banner", "blue_bed", "blue_candle", "blue_candle_cake", "blue_carpet", "blue_concrete", "blue_concrete_powder", "blue_glazed_terracotta", "blue_ice", "blue_orchid", "blue_shulker_box", "blue_stained_glass", "blue_stained_glass_pane", "blue_terracotta", "blue_wall_banner", "blue_wool", "bone_block", "bookshelf", "brain_coral", "brain_coral_block", "brain_coral_fan", "brain_coral_wall_fan", "brewing_stand", "brick_slab", "brick_stairs", "brick_wall", "bricks", "brown_banner", "brown_bed", "brown_candle", "brown_candle_cake", "brown_carpet", "brown_concrete", "brown_concrete_powder", "brown_glazed_terracotta", "brown_mushroom", "brown_mushroom_block", "brown_shulker_box", "brown_stained_glass", "brown_stained_glass_pane", "brown_terracotta", "brown_wall_banner", "brown_wool", "bubble_column", "bubble_coral", "bubble_coral_block", "bubble_coral_fan", "bubble_coral_wall_fan", "budding_amethyst", "bush", "cactus", "cactus_flower", "cake", "calcite", "calibrated_sculk_sensor", "campfire", "candle", "candle_cake", "carrots", "cartography_table", "carved_pumpkin", "cauldron", "cave_air", "cave_vines", "cave_vines_plant", "chain", "chain_command_block", "cherry_button", "cherry_door", "cherry_fence", "cherry_fence_gate", "cherry_hanging_sign", "cherry_leaves", "cherry_log", "cherry_planks", "cherry_pressure_plate", "cherry_sapling", "cherry_shelf", "cherry_sign", "cherry_slab", "cherry_stairs", "cherry_trapdoor", "cherry_wall_hanging_sign", "cherry_wall_sign", "cherry_wood", "chest", "chipped_anvil", "chiseled_bookshelf", "chiseled_copper", "chiseled_deepslate", "chiseled_nether_bricks", "chiseled_polished_blackstone", "chiseled_quartz_block", "chiseled_red_sandstone", "chiseled_resin_bricks", "chiseled_sandstone", "chiseled_stone_bricks", "chiseled_tuff", "chiseled_tuff_bricks", "chorus_flower", "chorus_plant", "clay", "closed_eyeblossom", "coal_block", "coal_ore", "coarse_dirt", "cobbled_deepslate", "cobbled_deepslate_slab", "cobbled_deepslate_stairs", "cobbled_deepslate_wall", "cobblestone", "cobblestone_slab", "cobblestone_stairs", "cobblestone_wall", "cobweb", "cocoa", "command_block", "comparator", "composter", "conduit", "copper_bars", "copper_block", "copper_bulb", "copper_chain", "copper_chest", "copper_door", "copper_golem_statue", "copper_grate", "copper_lantern", "copper_ore", "copper_torch", "copper_trapdoor", "copper_wall_torch", "cornflower", "cracked_deepslate_bricks", "cracked_deepslate_tiles", "cracked_nether_bricks", "cracked_polished_blackstone_bricks", "cracked_stone_bricks", "crafter", "crafting_table", "creaking_heart", "creeper_head", "creeper_wall_head", "crimson_button", "crimson_door", "crimson_fence", "crimson_fence_gate", "crimson_fungus", "crimson_hanging_sign", "crimson_hyphae", "crimson_nylium", "crimson_planks", "crimson_pressure_plate", "crimson_roots", "crimson_shelf", "crimson_sign", "crimson_slab", "crimson_stairs", "crimson_stem", "crimson_trapdoor", "crimson_wall_hanging_sign", "crimson_wall_sign", "crying_obsidian", "cut_copper", "cut_copper_slab", "cut_copper_stairs", "cut_red_sandstone", "cut_red_sandstone_slab", "cut_sandstone", "cut_sandstone_slab", "cyan_banner", "cyan_bed", "cyan_candle", "cyan_candle_cake", "cyan_carpet", "cyan_concrete", "cyan_concrete_powder", "cyan_glazed_terracotta", "cyan_shulker_box", "cyan_stained_glass", "cyan_stained_glass_pane", "cyan_terracotta", "cyan_wall_banner", "cyan_wool", "damaged_anvil", "dandelion", "dark_oak_button", "dark_oak_door", "dark_oak_fence", "dark_oak_fence_gate", "dark_oak_hanging_sign", "dark_oak_leaves", "dark_oak_log", "dark_oak_planks", "dark_oak_pressure_plate", "dark_oak_sapling", "dark_oak_shelf", "dark_oak_sign", "dark_oak_slab", "dark_oak_stairs", "dark_oak_trapdoor", "dark_oak_wall_hanging_sign", "dark_oak_wall_sign", "dark_oak_wood", "dark_prismarine", "dark_prismarine_slab", "dark_prismarine_stairs", "daylight_detector", "dead_brain_coral", "dead_brain_coral_block", "dead_brain_coral_fan", "dead_brain_coral_wall_fan", "dead_bubble_coral", "dead_bubble_coral_block", "dead_bubble_coral_fan", "dead_bubble_coral_wall_fan", "dead_bush", "dead_fire_coral", "dead_fire_coral_block", "dead_fire_coral_fan", "dead_fire_coral_wall_fan", "dead_horn_coral", "dead_horn_coral_block", "dead_horn_coral_fan", "dead_horn_coral_wall_fan", "dead_tube_coral", "dead_tube_coral_block", "dead_tube_coral_fan", "dead_tube_coral_wall_fan", "decorated_pot", "deepslate", "deepslate_brick_slab", "deepslate_brick_stairs", "deepslate_brick_wall", "deepslate_bricks", "deepslate_coal_ore", "deepslate_copper_ore", "deepslate_diamond_ore", "deepslate_emerald_ore", "deepslate_gold_ore", "deepslate_iron_ore", "deepslate_lapis_ore", "deepslate_redstone_ore", "deepslate_tile_slab", "deepslate_tile_stairs", "deepslate_tile_wall", "deepslate_tiles", "detector_rail", "diamond_block", "diamond_ore", "diorite", "diorite_slab", "diorite_stairs", "diorite_wall", "dirt", "dirt_path", "dispenser", "dragon_egg", "dragon_head", "dragon_wall_head", "dried_ghast", "dried_kelp_block", "dripstone_block", "dropper", "emerald_block", "emerald_ore", "enchanting_table", "end_gateway", "end_portal", "end_portal_frame", "end_rod", "end_stone", "end_stone_brick_slab", "end_stone_brick_stairs", "end_stone_brick_wall", "end_stone_bricks", "ender_chest", "exposed_chiseled_copper", "exposed_copper", "exposed_copper_bars", "exposed_copper_bulb", "exposed_copper_chain", "exposed_copper_chest", "exposed_copper_door", "exposed_copper_golem_statue", "exposed_copper_grate", "exposed_copper_lantern", "exposed_copper_trapdoor", "exposed_cut_copper", "exposed_cut_copper_slab", "exposed_cut_copper_stairs", "exposed_lightning_rod", "farmland", "fern", "fire", "fire_coral", "fire_coral_block", "fire_coral_fan", "fire_coral_wall_fan", "firefly_bush", "fletching_table", "flower_pot", "flowering_azalea", "flowering_azalea_leaves", "frogspawn", "frosted_ice", "furnace", "gilded_blackstone", "glass", "glass_pane", "glow_lichen", "glowstone", "gold_block", "gold_ore", "golden_dandelion", "granite", "granite_slab", "granite_stairs", "granite_wall", "grass", "grass_block", "grass_path", "gravel", "gray_banner", "gray_bed", "gray_candle", "gray_candle_cake", "gray_carpet", "gray_concrete", "gray_concrete_powder", "gray_glazed_terracotta", "gray_shulker_box", "gray_stained_glass", "gray_stained_glass_pane", "gray_terracotta", "gray_wall_banner", "gray_wool", "green_banner", "green_bed", "green_candle", "green_candle_cake", "green_carpet", "green_concrete", "green_concrete_powder", "green_glazed_terracotta", "green_shulker_box", "green_stained_glass", "green_stained_glass_pane", "green_terracotta", "green_wall_banner", "green_wool", "grindstone", "hanging_roots", "hay_block", "heavy_core", "heavy_weighted_pressure_plate", "honey_block", "honeycomb_block", "hopper", "horn_coral", "horn_coral_block", "horn_coral_fan", "horn_coral_wall_fan", "ice", "infested_chiseled_stone_bricks", "infested_cobblestone", "infested_cracked_stone_bricks", "infested_deepslate", "infested_mossy_stone_bricks", "infested_stone", "infested_stone_bricks", "iron_bars", "iron_block", "iron_chain", "iron_door", "iron_ore", "iron_trapdoor", "jack_o_lantern", "jigsaw", "jukebox", "jungle_button", "jungle_door", "jungle_fence", "jungle_fence_gate", "jungle_hanging_sign", "jungle_leaves", "jungle_log", "jungle_planks", "jungle_pressure_plate", "jungle_sapling", "jungle_shelf", "jungle_sign", "jungle_slab", "jungle_stairs", "jungle_trapdoor", "jungle_wall_hanging_sign", "jungle_wall_sign", "jungle_wood", "kelp", "kelp_plant", "ladder", "lantern", "lapis_block", "lapis_ore", "large_amethyst_bud", "large_fern", "lava", "lava_cauldron", "leaf_litter", "lectern", "lever", "light", "light_blue_banner", "light_blue_bed", "light_blue_candle", "light_blue_candle_cake", "light_blue_carpet", "light_blue_concrete", "light_blue_concrete_powder", "light_blue_glazed_terracotta", "light_blue_shulker_box", "light_blue_stained_glass", "light_blue_stained_glass_pane", "light_blue_terracotta", "light_blue_wall_banner", "light_blue_wool", "light_gray_banner", "light_gray_bed", "light_gray_candle", "light_gray_candle_cake", "light_gray_carpet", "light_gray_concrete", "light_gray_concrete_powder", "light_gray_glazed_terracotta", "light_gray_shulker_box", "light_gray_stained_glass", "light_gray_stained_glass_pane", "light_gray_terracotta", "light_gray_wall_banner", "light_gray_wool", "light_weighted_pressure_plate", "lightning_rod", "lilac", "lily_of_the_valley", "lily_pad", "lime_banner", "lime_bed", "lime_candle", "lime_candle_cake", "lime_carpet", "lime_concrete", "lime_concrete_powder", "lime_glazed_terracotta", "lime_shulker_box", "lime_stained_glass", "lime_stained_glass_pane", "lime_terracotta", "lime_wall_banner", "lime_wool", "lodestone", "loom", "magenta_banner", "magenta_bed", "magenta_candle", "magenta_candle_cake", "magenta_carpet", "magenta_concrete", "magenta_concrete_powder", "magenta_glazed_terracotta", "magenta_shulker_box", "magenta_stained_glass", "magenta_stained_glass_pane", "magenta_terracotta", "magenta_wall_banner", "magenta_wool", "magma_block", "mangrove_button", "mangrove_door", "mangrove_fence", "mangrove_fence_gate", "mangrove_hanging_sign", "mangrove_leaves", "mangrove_log", "mangrove_planks", "mangrove_pressure_plate", "mangrove_propagule", "mangrove_roots", "mangrove_shelf", "mangrove_sign", "mangrove_slab", "mangrove_stairs", "mangrove_trapdoor", "mangrove_wall_hanging_sign", "mangrove_wall_sign", "mangrove_wood", "medium_amethyst_bud", "melon", "melon_stem", "moss_block", "moss_carpet", "mossy_cobblestone", "mossy_cobblestone_slab", "mossy_cobblestone_stairs", "mossy_cobblestone_wall", "mossy_stone_brick_slab", "mossy_stone_brick_stairs", "mossy_stone_brick_wall", "mossy_stone_bricks", "moving_piston", "mud", "mud_brick_slab", "mud_brick_stairs", "mud_brick_wall", "mud_bricks", "muddy_mangrove_roots", "mushroom_stem", "mycelium", "nether_brick_fence", "nether_brick_slab", "nether_brick_stairs", "nether_brick_wall", "nether_bricks", "nether_gold_ore", "nether_portal", "nether_quartz_ore", "nether_sprouts", "nether_wart", "nether_wart_block", "netherite_block", "netherrack", "note_block", "oak_button", "oak_door", "oak_fence", "oak_fence_gate", "oak_hanging_sign", "oak_leaves", "oak_log", "oak_planks", "oak_pressure_plate", "oak_sapling", "oak_shelf", "oak_sign", "oak_slab", "oak_stairs", "oak_trapdoor", "oak_wall_hanging_sign", "oak_wall_sign", "oak_wood", "observer", "obsidian", "ochre_froglight", "open_eyeblossom", "orange_banner", "orange_bed", "orange_candle", "orange_candle_cake", "orange_carpet", "orange_concrete", "orange_concrete_powder", "orange_glazed_terracotta", "orange_shulker_box", "orange_stained_glass", "orange_stained_glass_pane", "orange_terracotta", "orange_tulip", "orange_wall_banner", "orange_wool", "oxeye_daisy", "oxidized_chiseled_copper", "oxidized_copper", "oxidized_copper_bars", "oxidized_copper_bulb", "oxidized_copper_chain", "oxidized_copper_chest", "oxidized_copper_door", "oxidized_copper_golem_statue", "oxidized_copper_grate", "oxidized_copper_lantern", "oxidized_copper_trapdoor", "oxidized_cut_copper", "oxidized_cut_copper_slab", "oxidized_cut_copper_stairs", "oxidized_lightning_rod", "packed_ice", "packed_mud", "pale_hanging_moss", "pale_moss_block", "pale_moss_carpet", "pale_oak_button", "pale_oak_door", "pale_oak_fence", "pale_oak_fence_gate", "pale_oak_hanging_sign", "pale_oak_leaves", "pale_oak_log", "pale_oak_planks", "pale_oak_pressure_plate", "pale_oak_sapling", "pale_oak_shelf", "pale_oak_sign", "pale_oak_slab", "pale_oak_stairs", "pale_oak_trapdoor", "pale_oak_wall_hanging_sign", "pale_oak_wall_sign", "pale_oak_wood", "pearlescent_froglight", "peony", "petrified_oak_slab", "piglin_head", "piglin_wall_head", "pink_banner", "pink_bed", "pink_candle", "pink_candle_cake", "pink_carpet", "pink_concrete", "pink_concrete_powder", "pink_glazed_terracotta", "pink_petals", "pink_shulker_box", "pink_stained_glass", "pink_stained_glass_pane", "pink_terracotta", "pink_tulip", "pink_wall_banner", "pink_wool", "piston", "piston_head", "pitcher_crop", "pitcher_plant", "player_head", "player_wall_head", "podzol", "pointed_dripstone", "polished_andesite", "polished_andesite_slab", "polished_andesite_stairs", "polished_basalt", "polished_blackstone", "polished_blackstone_brick_slab", "polished_blackstone_brick_stairs", "polished_blackstone_brick_wall", "polished_blackstone_bricks", "polished_blackstone_button", "polished_blackstone_pressure_plate", "polished_blackstone_slab", "polished_blackstone_stairs", "polished_blackstone_wall", "polished_deepslate", "polished_deepslate_slab", "polished_deepslate_stairs", "polished_deepslate_wall", "polished_diorite", "polished_diorite_slab", "polished_diorite_stairs", "polished_granite", "polished_granite_slab", "polished_granite_stairs", "polished_tuff", "polished_tuff_slab", "polished_tuff_stairs", "polished_tuff_wall", "poppy", "potatoes", "potted_acacia_sapling", "potted_allium", "potted_azalea_bush", "potted_azure_bluet", "potted_bamboo", "potted_birch_sapling", "potted_blue_orchid", "potted_brown_mushroom", "potted_cactus", "potted_cherry_sapling", "potted_closed_eyeblossom", "potted_cornflower", "potted_crimson_fungus", "potted_crimson_roots", "potted_dandelion", "potted_dark_oak_sapling", "potted_dead_bush", "potted_fern", "potted_flowering_azalea_bush", "potted_golden_dandelion", "potted_jungle_sapling", "potted_lily_of_the_valley", "potted_mangrove_propagule", "potted_oak_sapling", "potted_open_eyeblossom", "potted_orange_tulip", "potted_oxeye_daisy", "potted_pale_oak_sapling", "potted_pink_tulip", "potted_poppy", "potted_red_mushroom", "potted_red_tulip", "potted_spruce_sapling", "potted_torchflower", "potted_warped_fungus", "potted_warped_roots", "potted_white_tulip", "potted_wither_rose", "powder_snow", "powder_snow_cauldron", "powered_rail", "prismarine", "prismarine_brick_slab", "prismarine_brick_stairs", "prismarine_bricks", "prismarine_slab", "prismarine_stairs", "prismarine_wall", "pumpkin", "pumpkin_stem", "purple_banner", "purple_bed", "purple_candle", "purple_candle_cake", "purple_carpet", "purple_concrete", "purple_concrete_powder", "purple_glazed_terracotta", "purple_shulker_box", "purple_stained_glass", "purple_stained_glass_pane", "purple_terracotta", "purple_wall_banner", "purple_wool", "purpur_block", "purpur_pillar", "purpur_slab", "purpur_stairs", "quartz_block", "quartz_bricks", "quartz_pillar", "quartz_slab", "quartz_stairs", "rail", "raw_copper_block", "raw_gold_block", "raw_iron_block", "red_banner", "red_bed", "red_candle", "red_candle_cake", "red_carpet", "red_concrete", "red_concrete_powder", "red_glazed_terracotta", "red_mushroom", "red_mushroom_block", "red_nether_brick_slab", "red_nether_brick_stairs", "red_nether_brick_wall", "red_nether_bricks", "red_sand", "red_sandstone", "red_sandstone_slab", "red_sandstone_stairs", "red_sandstone_wall", "red_shulker_box", "red_stained_glass", "red_stained_glass_pane", "red_terracotta", "red_tulip", "red_wall_banner", "red_wool", "redstone_block", "redstone_lamp", "redstone_ore", "redstone_torch", "redstone_wall_torch", "redstone_wire", "reinforced_deepslate", "repeater", "repeating_command_block", "resin_block", "resin_brick_slab", "resin_brick_stairs", "resin_brick_wall", "resin_bricks", "resin_clump", "respawn_anchor", "rooted_dirt", "rose_bush", "sand", "sandstone", "sandstone_slab", "sandstone_stairs", "sandstone_wall", "scaffolding", "sculk", "sculk_catalyst", "sculk_sensor", "sculk_shrieker", "sculk_vein", "sea_lantern", "sea_pickle", "seagrass", "short_dry_grass", "short_grass", "shroomlight", "shulker_box", "sign", "skeleton_skull", "skeleton_wall_skull", "slime_block", "small_amethyst_bud", "small_dripleaf", "smithing_table", "smoker", "smooth_basalt", "smooth_quartz", "smooth_quartz_slab", "smooth_quartz_stairs", "smooth_red_sandstone", "smooth_red_sandstone_slab", "smooth_red_sandstone_stairs", "smooth_sandstone", "smooth_sandstone_slab", "smooth_sandstone_stairs", "smooth_stone", "smooth_stone_slab", "sniffer_egg", "snow", "snow_block", "soul_campfire", "soul_fire", "soul_lantern", "soul_sand", "soul_soil", "soul_torch", "soul_wall_torch", "spawner", "sponge", "spore_blossom", "spruce_button", "spruce_door", "spruce_fence", "spruce_fence_gate", "spruce_hanging_sign", "spruce_leaves", "spruce_log", "spruce_planks", "spruce_pressure_plate", "spruce_sapling", "spruce_shelf", "spruce_sign", "spruce_slab", "spruce_stairs", "spruce_trapdoor", "spruce_wall_hanging_sign", "spruce_wall_sign", "spruce_wood", "sticky_piston", "stone", "stone_brick_slab", "stone_brick_stairs", "stone_brick_wall", "stone_bricks", "stone_button", "stone_pressure_plate", "stone_slab", "stone_stairs", "stonecutter", "stripped_acacia_log", "stripped_acacia_wood", "stripped_bamboo_block", "stripped_birch_log", "stripped_birch_wood", "stripped_cherry_log", "stripped_cherry_wood", "stripped_crimson_hyphae", "stripped_crimson_stem", "stripped_dark_oak_log", "stripped_dark_oak_wood", "stripped_jungle_log", "stripped_jungle_wood", "stripped_mangrove_log", "stripped_mangrove_wood", "stripped_oak_log", "stripped_oak_wood", "stripped_pale_oak_log", "stripped_pale_oak_wood", "stripped_spruce_log", "stripped_spruce_wood", "stripped_warped_hyphae", "stripped_warped_stem", "structure_block", "structure_void", "sugar_cane", "sunflower", "suspicious_gravel", "suspicious_sand", "sweet_berry_bush", "tall_dry_grass", "tall_grass", "tall_seagrass", "target", "terracotta", "test_block", "test_instance_block", "tinted_glass", "tnt", "torch", "torchflower", "torchflower_crop", "trapped_chest", "trial_spawner", "tripwire", "tripwire_hook", "tube_coral", "tube_coral_block", "tube_coral_fan", "tube_coral_wall_fan", "tuff", "tuff_brick_slab", "tuff_brick_stairs", "tuff_brick_wall", "tuff_bricks", "tuff_slab", "tuff_stairs", "tuff_wall", "turtle_egg", "twisting_vines", "twisting_vines_plant", "vault", "verdant_froglight", "vine", "void_air", "wall_sign", "wall_torch", "warped_button", "warped_door", "warped_fence", "warped_fence_gate", "warped_fungus", "warped_hanging_sign", "warped_hyphae", "warped_nylium", "warped_planks", "warped_pressure_plate", "warped_roots", "warped_shelf", "warped_sign", "warped_slab", "warped_stairs", "warped_stem", "warped_trapdoor", "warped_wall_hanging_sign", "warped_wall_sign", "warped_wart_block", "water", "water_cauldron", "waxed_chiseled_copper", "waxed_copper_bars", "waxed_copper_block", "waxed_copper_bulb", "waxed_copper_chain", "waxed_copper_chest", "waxed_copper_door", "waxed_copper_golem_statue", "waxed_copper_grate", "waxed_copper_lantern", "waxed_copper_trapdoor", "waxed_cut_copper", "waxed_cut_copper_slab", "waxed_cut_copper_stairs", "waxed_exposed_chiseled_copper", "waxed_exposed_copper", "waxed_exposed_copper_bars", "waxed_exposed_copper_bulb", "waxed_exposed_copper_chain", "waxed_exposed_copper_chest", "waxed_exposed_copper_door", "waxed_exposed_copper_golem_statue", "waxed_exposed_copper_grate", "waxed_exposed_copper_lantern", "waxed_exposed_copper_trapdoor", "waxed_exposed_cut_copper", "waxed_exposed_cut_copper_slab", "waxed_exposed_cut_copper_stairs", "waxed_exposed_lightning_rod", "waxed_lightning_rod", "waxed_oxidized_chiseled_copper", "waxed_oxidized_copper", "waxed_oxidized_copper_bars", "waxed_oxidized_copper_bulb", "waxed_oxidized_copper_chain", "waxed_oxidized_copper_chest", "waxed_oxidized_copper_door", "waxed_oxidized_copper_golem_statue", "waxed_oxidized_copper_grate", "waxed_oxidized_copper_lantern", "waxed_oxidized_copper_trapdoor", "waxed_oxidized_cut_copper", "waxed_oxidized_cut_copper_slab", "waxed_oxidized_cut_copper_stairs", "waxed_oxidized_lightning_rod", "waxed_weathered_chiseled_copper", "waxed_weathered_copper", "waxed_weathered_copper_bars", "waxed_weathered_copper_bulb", "waxed_weathered_copper_chain", "waxed_weathered_copper_chest", "waxed_weathered_copper_door", "waxed_weathered_copper_golem_statue", "waxed_weathered_copper_grate", "waxed_weathered_copper_lantern", "waxed_weathered_copper_trapdoor", "waxed_weathered_cut_copper", "waxed_weathered_cut_copper_slab", "waxed_weathered_cut_copper_stairs", "waxed_weathered_lightning_rod", "weathered_chiseled_copper", "weathered_copper", "weathered_copper_bars", "weathered_copper_bulb", "weathered_copper_chain", "weathered_copper_chest", "weathered_copper_door", "weathered_copper_golem_statue", "weathered_copper_grate", "weathered_copper_lantern", "weathered_copper_trapdoor", "weathered_cut_copper", "weathered_cut_copper_slab", "weathered_cut_copper_stairs", "weathered_lightning_rod", "weeping_vines", "weeping_vines_plant", "wet_sponge", "wheat", "white_banner", "white_bed", "white_candle", "white_candle_cake", "white_carpet", "white_concrete", "white_concrete_powder", "white_glazed_terracotta", "white_shulker_box", "white_stained_glass", "white_stained_glass_pane", "white_terracotta", "white_tulip", "white_wall_banner", "white_wool", "wildflowers", "wither_rose", "wither_skeleton_skull", "wither_skeleton_wall_skull", "yellow_banner", "yellow_bed", "yellow_candle", "yellow_candle_cake", "yellow_carpet", "yellow_concrete", "yellow_concrete_powder", "yellow_glazed_terracotta", "yellow_shulker_box", "yellow_stained_glass", "yellow_stained_glass_pane", "yellow_terracotta", "yellow_wall_banner", "yellow_wool", "zombie_head", "zombie_wall_head"], datasets: { "pc/26.1": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 709, 2, 699, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 701, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 698, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 987, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 988, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 697, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 10, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 151, 0, 904, 0, 1e3, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 417, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 10, 19, 47, 19, 75, 19, 179, 19, 257, 19, 299, 19, 493, 19, 590, 19, 644, 19, 702, 19, 951, 19, 1048, 19, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 243, 22, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 29, 952, 29, 76, 29, 11, 29, 180, 29, 494, 29, 300, 29, 703, 29, 591, 29, 48, 29, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 708, 31, 596, 31, 53, 31, 638, 33, 945, 33, 69, 33, 4, 33, 173, 33, 487, 33, 293, 33, 696, 33, 251, 33, 1042, 33, 583, 33, 40, 33, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 707, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 700, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 153, 0, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 232, 0, 234, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 706, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 222, 42, 382, 42, 1121, 42, 674, 42, 1060, 42, 1075, 42, 1106, 42, 1091, 42, 476, 48, 225, 48, 384, 48, 1123, 48, 676, 48, 1063, 48, 1077, 48, 1108, 48, 1093, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 886, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 881, 0, 885, 0, 883, 23, 882, 52, 884, 53, 196, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 796, 0, 791, 0, 786, 0, 783, 0, 788, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 692, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 705, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 69, 656, 69, 564, 69, 515, 69, 1157, 69, 548, 69, 715, 69, 426, 69, 529, 69, 273, 69, 819, 69, 102, 69, 129, 69, 440, 69, 846, 69, 83, 69, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 704, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 695, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 694, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 693, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 363, 79, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 230, 90, 389, 90, 1128, 90, 681, 90, 1068, 90, 1082, 90, 1113, 90, 1098, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 29, 1049, 29, 264, 31, 1055, 31, 993, 92, 481, 93, 1005, 94, 1006, 0, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 226, 24, 385, 24, 1124, 24, 677, 24, 1064, 24, 1078, 24, 1109, 24, 1094, 24, 228, 105, 387, 105, 1126, 105, 679, 105, 1066, 105, 1080, 105, 1111, 105, 1096, 105, 544, 106, 394, 106, 1133, 106, 686, 106, 1088, 106, 1087, 106, 1118, 106, 1103, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 1153, 110, 511, 111, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7, 690, 0, 691, 118, 689, 119, 655, 0, 204, 0, 793, 0, 779, 0, 402, 0] }, "pc/1.21.11": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 709, 2, 699, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 701, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 698, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 987, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 988, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 697, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 151, 0, 904, 0, 1e3, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 10, 19, 47, 19, 75, 19, 179, 19, 257, 19, 299, 19, 493, 19, 590, 19, 644, 19, 702, 19, 951, 19, 1048, 19, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 243, 22, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 703, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 708, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 696, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 707, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 700, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 153, 0, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 232, 0, 234, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 706, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 222, 42, 382, 42, 1121, 42, 674, 42, 1060, 42, 1075, 42, 1106, 42, 1091, 42, 476, 48, 225, 48, 384, 48, 1123, 48, 676, 48, 1063, 48, 1077, 48, 1108, 48, 1093, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 886, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 881, 0, 885, 0, 883, 23, 882, 52, 884, 53, 196, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 796, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 692, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 705, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 704, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 695, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 694, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 693, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 363, 79, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 230, 90, 389, 90, 1128, 90, 681, 90, 1068, 90, 1082, 90, 1113, 90, 1098, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 1005, 94, 1006, 0, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 226, 24, 385, 24, 1124, 24, 677, 24, 1064, 24, 1078, 24, 1109, 24, 1094, 24, 228, 105, 387, 105, 1126, 105, 679, 105, 1066, 105, 1080, 105, 1111, 105, 1096, 105, 544, 106, 394, 106, 1133, 106, 686, 106, 1088, 106, 1087, 106, 1118, 106, 1103, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 1153, 110, 511, 111, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7, 690, 0, 691, 118, 689, 119, 655, 0, 204, 0, 793, 0, 779, 0, 402, 0] }, "pc/1.21.9": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 709, 2, 699, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 701, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 698, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 987, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 988, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 697, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 151, 0, 904, 0, 1e3, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 10, 19, 47, 19, 75, 19, 179, 19, 257, 19, 299, 19, 493, 19, 590, 19, 644, 19, 702, 19, 951, 19, 1048, 19, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 243, 22, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 703, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 708, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 696, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 707, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 700, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 153, 0, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 232, 0, 234, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 706, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 222, 42, 382, 42, 1121, 42, 674, 42, 1060, 42, 1075, 42, 1106, 42, 1091, 42, 476, 48, 225, 48, 384, 48, 1123, 48, 676, 48, 1063, 48, 1077, 48, 1108, 48, 1093, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 886, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 881, 0, 885, 0, 883, 23, 882, 52, 884, 53, 196, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 796, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 692, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 705, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 704, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 695, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 694, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 693, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 363, 79, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 230, 90, 389, 90, 1128, 90, 681, 90, 1068, 90, 1082, 90, 1113, 90, 1098, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 1005, 94, 1006, 0, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 226, 24, 385, 24, 1124, 24, 677, 24, 1064, 24, 1078, 24, 1109, 24, 1094, 24, 228, 105, 387, 105, 1126, 105, 679, 105, 1066, 105, 1080, 105, 1111, 105, 1096, 105, 544, 106, 394, 106, 1133, 106, 686, 106, 1088, 106, 1087, 106, 1118, 106, 1103, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 1153, 110, 511, 111, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7, 690, 0, 691, 118, 689, 119, 655, 0, 204, 0, 793, 0, 779, 0, 402, 0] }, "pc/1.21.8": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 709, 2, 699, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 701, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 698, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 987, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 988, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 697, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 151, 0, 904, 0, 1e3, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 243, 22, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 703, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 708, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 696, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 707, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 700, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 153, 0, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 706, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 886, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 881, 0, 885, 0, 883, 23, 882, 52, 884, 53, 196, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 796, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 692, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 705, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 704, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 695, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 694, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 693, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 363, 79, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 1005, 94, 1006, 0, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 1153, 110, 511, 111, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7, 690, 0, 691, 118, 689, 119, 655, 0, 204, 0, 793, 0, 779, 0, 402, 0] }, "pc/1.21.6": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 709, 2, 699, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 701, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 698, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 987, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 988, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 697, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 151, 0, 904, 0, 1e3, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 243, 22, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 703, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 708, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 696, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 707, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 700, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 153, 0, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 706, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 886, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 881, 0, 885, 0, 883, 23, 882, 52, 884, 53, 196, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 796, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 692, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 705, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 704, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 695, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 694, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 693, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 363, 79, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 1005, 94, 1006, 0, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 1153, 110, 511, 111, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7, 690, 0, 691, 118, 689, 119, 655, 0, 204, 0, 793, 0, 779, 0, 402, 0] }, "pc/1.21.5": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 709, 2, 699, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 701, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 698, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 987, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 988, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 697, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 151, 0, 904, 0, 1e3, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 243, 22, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 703, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 708, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 696, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 707, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 700, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 153, 0, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 706, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 886, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 881, 0, 885, 0, 883, 23, 882, 52, 884, 53, 196, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 796, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 692, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 705, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 704, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 695, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 694, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 693, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 1005, 94, 1006, 0, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 1153, 110, 511, 111, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7, 690, 0, 691, 118, 689, 119, 655, 0, 204, 0, 793, 0, 779, 0, 402, 0] }, "pc/1.21.4": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 709, 2, 699, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 701, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 698, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 987, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 988, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 697, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 243, 124, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 703, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 708, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 696, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 707, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 700, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 706, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 886, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 881, 0, 885, 0, 883, 23, 882, 52, 884, 53, 196, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 796, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 692, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 705, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 704, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 695, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 694, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 693, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7, 690, 0, 691, 118, 689, 119, 655, 0, 204, 0, 793, 0, 779, 0] }, "pc/1.21.1": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7] }, "pc/1.20.2": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 673, 0, 1120, 0, 381, 0, 223, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114] }, "pc/1.20": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 579, 34, 36, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 713, 123, 714, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 0, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 673, 0, 1120, 0, 381, 0, 223, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114] }, "pc/1.19.2": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 586, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 585, 2, 589, 7, 617, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 983, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 128, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 591, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 596, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 587, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 594, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 579, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 593, 23, 911, 0, 55, 0, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 592, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 582, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 581, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 580, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 896, 0, 900, 50, 897, 102, 899, 103, 673, 0, 1120, 0, 381, 0, 223, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0] }, "pc/1.19": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 586, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 585, 2, 589, 7, 617, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 983, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 128, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 591, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 596, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 587, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 594, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 579, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 593, 23, 911, 0, 55, 0, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 592, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 582, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 581, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 580, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 896, 0, 900, 50, 897, 102, 899, 103, 673, 0, 1120, 0, 381, 0, 223, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0] }, "pc/1.18": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 639, 129, 946, 129, 70, 129, 488, 129, 5, 129, 294, 129, 32, 129, 406, 129, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 128, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 964, 0, 610, 0, 240, 0, 198, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 911, 0, 55, 0, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 673, 0, 1120, 0, 381, 0, 223, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0] }, "pc/1.17": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 639, 129, 946, 129, 70, 129, 488, 129, 5, 129, 294, 129, 32, 129, 406, 129, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 128, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 964, 0, 610, 0, 240, 0, 198, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 911, 0, 55, 0, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 673, 0, 1120, 0, 381, 0, 223, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0] }, "pc/1.16.2": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 478, 0, 206, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 639, 129, 946, 129, 70, 129, 488, 129, 5, 129, 294, 129, 939, 0, 1136, 0, 411, 0, 506, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 128, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 130, 350, 130, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 635, 30, 503, 31, 842, 131, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 874, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 964, 0, 610, 0, 240, 0, 198, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 637, 51, 126, 23, 962, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 132, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 130, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 911, 0, 55, 0, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 424, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 133, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0] }, "pc/1.16.1": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 478, 0, 206, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 639, 129, 946, 129, 70, 129, 488, 129, 5, 129, 294, 129, 939, 0, 1136, 0, 411, 0, 506, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 128, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 130, 350, 130, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 635, 30, 503, 31, 842, 131, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 874, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 964, 0, 610, 0, 240, 0, 198, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 7, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 637, 51, 126, 23, 962, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 132, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 130, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 911, 0, 55, 0, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 424, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 134, 933, 134, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 133, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0] }, "pc/1.15.2": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 478, 0, 206, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 639, 129, 946, 129, 70, 129, 488, 129, 5, 129, 294, 129, 939, 0, 1136, 0, 411, 0, 506, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 128, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 130, 350, 130, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 635, 30, 503, 31, 842, 131, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 874, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 964, 0, 610, 0, 240, 0, 198, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 637, 51, 126, 23, 962, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 132, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 135, 606, 135, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 130, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 911, 0, 55, 0, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 424, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 135, 816, 135, 864, 135, 609, 135, 421, 135, 963, 135, 623, 135, 27, 135, 858, 135, 894, 135, 377, 135, 356, 135, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 134, 157, 91, 999, 54, 993, 133, 481, 70, 220, 95, 59, 96, 60, 96, 459, 0, 460, 0] }, "pc/1.14.4": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 478, 0, 206, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 639, 129, 946, 129, 70, 129, 488, 129, 5, 129, 294, 129, 939, 0, 1136, 0, 411, 0, 506, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 128, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 130, 350, 130, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 635, 30, 503, 31, 842, 131, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 874, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 964, 0, 610, 0, 240, 0, 198, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 637, 51, 126, 23, 962, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 132, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 135, 606, 135, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 130, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 911, 0, 55, 0, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 424, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 135, 816, 135, 864, 135, 609, 135, 421, 135, 963, 135, 623, 135, 27, 135, 858, 135, 894, 135, 377, 135, 356, 135, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 136, 504, 134, 157, 91, 999, 54, 993, 133, 481, 70, 220, 95] }, "pc/1.13.2": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 478, 0, 206, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 639, 129, 946, 129, 70, 129, 488, 129, 5, 129, 294, 129, 939, 0, 1136, 0, 411, 0, 506, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 137, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 130, 350, 130, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 908, 121, 635, 30, 503, 31, 842, 131, 214, 23, 1035, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 874, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 964, 0, 610, 0, 240, 0, 198, 0, 138, 47, 855, 47, 618, 47, 474, 42, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 637, 51, 126, 23, 962, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 132, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 135, 606, 135, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 910, 20, 909, 123, 1156, 20, 1155, 123, 1172, 20, 1171, 123, 736, 20, 735, 123, 245, 20, 244, 123, 362, 20, 361, 123, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 130, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 911, 0, 55, 0, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 967, 52, 892, 52, 712, 52, 213, 52, 125, 52, 961, 52, 621, 52, 840, 52, 862, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 424, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 902, 82, 110, 0, 221, 80, 1034, 0, 164, 0, 145, 84, 993, 133] }, "pc/1.13": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 478, 0, 206, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 639, 129, 946, 129, 70, 129, 488, 129, 5, 129, 294, 129, 939, 0, 1136, 0, 411, 0, 506, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 137, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 130, 350, 130, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 0, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 908, 121, 635, 30, 503, 31, 842, 131, 214, 23, 1035, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 874, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 964, 0, 610, 0, 240, 0, 198, 0, 138, 47, 855, 47, 618, 47, 474, 42, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 637, 51, 126, 23, 962, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 132, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 135, 606, 135, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 910, 20, 909, 123, 1156, 20, 1155, 123, 1172, 20, 1171, 123, 736, 20, 735, 123, 245, 20, 244, 123, 362, 20, 361, 123, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 130, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 911, 0, 55, 0, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 967, 52, 892, 52, 712, 52, 213, 52, 125, 52, 961, 52, 621, 52, 840, 52, 862, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 424, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 1016, 0, 120, 0, 146, 0, 398, 0, 462, 0, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 902, 82, 110, 0, 221, 0, 1034, 0, 164, 0, 145, 84, 993, 133] }, "pc/1.12": { legacy: true, blocks: [1, 30, 2, 42, 3, 51, 5, 129, 6, 2, 7, 0, 9, 3, 12, 52, 13, 23, 17, 2, 18, 130, 19, 0, 20, 0, 24, 0, 28, 20, 33, 0, 55, 0, 57, 0, 58, 0, 61, 54, 66, 30, 67, 42, 68, 51, 70, 129, 71, 2, 72, 0, 74, 3, 77, 52, 78, 23, 82, 2, 87, 0, 88, 0, 89, 0, 90, 20, 91, 70, 92, 0, 93, 42, 94, 0, 96, 0, 106, 0, 107, 0, 108, 0, 109, 20, 111, 0, 112, 70, 113, 0, 114, 42, 115, 0, 117, 0, 118, 2, 119, 0, 124, 55, 125, 52, 126, 23, 128, 0, 133, 0, 134, 0, 135, 0, 136, 20, 137, 0, 138, 47, 139, 70, 140, 0, 141, 42, 142, 0, 144, 0, 152, 40, 154, 44, 160, 26, 162, 20, 163, 132, 168, 61, 187, 24, 188, 20, 194, 0, 195, 0, 197, 0, 198, 0, 201, 72, 202, 71, 203, 0, 205, 0, 206, 0, 207, 0, 212, 0, 213, 52, 214, 23, 215, 135, 216, 0, 217, 58, 218, 61, 219, 65, 240, 0, 242, 0, 269, 0, 271, 0, 277, 0, 278, 0, 279, 0, 280, 20, 281, 70, 282, 0, 283, 42, 284, 0, 286, 0, 287, 20, 288, 0, 290, 30, 291, 42, 292, 51, 294, 129, 295, 2, 296, 0, 298, 3, 301, 52, 302, 23, 306, 2, 307, 0, 310, 66, 319, 0, 350, 130, 351, 0, 352, 0, 353, 0, 357, 0, 359, 9, 360, 0, 366, 9, 367, 0, 368, 0, 369, 0, 370, 0, 371, 0, 372, 57, 373, 70, 374, 0, 378, 0, 379, 31, 395, 27, 396, 0, 397, 21, 404, 0, 408, 54, 409, 28, 411, 0, 412, 42, 414, 0, 415, 0, 416, 0, 418, 0, 422, 0, 423, 1, 424, 0, 425, 0, 430, 0, 431, 0, 432, 0, 433, 20, 434, 70, 435, 0, 436, 42, 437, 0, 439, 0, 444, 0, 445, 0, 446, 0, 447, 20, 448, 70, 449, 0, 450, 42, 451, 0, 453, 0, 456, 2, 458, 64, 461, 67, 466, 0, 467, 0, 468, 0, 469, 0, 471, 0, 472, 0, 473, 0, 474, 42, 475, 0, 477, 30, 478, 0, 479, 46, 480, 20, 482, 41, 484, 30, 485, 42, 486, 51, 488, 129, 489, 2, 490, 0, 492, 3, 495, 52, 496, 23, 500, 2, 503, 31, 505, 0, 506, 0, 508, 14, 509, 5, 513, 34, 519, 0, 520, 0, 521, 0, 522, 20, 523, 70, 524, 0, 525, 42, 526, 0, 528, 0, 533, 0, 534, 0, 535, 0, 536, 20, 537, 70, 538, 0, 539, 42, 540, 0, 542, 0, 543, 64, 545, 14, 547, 0, 552, 0, 553, 0, 554, 0, 555, 20, 556, 70, 557, 0, 558, 42, 559, 0, 561, 0, 568, 0, 569, 0, 570, 0, 571, 20, 572, 70, 573, 0, 574, 42, 575, 0, 577, 0, 578, 0, 599, 0, 600, 26, 603, 0, 606, 135, 610, 0, 611, 16, 618, 47, 619, 1, 620, 42, 621, 52, 622, 23, 624, 0, 626, 43, 627, 0, 629, 54, 630, 0, 632, 0, 633, 137, 634, 34, 635, 30, 636, 42, 637, 51, 639, 129, 640, 2, 641, 0, 642, 35, 643, 3, 646, 52, 647, 23, 648, 46, 651, 2, 652, 75, 653, 0, 660, 0, 661, 0, 662, 0, 663, 20, 664, 70, 665, 0, 666, 42, 667, 0, 668, 0, 670, 0, 671, 0, 687, 0, 711, 14, 712, 52, 719, 0, 720, 0, 721, 0, 722, 20, 724, 70, 725, 0, 726, 42, 727, 0, 728, 0, 730, 0, 731, 13, 732, 15, 737, 1, 739, 0, 757, 0, 760, 0, 767, 0, 768, 26, 769, 0, 770, 0, 774, 0, 775, 0, 776, 0, 777, 0, 783, 0, 784, 0, 785, 0, 786, 0, 789, 0, 792, 0, 798, 0, 799, 0, 801, 0, 809, 130, 810, 0, 813, 0, 818, 26, 823, 0, 824, 0, 825, 0, 826, 20, 827, 70, 828, 0, 829, 42, 830, 0, 832, 0, 833, 0, 834, 2, 835, 52, 836, 23, 837, 0, 839, 2, 840, 52, 841, 23, 842, 131, 847, 11, 850, 0, 851, 0, 852, 0, 853, 20, 854, 0, 855, 47, 859, 0, 860, 0, 861, 0, 862, 52, 863, 23, 865, 70, 866, 0, 867, 42, 868, 0, 869, 0, 871, 0, 872, 0, 873, 36, 874, 36, 875, 37, 876, 38, 877, 25, 879, 45, 880, 61, 889, 14, 890, 0, 891, 0, 892, 52, 893, 23, 901, 0, 908, 121, 909, 123, 910, 20, 911, 0, 917, 0, 920, 0, 923, 0, 926, 0, 929, 39, 930, 0, 934, 0, 938, 0, 939, 0, 942, 30, 943, 42, 944, 51, 946, 129, 947, 2, 948, 0, 950, 3, 953, 52, 954, 23, 958, 2, 959, 13, 960, 0, 961, 52, 962, 23, 964, 0, 965, 34, 966, 35, 967, 52, 993, 133, 994, 0, 995, 40, 996, 14, 1001, 14, 1004, 0, 1008, 17, 1009, 0, 1012, 24, 1014, 60, 1015, 59, 1033, 49, 1035, 31, 1036, 20, 1057, 5, 1136, 0, 1137, 26, 1138, 123, 1142, 0, 1143, 0, 1144, 0, 1145, 20, 1146, 70, 1147, 0, 1148, 42, 1149, 0, 1150, 0, 1151, 20, 1152, 0, 1161, 0, 1162, 0, 1163, 0, 1164, 20, 1165, 70, 1166, 0, 1167, 42, 1168, 0, 1170, 0] }, "pc/1.11": { legacy: true, blocks: [1, 30, 2, 42, 3, 51, 5, 129, 6, 2, 7, 0, 9, 3, 12, 52, 13, 23, 17, 2, 18, 130, 19, 0, 20, 0, 24, 0, 28, 20, 33, 0, 55, 0, 57, 0, 58, 0, 61, 54, 66, 30, 67, 42, 68, 51, 70, 129, 71, 2, 72, 0, 74, 3, 77, 52, 78, 23, 82, 2, 87, 0, 91, 70, 92, 0, 93, 42, 94, 0, 96, 0, 106, 0, 111, 0, 112, 70, 113, 0, 114, 42, 115, 0, 117, 0, 118, 2, 119, 0, 124, 55, 125, 52, 126, 23, 128, 0, 133, 0, 137, 0, 138, 47, 139, 70, 140, 0, 141, 42, 142, 0, 144, 0, 152, 40, 154, 44, 160, 26, 162, 20, 163, 132, 168, 61, 187, 24, 188, 20, 194, 0, 195, 0, 197, 0, 198, 0, 201, 72, 202, 71, 203, 0, 205, 0, 206, 0, 207, 0, 212, 0, 213, 52, 214, 23, 215, 135, 216, 0, 217, 58, 218, 61, 219, 65, 240, 0, 242, 0, 269, 0, 271, 0, 277, 0, 281, 70, 282, 0, 283, 42, 284, 0, 286, 0, 287, 20, 288, 0, 290, 30, 291, 42, 292, 51, 294, 129, 295, 2, 296, 0, 298, 3, 301, 52, 302, 23, 306, 2, 307, 0, 310, 66, 319, 0, 350, 130, 351, 0, 352, 0, 353, 0, 357, 0, 359, 9, 360, 0, 366, 9, 367, 0, 368, 0, 369, 0, 370, 0, 371, 0, 372, 57, 373, 70, 374, 0, 378, 0, 379, 31, 395, 27, 396, 0, 397, 21, 404, 0, 408, 54, 409, 28, 411, 0, 412, 42, 414, 0, 415, 0, 416, 0, 418, 0, 422, 0, 423, 1, 424, 0, 425, 0, 430, 0, 434, 70, 435, 0, 436, 42, 437, 0, 439, 0, 444, 0, 448, 70, 449, 0, 450, 42, 451, 0, 453, 0, 456, 2, 458, 64, 461, 67, 466, 0, 467, 0, 468, 0, 469, 0, 471, 0, 472, 0, 473, 0, 474, 42, 475, 0, 477, 30, 478, 0, 479, 46, 480, 20, 482, 41, 484, 30, 485, 42, 486, 51, 488, 129, 489, 2, 490, 0, 492, 3, 495, 52, 496, 23, 500, 2, 503, 31, 505, 0, 506, 0, 508, 14, 509, 5, 513, 34, 519, 0, 523, 70, 524, 0, 525, 42, 526, 0, 528, 0, 533, 0, 537, 70, 538, 0, 539, 42, 540, 0, 542, 0, 543, 64, 545, 14, 547, 0, 552, 0, 556, 70, 557, 0, 558, 42, 559, 0, 561, 0, 568, 0, 572, 70, 573, 0, 574, 42, 575, 0, 577, 0, 578, 0, 599, 0, 600, 26, 603, 0, 606, 135, 610, 0, 611, 16, 618, 47, 619, 1, 620, 42, 621, 52, 622, 23, 624, 0, 626, 43, 627, 0, 629, 54, 630, 0, 632, 0, 633, 137, 634, 34, 635, 30, 636, 42, 637, 51, 639, 129, 640, 2, 641, 0, 642, 35, 643, 3, 646, 52, 647, 23, 648, 46, 651, 2, 652, 75, 653, 0, 660, 0, 664, 70, 665, 0, 666, 42, 667, 0, 668, 0, 670, 0, 671, 0, 687, 0, 711, 14, 712, 52, 719, 0, 724, 70, 725, 0, 726, 42, 727, 0, 728, 0, 730, 0, 731, 13, 732, 15, 737, 1, 739, 0, 757, 0, 760, 0, 767, 0, 768, 26, 769, 0, 770, 0, 774, 0, 775, 0, 776, 0, 777, 0, 783, 0, 784, 0, 785, 0, 786, 0, 789, 0, 792, 0, 798, 0, 799, 0, 801, 0, 809, 130, 810, 0, 813, 0, 818, 26, 823, 0, 827, 70, 828, 0, 829, 42, 830, 0, 832, 0, 833, 0, 834, 2, 835, 52, 836, 23, 837, 0, 839, 2, 840, 52, 841, 23, 842, 131, 847, 11, 850, 0, 854, 0, 855, 47, 859, 0, 860, 0, 861, 0, 862, 52, 863, 23, 865, 70, 866, 0, 867, 42, 868, 0, 869, 0, 871, 0, 872, 0, 873, 36, 874, 36, 875, 37, 876, 38, 877, 25, 879, 45, 880, 61, 889, 14, 890, 0, 891, 0, 892, 52, 893, 23, 901, 0, 908, 121, 909, 123, 910, 20, 911, 0, 917, 0, 920, 0, 923, 0, 926, 0, 929, 39, 930, 0, 934, 0, 938, 0, 939, 0, 942, 30, 943, 42, 944, 51, 946, 129, 947, 2, 948, 0, 950, 3, 953, 52, 954, 23, 958, 2, 959, 13, 960, 0, 961, 52, 962, 23, 964, 0, 965, 34, 966, 35, 967, 52, 993, 133, 994, 0, 995, 40, 996, 14, 1001, 14, 1004, 0, 1008, 17, 1009, 0, 1012, 24, 1014, 60, 1015, 59, 1033, 49, 1035, 31, 1036, 20, 1057, 5, 1136, 0, 1137, 26, 1138, 123, 1142, 0, 1146, 70, 1147, 0, 1148, 42, 1149, 0, 1150, 0, 1151, 20, 1152, 0, 1161, 0, 1165, 70, 1166, 0, 1167, 42, 1168, 0, 1170, 0] }, "pc/1.10": { legacy: true, blocks: [1, 30, 2, 42, 3, 51, 5, 129, 6, 2, 7, 0, 9, 3, 12, 52, 13, 23, 17, 2, 18, 130, 19, 0, 20, 0, 24, 0, 28, 20, 33, 0, 55, 0, 57, 0, 58, 0, 61, 54, 66, 30, 67, 42, 68, 51, 70, 129, 71, 2, 72, 0, 74, 3, 77, 52, 78, 23, 82, 2, 87, 0, 92, 0, 93, 42, 94, 0, 96, 0, 106, 0, 111, 0, 113, 0, 114, 42, 115, 0, 117, 0, 118, 2, 119, 0, 124, 55, 125, 52, 126, 23, 128, 0, 133, 0, 137, 0, 138, 47, 140, 0, 141, 42, 142, 0, 144, 0, 152, 40, 154, 44, 160, 26, 162, 20, 163, 132, 168, 61, 187, 24, 188, 20, 194, 0, 195, 0, 197, 0, 198, 0, 201, 72, 202, 71, 203, 0, 205, 0, 206, 0, 207, 0, 212, 0, 213, 52, 214, 23, 215, 135, 216, 0, 217, 58, 218, 61, 219, 65, 240, 0, 242, 0, 269, 0, 271, 0, 277, 0, 282, 0, 283, 42, 284, 0, 286, 0, 287, 20, 288, 0, 290, 30, 291, 42, 292, 51, 294, 129, 295, 2, 296, 0, 298, 3, 301, 52, 302, 23, 306, 2, 307, 0, 310, 66, 319, 0, 350, 130, 351, 0, 352, 0, 353, 0, 357, 0, 359, 9, 360, 0, 366, 9, 367, 0, 368, 0, 369, 0, 370, 0, 371, 0, 372, 57, 373, 70, 374, 0, 378, 0, 379, 31, 395, 27, 396, 0, 397, 21, 404, 0, 408, 54, 409, 28, 411, 0, 412, 42, 414, 0, 415, 0, 416, 0, 418, 0, 422, 0, 423, 1, 424, 0, 425, 0, 430, 0, 435, 0, 436, 42, 437, 0, 439, 0, 444, 0, 449, 0, 450, 42, 451, 0, 453, 0, 456, 2, 458, 64, 461, 67, 466, 0, 467, 0, 468, 0, 469, 0, 471, 0, 472, 0, 473, 0, 474, 42, 475, 0, 477, 30, 478, 0, 479, 46, 480, 20, 482, 41, 484, 30, 485, 42, 486, 51, 488, 129, 489, 2, 490, 0, 492, 3, 495, 52, 496, 23, 500, 2, 503, 31, 505, 0, 506, 0, 508, 14, 509, 5, 513, 34, 519, 0, 524, 0, 525, 42, 526, 0, 528, 0, 533, 0, 538, 0, 539, 42, 540, 0, 542, 0, 543, 64, 545, 14, 547, 0, 552, 0, 557, 0, 558, 42, 559, 0, 561, 0, 568, 0, 573, 0, 574, 42, 575, 0, 577, 0, 578, 0, 599, 0, 600, 26, 603, 0, 606, 135, 610, 0, 611, 16, 618, 47, 619, 1, 620, 42, 621, 52, 622, 23, 624, 0, 626, 43, 627, 0, 629, 54, 630, 0, 632, 0, 633, 137, 634, 34, 635, 30, 636, 42, 637, 51, 639, 129, 640, 2, 641, 0, 642, 35, 643, 3, 646, 52, 647, 23, 648, 46, 651, 2, 653, 0, 660, 0, 665, 0, 666, 42, 667, 0, 668, 0, 670, 0, 671, 0, 687, 0, 711, 14, 712, 52, 719, 0, 725, 0, 726, 42, 727, 0, 728, 0, 730, 0, 731, 13, 732, 15, 737, 1, 739, 0, 757, 0, 760, 0, 767, 0, 768, 26, 769, 0, 770, 0, 774, 0, 775, 0, 776, 0, 777, 0, 783, 0, 784, 0, 785, 0, 786, 0, 789, 0, 792, 0, 798, 0, 799, 0, 801, 0, 809, 130, 810, 0, 813, 0, 818, 26, 823, 0, 828, 0, 829, 42, 830, 0, 832, 0, 833, 0, 834, 2, 835, 52, 836, 23, 837, 0, 839, 2, 840, 52, 841, 23, 842, 131, 847, 11, 850, 0, 854, 0, 855, 47, 859, 0, 860, 0, 861, 0, 862, 52, 863, 23, 866, 0, 867, 42, 868, 0, 869, 0, 871, 0, 872, 0, 873, 36, 874, 36, 875, 37, 876, 38, 877, 25, 879, 45, 880, 61, 889, 14, 890, 0, 891, 0, 892, 52, 893, 23, 901, 0, 908, 121, 909, 123, 910, 20, 911, 0, 917, 0, 920, 0, 923, 0, 926, 0, 929, 39, 930, 0, 934, 0, 938, 0, 939, 0, 942, 30, 943, 42, 944, 51, 946, 129, 947, 2, 948, 0, 950, 3, 953, 52, 954, 23, 958, 2, 959, 13, 960, 0, 961, 52, 962, 23, 964, 0, 965, 34, 966, 35, 967, 52, 993, 133, 994, 0, 995, 40, 996, 14, 1001, 14, 1004, 0, 1008, 17, 1009, 0, 1012, 24, 1014, 60, 1015, 59, 1033, 49, 1035, 31, 1036, 20, 1057, 5, 1136, 0, 1137, 26, 1138, 123, 1142, 0, 1147, 0, 1148, 42, 1149, 0, 1150, 0, 1151, 20, 1152, 0, 1161, 0, 1166, 0, 1167, 42, 1168, 0, 1170, 0] }, "pc/1.9": { legacy: true, blocks: [1, 30, 2, 42, 3, 51, 5, 129, 6, 2, 7, 0, 9, 3, 12, 52, 13, 23, 17, 2, 18, 130, 19, 0, 20, 0, 24, 0, 28, 20, 33, 0, 55, 0, 57, 0, 58, 0, 61, 54, 66, 30, 67, 42, 68, 51, 70, 129, 71, 2, 72, 0, 74, 3, 77, 52, 78, 23, 82, 2, 87, 0, 92, 0, 93, 42, 94, 0, 96, 0, 106, 0, 111, 0, 113, 0, 114, 42, 115, 0, 117, 0, 119, 0, 124, 55, 125, 52, 126, 23, 128, 0, 133, 0, 137, 0, 138, 47, 140, 0, 141, 42, 142, 0, 144, 0, 152, 40, 154, 44, 160, 26, 162, 20, 163, 132, 168, 61, 187, 24, 188, 20, 194, 0, 195, 0, 197, 0, 198, 0, 201, 72, 202, 71, 203, 0, 205, 0, 206, 0, 207, 0, 212, 0, 213, 52, 214, 23, 215, 135, 216, 0, 217, 58, 218, 61, 219, 65, 240, 0, 242, 0, 269, 0, 271, 0, 277, 0, 282, 0, 283, 42, 284, 0, 286, 0, 287, 20, 288, 0, 290, 30, 291, 42, 292, 51, 294, 129, 295, 2, 296, 0, 298, 3, 301, 52, 302, 23, 306, 2, 307, 0, 310, 66, 319, 0, 350, 130, 351, 0, 352, 0, 353, 0, 357, 0, 359, 9, 360, 0, 366, 9, 367, 0, 368, 0, 369, 0, 370, 0, 371, 0, 372, 57, 373, 70, 374, 0, 378, 0, 379, 31, 395, 27, 396, 0, 397, 21, 404, 0, 408, 54, 409, 28, 411, 0, 412, 42, 414, 0, 415, 0, 416, 0, 418, 0, 422, 0, 423, 1, 424, 0, 425, 0, 430, 0, 435, 0, 436, 42, 437, 0, 439, 0, 444, 0, 449, 0, 450, 42, 451, 0, 453, 0, 456, 2, 458, 64, 461, 67, 466, 0, 467, 0, 468, 0, 469, 0, 471, 0, 472, 0, 473, 0, 474, 42, 475, 0, 477, 30, 478, 0, 479, 46, 480, 20, 482, 41, 484, 30, 485, 42, 486, 51, 488, 129, 489, 2, 490, 0, 492, 3, 495, 52, 496, 23, 500, 2, 503, 31, 505, 0, 506, 0, 508, 14, 509, 5, 513, 34, 519, 0, 524, 0, 525, 42, 526, 0, 528, 0, 533, 0, 538, 0, 539, 42, 540, 0, 542, 0, 543, 64, 545, 14, 547, 0, 552, 0, 557, 0, 558, 42, 559, 0, 561, 0, 568, 0, 573, 0, 574, 42, 575, 0, 577, 0, 599, 0, 600, 26, 603, 0, 606, 135, 610, 0, 611, 16, 618, 47, 619, 1, 620, 42, 621, 52, 622, 23, 624, 0, 626, 43, 627, 0, 629, 54, 632, 0, 633, 137, 634, 34, 635, 30, 636, 42, 637, 51, 639, 129, 640, 2, 641, 0, 642, 35, 643, 3, 646, 52, 647, 23, 648, 46, 651, 2, 653, 0, 660, 0, 665, 0, 666, 42, 667, 0, 668, 0, 670, 0, 671, 0, 687, 0, 711, 14, 712, 52, 719, 0, 725, 0, 726, 42, 727, 0, 728, 0, 730, 0, 731, 13, 732, 15, 737, 1, 739, 0, 757, 0, 760, 0, 767, 0, 768, 26, 769, 0, 770, 0, 774, 0, 775, 0, 776, 0, 777, 0, 783, 0, 784, 0, 785, 0, 786, 0, 789, 0, 792, 0, 798, 0, 799, 0, 801, 0, 809, 130, 810, 0, 813, 0, 818, 26, 823, 0, 828, 0, 829, 42, 830, 0, 832, 0, 833, 0, 834, 2, 835, 52, 836, 23, 837, 0, 839, 2, 840, 52, 841, 23, 842, 131, 847, 11, 850, 0, 854, 0, 855, 47, 860, 0, 861, 0, 862, 52, 863, 23, 866, 0, 867, 42, 868, 0, 869, 0, 871, 0, 872, 0, 873, 36, 874, 36, 875, 37, 876, 38, 877, 25, 879, 45, 880, 61, 889, 14, 890, 0, 891, 0, 892, 52, 893, 23, 901, 0, 908, 121, 909, 123, 910, 20, 911, 0, 917, 0, 920, 0, 923, 0, 926, 0, 929, 39, 930, 0, 934, 0, 938, 0, 939, 0, 942, 30, 943, 42, 944, 51, 946, 129, 947, 2, 948, 0, 950, 3, 953, 52, 954, 23, 958, 2, 959, 13, 960, 0, 961, 52, 962, 23, 964, 0, 965, 34, 966, 35, 967, 52, 993, 133, 995, 40, 996, 14, 1001, 14, 1004, 0, 1008, 17, 1009, 0, 1012, 24, 1014, 60, 1015, 59, 1033, 49, 1035, 31, 1036, 20, 1057, 5, 1136, 0, 1137, 26, 1138, 123, 1142, 0, 1147, 0, 1148, 42, 1149, 0, 1150, 0, 1151, 20, 1152, 0, 1161, 0, 1166, 0, 1167, 42, 1168, 0, 1170, 0] }, "pc/1.8": { legacy: true, blocks: [1, 30, 2, 42, 3, 51, 5, 129, 6, 2, 7, 0, 9, 3, 12, 52, 13, 23, 17, 2, 18, 130, 19, 0, 20, 0, 24, 0, 28, 20, 33, 0, 55, 0, 57, 0, 58, 0, 66, 30, 67, 42, 68, 51, 70, 129, 71, 2, 72, 0, 74, 3, 77, 52, 78, 23, 82, 2, 87, 0, 92, 0, 93, 42, 94, 0, 96, 0, 106, 0, 111, 0, 113, 0, 114, 42, 115, 0, 117, 0, 119, 0, 124, 55, 125, 52, 126, 23, 128, 0, 133, 0, 137, 0, 138, 47, 140, 0, 141, 42, 142, 0, 144, 0, 152, 40, 154, 44, 160, 26, 162, 20, 163, 132, 187, 24, 188, 20, 194, 0, 195, 0, 197, 0, 198, 0, 203, 0, 205, 0, 206, 0, 207, 0, 212, 0, 213, 52, 214, 23, 215, 135, 216, 0, 217, 58, 218, 61, 219, 65, 240, 0, 242, 0, 269, 0, 271, 0, 277, 0, 282, 0, 283, 42, 284, 0, 286, 0, 287, 20, 288, 0, 290, 30, 291, 42, 292, 51, 294, 129, 295, 2, 296, 0, 298, 3, 301, 52, 302, 23, 306, 2, 307, 0, 310, 66, 319, 0, 350, 130, 351, 0, 352, 0, 353, 0, 357, 0, 359, 9, 360, 0, 366, 9, 367, 0, 368, 0, 369, 0, 371, 0, 372, 57, 374, 0, 379, 31, 395, 27, 396, 0, 397, 21, 404, 0, 409, 28, 411, 0, 412, 42, 414, 0, 415, 0, 416, 0, 418, 0, 422, 0, 423, 1, 425, 0, 430, 0, 435, 0, 436, 42, 437, 0, 439, 0, 444, 0, 449, 0, 450, 42, 451, 0, 453, 0, 456, 2, 458, 64, 461, 67, 466, 0, 467, 0, 468, 0, 469, 0, 471, 0, 472, 0, 473, 0, 474, 42, 475, 0, 477, 30, 478, 0, 479, 46, 480, 20, 482, 41, 484, 30, 485, 42, 486, 51, 488, 129, 489, 2, 490, 0, 492, 3, 495, 52, 496, 23, 500, 2, 503, 31, 505, 0, 506, 0, 508, 14, 509, 5, 513, 34, 519, 0, 524, 0, 525, 42, 526, 0, 528, 0, 533, 0, 538, 0, 539, 42, 540, 0, 542, 0, 543, 64, 545, 14, 547, 0, 552, 0, 557, 0, 558, 42, 559, 0, 561, 0, 568, 0, 573, 0, 574, 42, 575, 0, 577, 0, 599, 0, 600, 26, 603, 0, 606, 135, 610, 0, 611, 16, 618, 47, 619, 1, 620, 42, 621, 52, 622, 23, 624, 0, 626, 43, 627, 0, 629, 54, 632, 0, 633, 137, 634, 34, 635, 30, 636, 42, 637, 51, 639, 129, 640, 2, 641, 0, 642, 35, 643, 3, 646, 52, 647, 23, 648, 46, 651, 2, 653, 0, 660, 0, 665, 0, 666, 42, 667, 0, 668, 0, 670, 0, 671, 0, 687, 0, 711, 14, 712, 52, 719, 0, 725, 0, 726, 42, 727, 0, 728, 0, 730, 0, 731, 13, 732, 15, 737, 1, 739, 0, 757, 0, 760, 0, 767, 0, 768, 26, 769, 0, 770, 0, 774, 0, 775, 0, 776, 0, 777, 0, 783, 0, 784, 0, 785, 0, 786, 0, 789, 0, 792, 0, 798, 0, 799, 0, 801, 0, 809, 130, 810, 0, 813, 0, 818, 26, 823, 0, 828, 0, 829, 42, 830, 0, 832, 0, 837, 0, 839, 2, 840, 52, 841, 23, 842, 131, 847, 11, 850, 0, 854, 0, 855, 47, 860, 0, 861, 0, 862, 52, 863, 23, 866, 0, 867, 42, 868, 0, 869, 0, 871, 0, 872, 0, 873, 36, 874, 36, 875, 37, 876, 38, 877, 25, 879, 45, 889, 14, 890, 0, 891, 0, 892, 52, 893, 23, 901, 0, 908, 121, 909, 123, 910, 20, 911, 0, 917, 0, 920, 0, 923, 0, 926, 0, 929, 39, 930, 0, 934, 0, 938, 0, 939, 0, 942, 30, 943, 42, 944, 51, 946, 129, 947, 2, 948, 0, 950, 3, 953, 52, 954, 23, 958, 2, 959, 13, 960, 0, 961, 52, 962, 23, 964, 0, 965, 34, 966, 35, 967, 52, 995, 40, 996, 14, 1001, 14, 1004, 0, 1008, 17, 1009, 0, 1012, 24, 1014, 60, 1015, 59, 1033, 49, 1035, 31, 1036, 20, 1057, 5, 1136, 0, 1137, 26, 1138, 123, 1142, 0, 1147, 0, 1148, 42, 1149, 0, 1150, 0, 1151, 20, 1152, 0, 1161, 0, 1166, 0, 1167, 42, 1168, 0, 1170, 0] }, "pc/1.21.3~released": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7] }, "pc/1.21.1~released": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 1025, 52, 1026, 23, 1027, 53, 763, 0, 764, 52, 765, 23, 766, 53, 199, 0, 1024, 0, 1021, 52, 1022, 23, 1023, 53, 200, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 672, 0, 1119, 0, 380, 0, 190, 0, 1089, 0, 1104, 0, 1073, 0, 1059, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 227, 30, 386, 30, 678, 30, 1125, 30, 1065, 30, 1079, 30, 1095, 30, 1110, 30, 233, 46, 390, 46, 682, 46, 1129, 46, 1069, 46, 1083, 46, 1099, 46, 1114, 46, 229, 7, 388, 7, 1127, 7, 680, 7, 1067, 7, 1081, 7, 1112, 7, 1097, 7, 224, 104, 383, 104, 1122, 104, 675, 104, 1062, 104, 1076, 104, 1107, 104, 1092, 104, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114, 241, 115, 1013, 116, 1031, 117, 457, 7] }, "pc/1.20.5~released": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114] }, "pc/1.20.4~released": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114] }, "pc/1.20.3~released": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 176, 0, 296, 0, 586, 0, 44, 0, 41, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 178, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 998, 6, 860, 0, 425, 0, 997, 6, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 175, 2, 295, 2, 585, 2, 589, 7, 617, 2, 35, 2, 989, 2, 973, 2, 981, 2, 970, 2, 975, 2, 979, 2, 985, 2, 983, 2, 972, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 186, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 976, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 174, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 905, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 1010, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 189, 18, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 180, 121, 494, 121, 300, 121, 591, 121, 48, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 185, 31, 499, 31, 305, 31, 596, 31, 53, 31, 638, 122, 945, 122, 69, 122, 4, 122, 173, 122, 487, 122, 293, 122, 251, 122, 1042, 122, 583, 122, 40, 122, 649, 31, 956, 31, 80, 31, 15, 31, 184, 31, 498, 31, 304, 31, 595, 31, 263, 31, 1054, 31, 52, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 177, 35, 297, 35, 587, 35, 45, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 183, 46, 303, 46, 594, 46, 51, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 817, 0, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 802, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 778, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 169, 34, 289, 34, 579, 34, 36, 34, 909, 62, 910, 63, 1155, 62, 1156, 63, 1171, 62, 1172, 63, 735, 62, 736, 63, 244, 62, 245, 63, 361, 62, 362, 63, 713, 62, 714, 63, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 182, 23, 302, 23, 593, 23, 50, 23, 43, 23, 911, 0, 55, 7, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 181, 52, 301, 52, 592, 52, 49, 52, 42, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 172, 51, 292, 51, 582, 51, 39, 51, 943, 42, 67, 42, 485, 42, 2, 42, 171, 42, 291, 42, 581, 42, 38, 42, 942, 30, 66, 30, 484, 30, 1, 30, 170, 30, 290, 30, 580, 30, 37, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 1011, 73, 733, 74, 734, 14, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 928, 78, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 156, 101, 896, 0, 900, 50, 897, 102, 899, 103, 223, 0, 381, 0, 1120, 0, 673, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 723, 110, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0, 332, 114] }, "pc/1.19.4~released": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 586, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 585, 2, 589, 7, 617, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 983, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 591, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 596, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 587, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 594, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 579, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 593, 23, 911, 0, 55, 0, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 592, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 582, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 581, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 580, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 896, 0, 900, 50, 897, 102, 899, 103, 673, 0, 1120, 0, 381, 0, 223, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0] }, "pc/1.19.3~released": { legacy: false, blocks: [19, 0, 960, 0, 418, 0, 760, 0, 353, 0, 757, 0, 24, 0, 739, 0, 423, 1, 357, 0, 207, 0, 737, 1, 212, 0, 641, 0, 948, 0, 72, 0, 490, 0, 7, 0, 296, 0, 586, 0, 643, 3, 950, 3, 74, 3, 492, 3, 9, 3, 298, 3, 588, 4, 58, 0, 1057, 5, 509, 5, 890, 0, 860, 0, 425, 0, 416, 0, 342, 0, 478, 0, 343, 0, 206, 0, 338, 0, 625, 0, 640, 2, 947, 2, 71, 2, 489, 2, 6, 2, 295, 2, 585, 2, 589, 7, 617, 2, 989, 2, 973, 2, 981, 2, 970, 2, 979, 2, 985, 2, 983, 2, 651, 2, 958, 2, 82, 2, 500, 2, 17, 2, 306, 2, 597, 2, 986, 2, 990, 2, 974, 2, 982, 2, 971, 2, 980, 2, 984, 2, 639, 8, 946, 8, 70, 8, 488, 8, 5, 8, 294, 8, 584, 8, 32, 8, 406, 8, 939, 0, 1136, 0, 411, 0, 506, 0, 344, 0, 505, 0, 359, 9, 891, 0, 197, 0, 271, 0, 633, 120, 1139, 11, 657, 11, 565, 11, 516, 11, 1158, 11, 549, 11, 716, 11, 427, 11, 530, 11, 274, 11, 820, 11, 103, 11, 130, 11, 441, 11, 847, 11, 84, 11, 809, 12, 350, 12, 959, 13, 216, 0, 422, 0, 396, 0, 319, 0, 903, 0, 1002, 14, 731, 13, 732, 15, 1152, 0, 670, 0, 577, 0, 528, 0, 1170, 0, 561, 0, 730, 0, 439, 0, 542, 0, 286, 0, 832, 0, 117, 0, 144, 0, 453, 0, 871, 0, 96, 0, 611, 16, 288, 0, 767, 0, 111, 0, 20, 0, 33, 0, 869, 0, 668, 0, 1150, 0, 728, 0, 671, 0, 235, 0, 1154, 0, 546, 0, 137, 0, 854, 0, 415, 0, 475, 0, 128, 0, 1008, 17, 119, 0, 603, 0, 653, 0, 1009, 0, 1036, 20, 397, 21, 932, 0, 938, 0, 647, 23, 187, 24, 877, 25, 352, 0, 340, 0, 351, 0, 242, 0, 1137, 26, 395, 27, 409, 28, 645, 121, 952, 121, 76, 121, 11, 121, 494, 121, 300, 121, 591, 121, 635, 30, 503, 31, 842, 32, 214, 23, 650, 31, 957, 31, 81, 31, 16, 31, 499, 31, 305, 31, 596, 31, 513, 34, 966, 35, 477, 30, 642, 35, 949, 35, 73, 35, 491, 35, 8, 35, 297, 35, 587, 35, 874, 36, 345, 36, 875, 37, 876, 38, 965, 34, 929, 39, 466, 0, 930, 0, 152, 40, 203, 0, 995, 40, 482, 41, 636, 42, 817, 0, 632, 0, 934, 0, 935, 0, 56, 2, 742, 2, 936, 0, 937, 20, 414, 0, 626, 43, 162, 20, 480, 20, 154, 44, 879, 45, 1147, 0, 665, 0, 573, 0, 524, 0, 1166, 0, 557, 0, 725, 0, 435, 0, 538, 0, 282, 0, 828, 0, 113, 0, 140, 0, 449, 0, 866, 0, 92, 0, 648, 46, 955, 46, 79, 46, 497, 46, 14, 46, 303, 46, 594, 46, 964, 0, 610, 0, 240, 0, 198, 0, 688, 0, 616, 0, 472, 0, 468, 0, 473, 0, 471, 0, 469, 0, 467, 0, 138, 47, 855, 47, 618, 47, 474, 42, 167, 48, 412, 42, 599, 0, 30, 20, 29, 20, 818, 26, 600, 26, 1033, 49, 413, 50, 637, 51, 126, 23, 962, 23, 614, 23, 619, 1, 547, 0, 624, 0, 620, 42, 622, 23, 629, 54, 369, 0, 124, 55, 163, 0, 1058, 56, 510, 0, 808, 56, 371, 0, 372, 57, 374, 0, 360, 0, 873, 36, 217, 58, 893, 23, 368, 0, 341, 0, 379, 31, 1015, 59, 1014, 60, 367, 0, 954, 23, 78, 23, 496, 23, 218, 61, 57, 0, 215, 53, 606, 53, 404, 0, 792, 0, 801, 0, 774, 0, 789, 0, 769, 0, 784, 0, 791, 0, 786, 0, 783, 0, 798, 0, 775, 0, 770, 0, 772, 0, 800, 0, 794, 0, 805, 0, 797, 0, 795, 0, 780, 0, 790, 0, 806, 0, 799, 0, 776, 0, 785, 0, 777, 0, 160, 26, 768, 26, 634, 34, 941, 34, 65, 34, 483, 34, 0, 34, 289, 34, 579, 34, 909, 123, 910, 20, 1155, 123, 1156, 20, 1171, 123, 1172, 20, 735, 123, 736, 20, 244, 123, 245, 20, 361, 123, 362, 20, 28, 20, 188, 20, 287, 20, 1012, 24, 543, 64, 458, 64, 219, 65, 310, 66, 872, 0, 627, 0, 461, 67, 837, 0, 194, 0, 839, 2, 841, 23, 18, 12, 366, 9, 1149, 0, 667, 0, 575, 0, 526, 0, 1168, 0, 559, 0, 727, 0, 437, 0, 540, 0, 284, 0, 830, 0, 115, 0, 142, 0, 451, 0, 868, 0, 94, 0, 1148, 42, 666, 42, 574, 42, 525, 42, 1167, 42, 558, 42, 726, 42, 436, 42, 539, 42, 283, 42, 829, 42, 114, 42, 141, 42, 450, 42, 867, 42, 93, 42, 13, 23, 302, 23, 593, 23, 911, 0, 55, 0, 514, 68, 479, 46, 810, 0, 813, 0, 307, 0, 815, 23, 812, 23, 309, 23, 814, 52, 811, 52, 308, 52, 901, 0, 456, 2, 1142, 0, 660, 0, 568, 0, 519, 0, 1161, 0, 552, 0, 719, 0, 430, 0, 533, 0, 277, 0, 823, 0, 106, 0, 133, 0, 444, 0, 850, 0, 87, 0, 1004, 0, 205, 0, 687, 0, 996, 14, 545, 14, 889, 14, 711, 14, 1001, 14, 508, 14, 1138, 123, 656, 123, 564, 123, 515, 123, 1157, 123, 548, 123, 715, 123, 426, 123, 529, 123, 273, 123, 819, 123, 102, 123, 129, 123, 440, 123, 846, 123, 83, 123, 1151, 20, 669, 20, 576, 20, 527, 20, 1169, 20, 560, 20, 729, 20, 438, 20, 541, 20, 285, 20, 831, 20, 116, 20, 143, 20, 452, 20, 870, 20, 95, 20, 861, 0, 195, 0, 269, 0, 863, 23, 646, 52, 953, 52, 77, 52, 495, 52, 12, 52, 301, 52, 592, 52, 967, 52, 927, 52, 892, 52, 272, 52, 712, 52, 213, 52, 125, 52, 961, 52, 613, 52, 621, 52, 840, 52, 862, 52, 270, 52, 835, 52, 926, 0, 923, 0, 917, 0, 920, 0, 944, 51, 68, 51, 486, 51, 3, 51, 292, 51, 582, 51, 943, 42, 67, 42, 485, 42, 2, 42, 291, 42, 581, 42, 942, 30, 66, 30, 484, 30, 1, 30, 290, 30, 580, 30, 373, 70, 202, 71, 201, 72, 833, 0, 834, 2, 836, 23, 378, 0, 61, 54, 358, 0, 370, 0, 880, 61, 168, 61, 408, 54, 578, 0, 630, 0, 859, 0, 118, 2, 994, 0, 652, 75, 907, 70, 1146, 70, 664, 70, 572, 70, 523, 70, 1165, 70, 556, 70, 724, 70, 434, 70, 537, 70, 281, 70, 827, 70, 112, 70, 139, 70, 448, 70, 865, 70, 91, 70, 1145, 20, 663, 20, 571, 20, 522, 20, 1164, 20, 555, 20, 722, 20, 433, 20, 536, 20, 280, 20, 826, 20, 109, 20, 136, 20, 447, 20, 853, 20, 90, 20, 1143, 0, 661, 0, 569, 0, 520, 0, 1162, 0, 553, 0, 720, 0, 431, 0, 534, 0, 278, 0, 824, 0, 107, 0, 134, 0, 445, 0, 851, 0, 88, 0, 1144, 0, 662, 0, 570, 0, 521, 0, 1163, 0, 554, 0, 721, 0, 432, 0, 535, 0, 279, 0, 825, 0, 108, 0, 135, 0, 446, 0, 852, 0, 89, 0, 501, 76, 502, 0, 364, 0, 1028, 77, 329, 0, 312, 0, 316, 0, 321, 0, 325, 0, 1017, 0, 121, 0, 147, 0, 399, 0, 463, 0, 328, 80, 311, 80, 315, 80, 320, 80, 324, 80, 1016, 80, 120, 80, 146, 80, 398, 80, 462, 80, 330, 80, 313, 80, 317, 80, 322, 80, 326, 80, 1018, 80, 122, 80, 148, 80, 400, 80, 464, 80, 331, 81, 314, 81, 318, 81, 323, 81, 327, 81, 1019, 81, 123, 81, 149, 81, 401, 81, 465, 81, 902, 82, 110, 0, 221, 80, 46, 0, 34, 83, 773, 0, 1034, 0, 164, 0, 145, 84, 762, 23, 922, 23, 608, 23, 759, 23, 605, 23, 376, 23, 968, 23, 925, 23, 919, 23, 420, 23, 26, 23, 857, 23, 741, 23, 355, 23, 761, 52, 921, 52, 607, 52, 758, 52, 604, 52, 375, 52, 924, 52, 918, 52, 419, 52, 25, 52, 856, 52, 740, 52, 354, 52, 127, 53, 816, 53, 864, 53, 609, 53, 421, 53, 963, 53, 615, 53, 623, 53, 27, 53, 858, 53, 894, 53, 377, 53, 356, 53, 895, 85, 563, 20, 54, 86, 915, 28, 101, 28, 161, 0, 403, 0, 454, 87, 512, 88, 914, 0, 969, 20, 62, 89, 504, 90, 933, 90, 157, 91, 931, 91, 999, 54, 1052, 2, 992, 2, 1043, 2, 991, 2, 1044, 0, 1041, 0, 1056, 0, 1047, 0, 628, 0, 261, 2, 978, 2, 252, 2, 977, 2, 253, 0, 250, 0, 906, 0, 1134, 76, 1135, 0, 1029, 76, 1030, 0, 256, 0, 254, 0, 1045, 0, 259, 52, 1050, 52, 255, 35, 1046, 35, 248, 42, 1039, 42, 262, 46, 1053, 46, 249, 51, 1040, 51, 260, 23, 1051, 23, 246, 34, 1037, 34, 247, 30, 1038, 30, 258, 121, 1049, 121, 264, 31, 1055, 31, 993, 92, 481, 93, 220, 95, 1003, 64, 59, 96, 60, 96, 459, 0, 460, 0, 631, 0, 23, 0, 265, 0, 887, 97, 781, 0, 803, 0, 782, 0, 804, 0, 562, 0, 97, 0, 99, 23, 100, 53, 98, 52, 743, 0, 747, 0, 239, 0, 193, 0, 744, 52, 745, 23, 746, 53, 410, 0, 751, 23, 750, 52, 749, 35, 748, 34, 752, 53, 192, 0, 238, 0, 838, 0, 158, 98, 1140, 98, 658, 98, 566, 98, 517, 98, 1159, 98, 550, 98, 717, 98, 428, 98, 531, 98, 275, 98, 821, 98, 104, 98, 131, 98, 442, 98, 848, 98, 85, 98, 159, 36, 1141, 36, 659, 36, 567, 36, 518, 36, 1160, 36, 551, 36, 718, 36, 429, 36, 532, 36, 276, 36, 822, 36, 105, 36, 132, 36, 443, 36, 849, 36, 86, 36, 21, 0, 150, 0, 22, 99, 507, 99, 598, 99, 912, 99, 1020, 0, 155, 0, 1007, 0, 807, 0, 898, 100, 896, 0, 900, 50, 897, 102, 899, 103, 673, 0, 1120, 0, 381, 0, 223, 0, 231, 0, 339, 0, 683, 0, 1130, 0, 391, 0, 266, 0, 685, 23, 1132, 23, 393, 23, 268, 23, 684, 52, 1131, 52, 392, 52, 267, 52, 1061, 0, 1105, 0, 1074, 0, 1090, 0, 1100, 0, 1115, 0, 1084, 0, 1070, 0, 1102, 23, 1117, 23, 1086, 23, 1072, 23, 1101, 52, 1116, 52, 1085, 52, 1071, 52, 544, 106, 738, 107, 365, 0, 165, 108, 166, 109, 940, 0, 31, 0, 405, 0, 602, 0, 601, 0, 63, 112, 64, 31, 913, 113, 455, 7, 888, 0, 612, 0, 333, 2, 208, 0, 210, 23, 209, 52, 211, 53, 753, 0, 755, 23, 754, 52, 756, 53, 349, 0, 347, 23, 346, 52, 348, 53, 337, 0, 335, 23, 334, 52, 336, 53, 191, 0, 236, 0, 237, 0, 470, 2, 916, 0, 845, 0, 843, 0, 844, 0, 771, 0, 787, 0, 654, 2, 1032, 2, 710, 2, 407, 0, 878, 0] } }, sigs: [[], [["snowy", ["true", "false"], 1]], [["axis", ["x", "y", "z"], 1]], [["stage", ["0", "1"], 0]], [["age", ["0", "1", "2", "3", "4"], 0], ["hanging", ["true", "false"], 1], ["stage", ["0", "1"], 0], ["waterlogged", ["true", "false"], 1]], [["level", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0]], [["dusted", ["0", "1", "2", "3"], 0]], [["waterlogged", ["true", "false"], 1]], [["distance", ["1", "2", "3", "4", "5", "6", "7"], 6], ["persistent", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "east", "south", "west", "up", "down"], 0], ["triggered", ["true", "false"], 1]], [["instrument", ["harp", "basedrum", "snare", "hat", "bass", "flute", "bell", "guitar", "chime", "xylophone", "iron_xylophone", "cow_bell", "didgeridoo", "bit", "banjo", "pling", "trumpet", "trumpet_exposed", "trumpet_oxidized", "trumpet_weathered", "zombie", "skeleton", "creeper", "dragon", "wither_skeleton", "piglin", "custom_head"], 0], ["note", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"], 0], ["powered", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["occupied", ["true", "false"], 1], ["part", ["head", "foot"], 1]], [["powered", ["true", "false"], 1], ["shape", ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south"], 0], ["waterlogged", ["true", "false"], 1]], [["extended", ["true", "false"], 1], ["facing", ["north", "east", "south", "west", "up", "down"], 0]], [["half", ["upper", "lower"], 1]], [["facing", ["north", "east", "south", "west", "up", "down"], 0], ["short", ["true", "false"], 1], ["type", ["normal", "sticky"], 0]], [["facing", ["north", "east", "south", "west", "up", "down"], 0], ["type", ["normal", "sticky"], 0]], [["unstable", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["slot_0_occupied", ["true", "false"], 1], ["slot_1_occupied", ["true", "false"], 1], ["slot_2_occupied", ["true", "false"], 1], ["slot_3_occupied", ["true", "false"], 1], ["slot_4_occupied", ["true", "false"], 1], ["slot_5_occupied", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["powered", ["true", "false"], 1], ["side_chain", ["unconnected", "right", "center", "left"], 0], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0]], [["age", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0], ["east", ["true", "false"], 1], ["north", ["true", "false"], 1], ["south", ["true", "false"], 1], ["up", ["true", "false"], 1], ["west", ["true", "false"], 1]], [["axis", ["x", "y", "z"], 1], ["creaking_heart_state", ["uprooted", "dormant", "awake"], 0], ["natural", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["half", ["top", "bottom"], 1], ["shape", ["straight", "inner_left", "inner_right", "outer_left", "outer_right"], 0], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["type", ["single", "left", "right"], 0], ["waterlogged", ["true", "false"], 1]], [["east", ["up", "side", "none"], 2], ["north", ["up", "side", "none"], 2], ["power", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0], ["south", ["up", "side", "none"], 2], ["west", ["up", "side", "none"], 2]], [["age", ["0", "1", "2", "3", "4", "5", "6", "7"], 0]], [["moisture", ["0", "1", "2", "3", "4", "5", "6", "7"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["lit", ["true", "false"], 1]], [["rotation", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 8], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["half", ["upper", "lower"], 1], ["hinge", ["left", "right"], 0], ["open", ["true", "false"], 1], ["powered", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["waterlogged", ["true", "false"], 1]], [["shape", ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south", "south_east", "south_west", "north_west", "north_east"], 0], ["waterlogged", ["true", "false"], 1]], [["attached", ["true", "false"], 1], ["rotation", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 8], ["waterlogged", ["true", "false"], 1]], [["face", ["floor", "wall", "ceiling"], 1], ["facing", ["north", "south", "west", "east"], 0], ["powered", ["true", "false"], 1]], [["powered", ["true", "false"], 1]], [["lit", ["true", "false"], 1]], [["lit", ["true", "false"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["lit", ["true", "false"], 0]], [["layers", ["1", "2", "3", "4", "5", "6", "7", "8"], 0]], [["age", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0]], [["has_record", ["true", "false"], 1]], [["east", ["true", "false"], 1], ["north", ["true", "false"], 1], ["south", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1], ["west", ["true", "false"], 1]], [["axis", ["x", "z"], 0]], [["bites", ["0", "1", "2", "3", "4", "5", "6"], 0]], [["delay", ["1", "2", "3", "4"], 0], ["facing", ["north", "south", "west", "east"], 0], ["locked", ["true", "false"], 1], ["powered", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["half", ["top", "bottom"], 1], ["open", ["true", "false"], 1], ["powered", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1]], [["down", ["true", "false"], 0], ["east", ["true", "false"], 0], ["north", ["true", "false"], 0], ["south", ["true", "false"], 0], ["up", ["true", "false"], 0], ["west", ["true", "false"], 0]], [["axis", ["x", "y", "z"], 1], ["waterlogged", ["true", "false"], 1]], [["east", ["true", "false"], 1], ["north", ["true", "false"], 1], ["south", ["true", "false"], 1], ["up", ["true", "false"], 1], ["west", ["true", "false"], 1]], [["down", ["true", "false"], 1], ["east", ["true", "false"], 1], ["north", ["true", "false"], 1], ["south", ["true", "false"], 1], ["up", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1], ["west", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["in_wall", ["true", "false"], 1], ["open", ["true", "false"], 1], ["powered", ["true", "false"], 1]], [["type", ["top", "bottom", "double"], 1], ["waterlogged", ["true", "false"], 1]], [["east", ["none", "low", "tall"], 0], ["north", ["none", "low", "tall"], 0], ["south", ["none", "low", "tall"], 0], ["up", ["true", "false"], 0], ["waterlogged", ["true", "false"], 1], ["west", ["none", "low", "tall"], 0]], [["age", ["0", "1", "2", "3"], 0]], [["has_bottle_0", ["true", "false"], 1], ["has_bottle_1", ["true", "false"], 1], ["has_bottle_2", ["true", "false"], 1]], [["level", ["1", "2", "3"], 0]], [["eye", ["true", "false"], 1], ["facing", ["north", "south", "west", "east"], 0]], [["age", ["0", "1", "2"], 0], ["facing", ["north", "south", "west", "east"], 0]], [["attached", ["true", "false"], 1], ["facing", ["north", "south", "west", "east"], 0], ["powered", ["true", "false"], 1]], [["attached", ["true", "false"], 1], ["disarmed", ["true", "false"], 1], ["east", ["true", "false"], 1], ["north", ["true", "false"], 1], ["powered", ["true", "false"], 1], ["south", ["true", "false"], 1], ["west", ["true", "false"], 1]], [["conditional", ["true", "false"], 1], ["facing", ["north", "east", "south", "west", "up", "down"], 0]], [["powered", ["true", "false"], 1], ["rotation", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["powered", ["true", "false"], 1]], [["power", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["mode", ["compare", "subtract"], 0], ["powered", ["true", "false"], 1]], [["inverted", ["true", "false"], 1], ["power", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0]], [["enabled", ["true", "false"], 0], ["facing", ["down", "north", "south", "west", "east"], 0]], [["level", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 15], ["waterlogged", ["true", "false"], 1]], [["rotation", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 8]], [["facing", ["north", "east", "south", "west", "up", "down"], 4]], [["down", ["true", "false"], 1], ["east", ["true", "false"], 1], ["north", ["true", "false"], 1], ["south", ["true", "false"], 1], ["up", ["true", "false"], 1], ["west", ["true", "false"], 1]], [["age", ["0", "1", "2", "3", "4", "5"], 0]], [["age", ["0", "1"], 0]], [["age", ["0", "1", "2", "3", "4"], 0], ["half", ["upper", "lower"], 1]], [["facing", ["north", "east", "south", "west", "up", "down"], 2], ["powered", ["true", "false"], 1]], [["age", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"], 0]], [["eggs", ["1", "2", "3", "4"], 0], ["hatch", ["0", "1", "2"], 0]], [["hatch", ["0", "1", "2"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["hydration", ["0", "1", "2", "3"], 0], ["waterlogged", ["true", "false"], 1]], [["waterlogged", ["true", "false"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["waterlogged", ["true", "false"], 0]], [["pickles", ["1", "2", "3", "4"], 0], ["waterlogged", ["true", "false"], 0]], [["age", ["0", "1"], 0], ["leaves", ["none", "small", "large"], 0], ["stage", ["0", "1"], 0]], [["drag", ["true", "false"], 0]], [["bottom", ["true", "false"], 1], ["distance", ["0", "1", "2", "3", "4", "5", "6", "7"], 7], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "east", "south", "west", "up", "down"], 0], ["open", ["true", "false"], 1]], [["face", ["floor", "wall", "ceiling"], 1], ["facing", ["north", "south", "west", "east"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["has_book", ["true", "false"], 1], ["powered", ["true", "false"], 1]], [["attachment", ["floor", "ceiling", "single_wall", "double_wall"], 0], ["facing", ["north", "south", "west", "east"], 0], ["powered", ["true", "false"], 1]], [["hanging", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["lit", ["true", "false"], 0], ["signal_fire", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1]], [["mode", ["save", "load", "corner", "data"], 1]], [["orientation", ["down_east", "down_north", "down_south", "down_west", "up_east", "up_north", "up_south", "up_west", "west_up", "east_up", "north_up", "south_up"], 10]], [["mode", ["start", "log", "fail", "accept"], 0]], [["level", ["0", "1", "2", "3", "4", "5", "6", "7", "8"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["honey_level", ["0", "1", "2", "3", "4", "5"], 0]], [["charges", ["0", "1", "2", "3", "4"], 0]], [["candles", ["1", "2", "3", "4"], 0], ["lit", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "east", "south", "west", "up", "down"], 4], ["waterlogged", ["true", "false"], 1]], [["power", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0], ["sculk_sensor_phase", ["inactive", "active", "cooldown"], 0], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["power", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0], ["sculk_sensor_phase", ["inactive", "active", "cooldown"], 0], ["waterlogged", ["true", "false"], 1]], [["bloom", ["true", "false"], 1]], [["can_summon", ["true", "false"], 1], ["shrieking", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1]], [["lit", ["true", "false"], 1], ["powered", ["true", "false"], 1]], [["copper_golem_pose", ["standing", "sitting", "running", "star"], 0], ["facing", ["north", "south", "west", "east"], 0], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "east", "south", "west", "up", "down"], 4], ["powered", ["true", "false"], 1], ["waterlogged", ["true", "false"], 1]], [["thickness", ["tip_merge", "tip", "frustum", "middle", "base"], 1], ["vertical_direction", ["up", "down"], 0], ["waterlogged", ["true", "false"], 1]], [["age", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"], 0], ["berries", ["true", "false"], 1]], [["berries", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["flower_amount", ["1", "2", "3", "4"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["segment_amount", ["1", "2", "3", "4"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["tilt", ["none", "unstable", "partial", "full"], 0], ["waterlogged", ["true", "false"], 1]], [["facing", ["north", "south", "west", "east"], 0], ["half", ["upper", "lower"], 1], ["waterlogged", ["true", "false"], 1]], [["cracked", ["true", "false"], 1], ["facing", ["north", "south", "west", "east"], 0], ["waterlogged", ["true", "false"], 1]], [["crafting", ["true", "false"], 1], ["orientation", ["down_east", "down_north", "down_south", "down_west", "up_east", "up_north", "up_south", "up_west", "west_up", "east_up", "north_up", "south_up"], 10], ["triggered", ["true", "false"], 1]], [["ominous", ["true", "false"], 1], ["trial_spawner_state", ["inactive", "waiting_for_players", "active", "waiting_for_reward_ejection", "ejecting_reward", "cooldown"], 0]], [["facing", ["north", "south", "west", "east"], 0], ["ominous", ["true", "false"], 1], ["vault_state", ["inactive", "active", "unlocking", "ejecting"], 0]], [["bottom", ["true", "false"], 0], ["east", ["none", "low", "tall"], 0], ["north", ["none", "low", "tall"], 0], ["south", ["none", "low", "tall"], 0], ["west", ["none", "low", "tall"], 0]], [["tip", ["true", "false"], 0]], [["instrument", ["harp", "basedrum", "snare", "hat", "bass", "flute", "bell", "guitar", "chime", "xylophone", "iron_xylophone", "cow_bell", "didgeridoo", "bit", "banjo", "pling", "zombie", "skeleton", "creeper", "dragon", "wither_skeleton", "piglin", "custom_head"], 0], ["note", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"], 0], ["powered", ["true", "false"], 1]], [["rotation", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0], ["waterlogged", ["true", "false"], 1]], [["attached", ["true", "false"], 1], ["rotation", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0], ["waterlogged", ["true", "false"], 1]], [["rotation", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], 0]], [["active", ["true", "false"], 1], ["axis", ["x", "y", "z"], 1], ["natural", ["true", "false"], 1]], [["axis", ["x", "y", "z"], 1], ["creaking", ["disabled", "dormant", "active"], 0]], [["trial_spawner_state", ["inactive", "waiting_for_players", "active", "waiting_for_reward_ejection", "ejecting_reward", "cooldown"], 0]], [["age", ["0", "1", "2"], 0]], [["instrument", ["harp", "basedrum", "snare", "hat", "bass", "flute", "bell", "guitar", "chime", "xylophone", "iron_xylophone", "cow_bell", "didgeridoo", "bit", "banjo", "pling"], 0], ["note", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"], 0], ["powered", ["true", "false"], 1]], [["distance", ["1", "2", "3", "4", "5", "6", "7"], 6], ["persistent", ["true", "false"], 1]], [["powered", ["true", "false"], 1], ["shape", ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south"], 0]], [["shape", ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south", "south_east", "south_west", "north_west", "north_east"], 0]], [["level", ["0", "1", "2", "3"], 0]], [["mode", ["save", "load", "corner", "data"], 0]], [["hanging", ["true", "false"], 1]], [["east", ["true", "false"], 1], ["north", ["true", "false"], 1], ["south", ["true", "false"], 1], ["up", ["true", "false"], 0], ["waterlogged", ["true", "false"], 1], ["west", ["true", "false"], 1]], [["attachment", ["floor", "ceiling", "single_wall", "double_wall"], 0], ["facing", ["north", "south", "west", "east"], 0]], [["instrument", ["harp", "basedrum", "snare", "hat", "bass", "flute", "bell", "guitar", "chime", "xylophone"], 0], ["note", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"], 0], ["powered", ["true", "false"], 1]]], displayNames: { air: "Air", stone: "Stone", granite: "Granite", polished_granite: "Polished Granite", diorite: "Diorite", polished_diorite: "Polished Diorite", andesite: "Andesite", polished_andesite: "Polished Andesite", grass_block: "Grass Block", dirt: "Dirt", coarse_dirt: "Coarse Dirt", podzol: "Podzol", cobblestone: "Cobblestone", oak_planks: "Oak Planks", spruce_planks: "Spruce Planks", birch_planks: "Birch Planks", jungle_planks: "Jungle Planks", acacia_planks: "Acacia Planks", cherry_planks: "Cherry Planks", dark_oak_planks: "Dark Oak Planks", pale_oak_wood: "Pale Oak Wood", pale_oak_planks: "Pale Oak Planks", mangrove_planks: "Mangrove Planks", bamboo_planks: "Bamboo Planks", bamboo_mosaic: "Bamboo Mosaic", oak_sapling: "Oak Sapling", spruce_sapling: "Spruce Sapling", birch_sapling: "Birch Sapling", jungle_sapling: "Jungle Sapling", acacia_sapling: "Acacia Sapling", cherry_sapling: "Cherry Sapling", dark_oak_sapling: "Dark Oak Sapling", pale_oak_sapling: "Pale Oak Sapling", mangrove_propagule: "Mangrove Propagule", bedrock: "Bedrock", water: "Water", lava: "Lava", sand: "Sand", suspicious_sand: "Suspicious Sand", red_sand: "Red Sand", gravel: "Gravel", suspicious_gravel: "Suspicious Gravel", gold_ore: "Gold Ore", deepslate_gold_ore: "Deepslate Gold Ore", iron_ore: "Iron Ore", deepslate_iron_ore: "Deepslate Iron Ore", coal_ore: "Coal Ore", deepslate_coal_ore: "Deepslate Coal Ore", nether_gold_ore: "Nether Gold Ore", oak_log: "Oak Log", spruce_log: "Spruce Log", birch_log: "Birch Log", jungle_log: "Jungle Log", acacia_log: "Acacia Log", cherry_log: "Cherry Log", dark_oak_log: "Dark Oak Log", pale_oak_log: "Pale Oak Log", mangrove_log: "Mangrove Log", mangrove_roots: "Mangrove Roots", muddy_mangrove_roots: "Muddy Mangrove Roots", bamboo_block: "Block of Bamboo", stripped_spruce_log: "Stripped Spruce Log", stripped_birch_log: "Stripped Birch Log", stripped_jungle_log: "Stripped Jungle Log", stripped_acacia_log: "Stripped Acacia Log", stripped_cherry_log: "Stripped Cherry Log", stripped_dark_oak_log: "Stripped Dark Oak Log", stripped_pale_oak_log: "Stripped Pale Oak Log", stripped_oak_log: "Stripped Oak Log", stripped_mangrove_log: "Stripped Mangrove Log", stripped_bamboo_block: "Block of Stripped Bamboo", oak_wood: "Oak Wood", spruce_wood: "Spruce Wood", birch_wood: "Birch Wood", jungle_wood: "Jungle Wood", acacia_wood: "Acacia Wood", cherry_wood: "Cherry Wood", dark_oak_wood: "Dark Oak Wood", mangrove_wood: "Mangrove Wood", stripped_oak_wood: "Stripped Oak Wood", stripped_spruce_wood: "Stripped Spruce Wood", stripped_birch_wood: "Stripped Birch Wood", stripped_jungle_wood: "Stripped Jungle Wood", stripped_acacia_wood: "Stripped Acacia Wood", stripped_cherry_wood: "Stripped Cherry Wood", stripped_dark_oak_wood: "Stripped Dark Oak Wood", stripped_pale_oak_wood: "Stripped Pale Oak Wood", stripped_mangrove_wood: "Stripped Mangrove Wood", oak_leaves: "Oak Leaves", spruce_leaves: "Spruce Leaves", birch_leaves: "Birch Leaves", jungle_leaves: "Jungle Leaves", acacia_leaves: "Acacia Leaves", cherry_leaves: "Cherry Leaves", dark_oak_leaves: "Dark Oak Leaves", pale_oak_leaves: "Pale Oak Leaves", mangrove_leaves: "Mangrove Leaves", azalea_leaves: "Azalea Leaves", flowering_azalea_leaves: "Flowering Azalea Leaves", sponge: "Sponge", wet_sponge: "Wet Sponge", glass: "Glass", lapis_ore: "Lapis Lazuli Ore", deepslate_lapis_ore: "Deepslate Lapis Lazuli Ore", lapis_block: "Lapis Lazuli Block", dispenser: "Dispenser", sandstone: "Sandstone", chiseled_sandstone: "Chiseled Sandstone", cut_sandstone: "Cut Sandstone", note_block: "Note Block", white_bed: "White Bed", orange_bed: "Orange Bed", magenta_bed: "Magenta Bed", light_blue_bed: "Light Blue Bed", yellow_bed: "Yellow Bed", lime_bed: "Lime Bed", pink_bed: "Pink Bed", gray_bed: "Gray Bed", light_gray_bed: "Light Gray Bed", cyan_bed: "Cyan Bed", purple_bed: "Purple Bed", blue_bed: "Blue Bed", brown_bed: "Brown Bed", green_bed: "Green Bed", red_bed: "Red Bed", black_bed: "Black Bed", powered_rail: "Powered Rail", detector_rail: "Detector Rail", sticky_piston: "Sticky Piston", cobweb: "Cobweb", short_grass: "Short Grass", fern: "Fern", dead_bush: "Dead Bush", bush: "Bush", short_dry_grass: "Short Dry Grass", tall_dry_grass: "Tall Dry Grass", seagrass: "Seagrass", tall_seagrass: "Tall Seagrass", piston: "Piston", piston_head: "Piston Head", white_wool: "White Wool", orange_wool: "Orange Wool", magenta_wool: "Magenta Wool", light_blue_wool: "Light Blue Wool", yellow_wool: "Yellow Wool", lime_wool: "Lime Wool", pink_wool: "Pink Wool", gray_wool: "Gray Wool", light_gray_wool: "Light Gray Wool", cyan_wool: "Cyan Wool", purple_wool: "Purple Wool", blue_wool: "Blue Wool", brown_wool: "Brown Wool", green_wool: "Green Wool", red_wool: "Red Wool", black_wool: "Black Wool", moving_piston: "Moving Piston", dandelion: "Dandelion", golden_dandelion: "Golden Dandelion", torchflower: "Torchflower", poppy: "Poppy", blue_orchid: "Blue Orchid", allium: "Allium", azure_bluet: "Azure Bluet", red_tulip: "Red Tulip", orange_tulip: "Orange Tulip", white_tulip: "White Tulip", pink_tulip: "Pink Tulip", oxeye_daisy: "Oxeye Daisy", cornflower: "Cornflower", wither_rose: "Wither Rose", lily_of_the_valley: "Lily of the Valley", brown_mushroom: "Brown Mushroom", red_mushroom: "Red Mushroom", gold_block: "Block of Gold", iron_block: "Block of Iron", bricks: "Bricks", tnt: "TNT", bookshelf: "Bookshelf", chiseled_bookshelf: "Chiseled Bookshelf", acacia_shelf: "Acacia Shelf", bamboo_shelf: "Bamboo Shelf", birch_shelf: "Birch Shelf", cherry_shelf: "Cherry Shelf", crimson_shelf: "Crimson Shelf", dark_oak_shelf: "Dark Oak Shelf", jungle_shelf: "Jungle Shelf", mangrove_shelf: "Mangrove Shelf", oak_shelf: "Oak Shelf", pale_oak_shelf: "Pale Oak Shelf", spruce_shelf: "Spruce Shelf", warped_shelf: "Warped Shelf", mossy_cobblestone: "Mossy Cobblestone", obsidian: "Obsidian", torch: "Torch", wall_torch: "Wall Torch", fire: "Fire", soul_fire: "Soul Fire", spawner: "Spawner", creaking_heart: "Creaking Heart", oak_stairs: "Oak Stairs", chest: "Chest", redstone_wire: "Redstone Dust", diamond_ore: "Diamond Ore", deepslate_diamond_ore: "Deepslate Diamond Ore", diamond_block: "Block of Diamond", crafting_table: "Crafting Table", wheat: "Wheat Crops", farmland: "Farmland", furnace: "Furnace", oak_sign: "Sign", spruce_sign: "Sign", birch_sign: "Sign", acacia_sign: "Sign", cherry_sign: "Cherry Sign", jungle_sign: "Sign", dark_oak_sign: "Sign", pale_oak_sign: "Pale Oak Sign", mangrove_sign: "Mangrove Sign", bamboo_sign: "Bamboo Sign", oak_door: "Oak Door", ladder: "Ladder", rail: "Rail", cobblestone_stairs: "Cobblestone Stairs", oak_wall_sign: "Wall Sign", spruce_wall_sign: "Wall Sign", birch_wall_sign: "Wall Sign", acacia_wall_sign: "Wall Sign", cherry_wall_sign: "Cherry Sign", jungle_wall_sign: "Wall Sign", dark_oak_wall_sign: "Wall Sign", pale_oak_wall_sign: "Pale Oak Sign", mangrove_wall_sign: "Mangrove Sign", bamboo_wall_sign: "Bamboo Sign", oak_hanging_sign: "Oak Hanging Sign", spruce_hanging_sign: "Spruce Hanging Sign", birch_hanging_sign: "Birch Hanging Sign", acacia_hanging_sign: "Acacia Hanging Sign", cherry_hanging_sign: "Cherry Hanging Sign", jungle_hanging_sign: "Jungle Hanging Sign", dark_oak_hanging_sign: "Dark Oak Hanging Sign", pale_oak_hanging_sign: "Pale Oak Hanging Sign", crimson_hanging_sign: "Crimson Hanging Sign", warped_hanging_sign: "Warped Hanging Sign", mangrove_hanging_sign: "Mangrove Hanging Sign", bamboo_hanging_sign: "Bamboo Hanging Sign", oak_wall_hanging_sign: "Oak Hanging Sign", spruce_wall_hanging_sign: "Spruce Hanging Sign", birch_wall_hanging_sign: "Birch Hanging Sign", acacia_wall_hanging_sign: "Acacia Hanging Sign", cherry_wall_hanging_sign: "Cherry Hanging Sign", jungle_wall_hanging_sign: "Jungle Hanging Sign", dark_oak_wall_hanging_sign: "Dark Oak Hanging Sign", pale_oak_wall_hanging_sign: "Pale Oak Hanging Sign", mangrove_wall_hanging_sign: "Mangrove Hanging Sign", crimson_wall_hanging_sign: "Crimson Hanging Sign", warped_wall_hanging_sign: "Warped Hanging Sign", bamboo_wall_hanging_sign: "Bamboo Hanging Sign", lever: "Lever", stone_pressure_plate: "Stone Pressure Plate", iron_door: "Iron Door", oak_pressure_plate: "Oak Pressure Plate", spruce_pressure_plate: "Spruce Pressure Plate", birch_pressure_plate: "Birch Pressure Plate", jungle_pressure_plate: "Jungle Pressure Plate", acacia_pressure_plate: "Acacia Pressure Plate", cherry_pressure_plate: "Cherry Pressure Plate", dark_oak_pressure_plate: "Dark Oak Pressure Plate", pale_oak_pressure_plate: "Pale Oak Pressure Plate", mangrove_pressure_plate: "Mangrove Pressure Plate", bamboo_pressure_plate: "Bamboo Pressure Plate", redstone_ore: "Redstone Ore", deepslate_redstone_ore: "Deepslate Redstone Ore", redstone_torch: "Redstone Torch", redstone_wall_torch: "Redstone Wall Torch", stone_button: "Stone Button", snow: "Snow", ice: "Ice", snow_block: "Snow Block", cactus: "Cactus", cactus_flower: "Cactus Flower", clay: "Clay", sugar_cane: "Sugar Cane", jukebox: "Jukebox", oak_fence: "Oak Fence", netherrack: "Netherrack", soul_sand: "Soul Sand", soul_soil: "Soul Soil", basalt: "Basalt", polished_basalt: "Polished Basalt", soul_torch: "Soul Torch", soul_wall_torch: "Soul Wall Torch", copper_torch: "Copper Torch", copper_wall_torch: "Copper Torch", glowstone: "Glowstone", nether_portal: "Nether Portal", carved_pumpkin: "Carved Pumpkin", jack_o_lantern: "Jack o'Lantern", cake: "Cake", repeater: "Redstone Repeater", white_stained_glass: "White Stained Glass", orange_stained_glass: "Orange Stained Glass", magenta_stained_glass: "Magenta Stained Glass", light_blue_stained_glass: "Light Blue Stained Glass", yellow_stained_glass: "Yellow Stained Glass", lime_stained_glass: "Lime Stained Glass", pink_stained_glass: "Pink Stained Glass", gray_stained_glass: "Gray Stained Glass", light_gray_stained_glass: "Light Gray Stained Glass", cyan_stained_glass: "Cyan Stained Glass", purple_stained_glass: "Purple Stained Glass", blue_stained_glass: "Blue Stained Glass", brown_stained_glass: "Brown Stained Glass", green_stained_glass: "Green Stained Glass", red_stained_glass: "Red Stained Glass", black_stained_glass: "Black Stained Glass", oak_trapdoor: "Oak Trapdoor", spruce_trapdoor: "Spruce Trapdoor", birch_trapdoor: "Birch Trapdoor", jungle_trapdoor: "Jungle Trapdoor", acacia_trapdoor: "Acacia Trapdoor", cherry_trapdoor: "Cherry Trapdoor", dark_oak_trapdoor: "Dark Oak Trapdoor", pale_oak_trapdoor: "Pale Oak Trapdoor", mangrove_trapdoor: "Mangrove Trapdoor", bamboo_trapdoor: "Bamboo Trapdoor", stone_bricks: "Stone Bricks", mossy_stone_bricks: "Mossy Stone Bricks", cracked_stone_bricks: "Cracked Stone Bricks", chiseled_stone_bricks: "Chiseled Stone Bricks", packed_mud: "Packed Mud", mud_bricks: "Mud Bricks", infested_stone: "Infested Stone", infested_cobblestone: "Infested Cobblestone", infested_stone_bricks: "Infested Stone Bricks", infested_mossy_stone_bricks: "Infested Mossy Stone Bricks", infested_cracked_stone_bricks: "Infested Cracked Stone Bricks", infested_chiseled_stone_bricks: "Infested Chiseled Stone Bricks", brown_mushroom_block: "Brown Mushroom Block", red_mushroom_block: "Red Mushroom Block", mushroom_stem: "Mushroom Stem", iron_bars: "Iron Bars", copper_bars: "Copper Bars", exposed_copper_bars: "Exposed Copper Bars", weathered_copper_bars: "Weathered Copper Bars", oxidized_copper_bars: "Oxidized Copper Bars", waxed_copper_bars: "Waxed Copper Bars", waxed_exposed_copper_bars: "Waxed Exposed Copper Bars", waxed_weathered_copper_bars: "Waxed Weathered Copper Bars", waxed_oxidized_copper_bars: "Waxed Oxidized Copper Bars", iron_chain: "Iron Chain", copper_chain: "Copper Chain", exposed_copper_chain: "Exposed Copper Chain", weathered_copper_chain: "Weathered Copper Chain", oxidized_copper_chain: "Oxidized Copper Chain", waxed_copper_chain: "Waxed Copper Chain", waxed_exposed_copper_chain: "Waxed Exposed Copper Chain", waxed_weathered_copper_chain: "Waxed Weathered Copper Chain", waxed_oxidized_copper_chain: "Waxed Oxidized Copper Chain", glass_pane: "Glass Pane", pumpkin: "Pumpkin", melon: "Melon", attached_pumpkin_stem: "Attached Pumpkin Stem", attached_melon_stem: "Attached Melon Stem", pumpkin_stem: "Pumpkin Stem", melon_stem: "Melon Stem", vine: "Vines", glow_lichen: "Glow Lichen", resin_clump: "Resin Clump", oak_fence_gate: "Oak Fence Gate", brick_stairs: "Brick Stairs", stone_brick_stairs: "Stone Brick Stairs", mud_brick_stairs: "Mud Brick Stairs", mycelium: "Mycelium", lily_pad: "Lily Pad", resin_block: "Block of Resin", resin_bricks: "Resin Bricks", resin_brick_stairs: "Resin Brick Stairs", resin_brick_slab: "Resin Brick Slab", resin_brick_wall: "Resin Brick Wall", chiseled_resin_bricks: "Chiseled Resin Bricks", nether_bricks: "Nether Bricks", nether_brick_fence: "Nether Brick Fence", nether_brick_stairs: "Nether Brick Stairs", nether_wart: "Nether Wart", enchanting_table: "Enchanting Table", brewing_stand: "Brewing Stand", cauldron: "Cauldron", water_cauldron: "Cauldron", lava_cauldron: "Cauldron", powder_snow_cauldron: "Cauldron", end_portal: "End Portal", end_portal_frame: "End Portal Frame", end_stone: "End Stone", dragon_egg: "Dragon Egg", redstone_lamp: "Redstone Lamp", cocoa: "Cocoa", sandstone_stairs: "Sandstone Stairs", emerald_ore: "Emerald Ore", deepslate_emerald_ore: "Deepslate Emerald Ore", ender_chest: "Ender Chest", tripwire_hook: "Tripwire Hook", tripwire: "Tripwire", emerald_block: "Block of Emerald", spruce_stairs: "Spruce Stairs", birch_stairs: "Birch Stairs", jungle_stairs: "Jungle Stairs", command_block: "Command Block", beacon: "Beacon", cobblestone_wall: "Cobblestone Wall", mossy_cobblestone_wall: "Mossy Cobblestone Wall", flower_pot: "Flower Pot", potted_torchflower: "Potted Torchflower", potted_oak_sapling: "Potted Oak Sapling", potted_spruce_sapling: "Potted Spruce Sapling", potted_birch_sapling: "Potted Birch Sapling", potted_jungle_sapling: "Potted Jungle Sapling", potted_acacia_sapling: "Potted Acacia Sapling", potted_cherry_sapling: "Potted Cherry Sapling", potted_dark_oak_sapling: "Potted Dark Oak Sapling", potted_pale_oak_sapling: "Potted Pale Oak Sapling", potted_mangrove_propagule: "Potted Mangrove Propagule", potted_fern: "Potted Fern", potted_dandelion: "Potted Dandelion", potted_golden_dandelion: "Potted Golden Dandelion", potted_poppy: "Potted Poppy", potted_blue_orchid: "Potted Blue Orchid", potted_allium: "Potted Allium", potted_azure_bluet: "Potted Azure Bluet", potted_red_tulip: "Potted Red Tulip", potted_orange_tulip: "Potted Orange Tulip", potted_white_tulip: "Potted White Tulip", potted_pink_tulip: "Potted Pink Tulip", potted_oxeye_daisy: "Potted Oxeye Daisy", potted_cornflower: "Flower Pot", potted_lily_of_the_valley: "Flower Pot", potted_wither_rose: "Flower Pot", potted_red_mushroom: "Potted Red Mushroom", potted_brown_mushroom: "Potted Brown Mushroom", potted_dead_bush: "Potted Dead Bush", potted_cactus: "Potted Cactus", carrots: "Carrots", potatoes: "Potatoes", oak_button: "Oak Button", spruce_button: "Spruce Button", birch_button: "Birch Button", jungle_button: "Jungle Button", acacia_button: "Acacia Button", cherry_button: "Cherry Button", dark_oak_button: "Dark Oak Button", pale_oak_button: "Pale Oak Button", mangrove_button: "Mangrove Button", bamboo_button: "Bamboo Button", skeleton_skull: "Skeleton Skull", skeleton_wall_skull: "Skeleton Wall Skull", wither_skeleton_skull: "Wither Skeleton Skull", wither_skeleton_wall_skull: "Wither Skeleton Wall Skull", zombie_head: "Zombie Head", zombie_wall_head: "Zombie Wall Head", player_head: "Player Head", player_wall_head: "Player Wall Head", creeper_head: "Creeper Head", creeper_wall_head: "Creeper Wall Head", dragon_head: "Dragon Head", dragon_wall_head: "Dragon Wall Head", piglin_head: "Piglin Head", piglin_wall_head: "Piglin Head", anvil: "Anvil", chipped_anvil: "Chipped Anvil", damaged_anvil: "Damaged Anvil", trapped_chest: "Trapped Chest", light_weighted_pressure_plate: "Light Weighted Pressure Plate", heavy_weighted_pressure_plate: "Heavy Weighted Pressure Plate", comparator: "Redstone Comparator", daylight_detector: "Daylight Detector", redstone_block: "Block of Redstone", nether_quartz_ore: "Nether Quartz Ore", hopper: "Hopper", quartz_block: "Block of Quartz", chiseled_quartz_block: "Chiseled Quartz Block", quartz_pillar: "Quartz Pillar", quartz_stairs: "Quartz Stairs", activator_rail: "Activator Rail", dropper: "Dropper", white_terracotta: "White Terracotta", orange_terracotta: "Orange Terracotta", magenta_terracotta: "Magenta Terracotta", light_blue_terracotta: "Light Blue Terracotta", yellow_terracotta: "Yellow Terracotta", lime_terracotta: "Lime Terracotta", pink_terracotta: "Pink Terracotta", gray_terracotta: "Gray Terracotta", light_gray_terracotta: "Light Gray Terracotta", cyan_terracotta: "Cyan Terracotta", purple_terracotta: "Purple Terracotta", blue_terracotta: "Blue Terracotta", brown_terracotta: "Brown Terracotta", green_terracotta: "Green Terracotta", red_terracotta: "Red Terracotta", black_terracotta: "Black Terracotta", white_stained_glass_pane: "White Stained Glass Pane", orange_stained_glass_pane: "Orange Stained Glass Pane", magenta_stained_glass_pane: "Magenta Stained Glass Pane", light_blue_stained_glass_pane: "Light Blue Stained Glass Pane", yellow_stained_glass_pane: "Yellow Stained Glass Pane", lime_stained_glass_pane: "Lime Stained Glass Pane", pink_stained_glass_pane: "Pink Stained Glass Pane", gray_stained_glass_pane: "Gray Stained Glass Pane", light_gray_stained_glass_pane: "Light Gray Stained Glass Pane", cyan_stained_glass_pane: "Cyan Stained Glass Pane", purple_stained_glass_pane: "Purple Stained Glass Pane", blue_stained_glass_pane: "Blue Stained Glass Pane", brown_stained_glass_pane: "Brown Stained Glass Pane", green_stained_glass_pane: "Green Stained Glass Pane", red_stained_glass_pane: "Red Stained Glass Pane", black_stained_glass_pane: "Black Stained Glass Pane", acacia_stairs: "Acacia Stairs", cherry_stairs: "Cherry Stairs", dark_oak_stairs: "Dark Oak Stairs", pale_oak_stairs: "Pale Oak Stairs", mangrove_stairs: "Mangrove Stairs", bamboo_stairs: "Bamboo Stairs", bamboo_mosaic_stairs: "Bamboo Mosaic Stairs", slime_block: "Slime Block", barrier: "Barrier", light: "Light", iron_trapdoor: "Iron Trapdoor", prismarine: "Prismarine", prismarine_bricks: "Prismarine Bricks", dark_prismarine: "Dark Prismarine", prismarine_stairs: "Prismarine Stairs", prismarine_brick_stairs: "Prismarine Brick Stairs", dark_prismarine_stairs: "Dark Prismarine Stairs", prismarine_slab: "Prismarine Slab", prismarine_brick_slab: "Prismarine Brick Slab", dark_prismarine_slab: "Dark Prismarine Slab", sea_lantern: "Sea Lantern", hay_block: "Hay Bale", white_carpet: "White Carpet", orange_carpet: "Orange Carpet", magenta_carpet: "Magenta Carpet", light_blue_carpet: "Light Blue Carpet", yellow_carpet: "Yellow Carpet", lime_carpet: "Lime Carpet", pink_carpet: "Pink Carpet", gray_carpet: "Gray Carpet", light_gray_carpet: "Light Gray Carpet", cyan_carpet: "Cyan Carpet", purple_carpet: "Purple Carpet", blue_carpet: "Blue Carpet", brown_carpet: "Brown Carpet", green_carpet: "Green Carpet", red_carpet: "Red Carpet", black_carpet: "Black Carpet", terracotta: "Terracotta", coal_block: "Block of Coal", packed_ice: "Packed Ice", sunflower: "Sunflower", lilac: "Lilac", rose_bush: "Rose Bush", peony: "Peony", tall_grass: "Tall Grass", large_fern: "Large Fern", white_banner: "White Banner", orange_banner: "Orange Banner", magenta_banner: "Magenta Banner", light_blue_banner: "Light Blue Banner", yellow_banner: "Yellow Banner", lime_banner: "Lime Banner", pink_banner: "Pink Banner", gray_banner: "Gray Banner", light_gray_banner: "Light Gray Banner", cyan_banner: "Cyan Banner", purple_banner: "Purple Banner", blue_banner: "Blue Banner", brown_banner: "Brown Banner", green_banner: "Green Banner", red_banner: "Red Banner", black_banner: "Black Banner", white_wall_banner: "White wall banner", orange_wall_banner: "Orange wall banner", magenta_wall_banner: "Magenta wall banner", light_blue_wall_banner: "Light blue wall banner", yellow_wall_banner: "Yellow wall banner", lime_wall_banner: "Lime wall banner", pink_wall_banner: "Pink wall banner", gray_wall_banner: "Gray wall banner", light_gray_wall_banner: "Light gray wall banner", cyan_wall_banner: "Cyan wall banner", purple_wall_banner: "Purple wall banner", blue_wall_banner: "Blue wall banner", brown_wall_banner: "Brown wall banner", green_wall_banner: "Green wall banner", red_wall_banner: "Red wall banner", black_wall_banner: "Black wall banner", red_sandstone: "Red Sandstone", chiseled_red_sandstone: "Chiseled Red Sandstone", cut_red_sandstone: "Cut Red Sandstone", red_sandstone_stairs: "Red Sandstone Stairs", oak_slab: "Oak Slab", spruce_slab: "Spruce Slab", birch_slab: "Birch Slab", jungle_slab: "Jungle Slab", acacia_slab: "Acacia Slab", cherry_slab: "Cherry Slab", dark_oak_slab: "Dark Oak Slab", pale_oak_slab: "Pale Oak Slab", mangrove_slab: "Mangrove Slab", bamboo_slab: "Bamboo Slab", bamboo_mosaic_slab: "Bamboo Mosaic Slab", stone_slab: "Stone Slab", smooth_stone_slab: "Stone Slab", sandstone_slab: "Sandstone Slab", cut_sandstone_slab: "Stone Slab", petrified_oak_slab: "Petrified Oak Slab", cobblestone_slab: "Cobblestone Slab", brick_slab: "Brick Slab", stone_brick_slab: "Stone Brick Slab", mud_brick_slab: "Mud Brick Slab", nether_brick_slab: "Nether Brick Slab", quartz_slab: "Quartz Slab", red_sandstone_slab: "Red Sandstone Slab", cut_red_sandstone_slab: "Stone Slab", purpur_slab: "Purpur Slab", smooth_stone: "Smooth Stone", smooth_sandstone: "Smooth Sandstone", smooth_quartz: "Smooth Quartz", smooth_red_sandstone: "Smooth Red Sandstone", spruce_fence_gate: "Spruce Fence Gate", birch_fence_gate: "Birch Fence Gate", jungle_fence_gate: "Jungle Fence Gate", acacia_fence_gate: "Acacia Fence Gate", cherry_fence_gate: "Cherry Fence Gate", dark_oak_fence_gate: "Dark Oak Fence Gate", pale_oak_fence_gate: "Pale Oak Fence Gate", mangrove_fence_gate: "Mangrove Fence Gate", bamboo_fence_gate: "Bamboo Fence Gate", spruce_fence: "Spruce Fence", birch_fence: "Birch Fence", jungle_fence: "Jungle Fence", acacia_fence: "Acacia Fence", cherry_fence: "Cherry Fence", dark_oak_fence: "Dark Oak Fence", pale_oak_fence: "Pale Oak Fence", mangrove_fence: "Mangrove Fence", bamboo_fence: "Bamboo Fence", spruce_door: "Spruce Door", birch_door: "Birch Door", jungle_door: "Jungle Door", acacia_door: "Acacia Door", cherry_door: "Cherry Door", dark_oak_door: "Dark Oak Door", pale_oak_door: "Pale Oak Door", mangrove_door: "Mangrove Door", bamboo_door: "Bamboo Door", end_rod: "End Rod", chorus_plant: "Chorus Plant", chorus_flower: "Chorus Flower", purpur_block: "Purpur Block", purpur_pillar: "Purpur Pillar", purpur_stairs: "Purpur Stairs", end_stone_bricks: "End Stone Bricks", torchflower_crop: "Torchflower Crop", pitcher_crop: "Pitcher Crop", pitcher_plant: "Pitcher Plant", beetroots: "Beetroots", dirt_path: "Dirt Path", end_gateway: "End Gateway", repeating_command_block: "Repeating Command Block", chain_command_block: "Chain Command Block", frosted_ice: "Frosted Ice", magma_block: "Magma Block", nether_wart_block: "Nether Wart Block", red_nether_bricks: "Red Nether Bricks", bone_block: "Bone Block", structure_void: "Structure Void", observer: "Observer", shulker_box: "Shulker Box", white_shulker_box: "White Shulker Box", orange_shulker_box: "Orange Shulker Box", magenta_shulker_box: "Magenta Shulker Box", light_blue_shulker_box: "Light Blue Shulker Box", yellow_shulker_box: "Yellow Shulker Box", lime_shulker_box: "Lime Shulker Box", pink_shulker_box: "Pink Shulker Box", gray_shulker_box: "Gray Shulker Box", light_gray_shulker_box: "Light Gray Shulker Box", cyan_shulker_box: "Cyan Shulker Box", purple_shulker_box: "Purple Shulker Box", blue_shulker_box: "Blue Shulker Box", brown_shulker_box: "Brown Shulker Box", green_shulker_box: "Green Shulker Box", red_shulker_box: "Red Shulker Box", black_shulker_box: "Black Shulker Box", white_glazed_terracotta: "White Glazed Terracotta", orange_glazed_terracotta: "Orange Glazed Terracotta", magenta_glazed_terracotta: "Magenta Glazed Terracotta", light_blue_glazed_terracotta: "Light Blue Glazed Terracotta", yellow_glazed_terracotta: "Yellow Glazed Terracotta", lime_glazed_terracotta: "Lime Glazed Terracotta", pink_glazed_terracotta: "Pink Glazed Terracotta", gray_glazed_terracotta: "Gray Glazed Terracotta", light_gray_glazed_terracotta: "Light Gray Glazed Terracotta", cyan_glazed_terracotta: "Cyan Glazed Terracotta", purple_glazed_terracotta: "Purple Glazed Terracotta", blue_glazed_terracotta: "Blue Glazed Terracotta", brown_glazed_terracotta: "Brown Glazed Terracotta", green_glazed_terracotta: "Green Glazed Terracotta", red_glazed_terracotta: "Red Glazed Terracotta", black_glazed_terracotta: "Black Glazed Terracotta", white_concrete: "White Concrete", orange_concrete: "Orange Concrete", magenta_concrete: "Magenta Concrete", light_blue_concrete: "Light Blue Concrete", yellow_concrete: "Yellow Concrete", lime_concrete: "Lime Concrete", pink_concrete: "Pink Concrete", gray_concrete: "Gray Concrete", light_gray_concrete: "Light Gray Concrete", cyan_concrete: "Cyan Concrete", purple_concrete: "Purple Concrete", blue_concrete: "Blue Concrete", brown_concrete: "Brown Concrete", green_concrete: "Green Concrete", red_concrete: "Red Concrete", black_concrete: "Black Concrete", white_concrete_powder: "White Concrete Powder", orange_concrete_powder: "Orange Concrete Powder", magenta_concrete_powder: "Magenta Concrete Powder", light_blue_concrete_powder: "Light Blue Concrete Powder", yellow_concrete_powder: "Yellow Concrete Powder", lime_concrete_powder: "Lime Concrete Powder", pink_concrete_powder: "Pink Concrete Powder", gray_concrete_powder: "Gray Concrete Powder", light_gray_concrete_powder: "Light Gray Concrete Powder", cyan_concrete_powder: "Cyan Concrete Powder", purple_concrete_powder: "Purple Concrete Powder", blue_concrete_powder: "Blue Concrete Powder", brown_concrete_powder: "Brown Concrete Powder", green_concrete_powder: "Green Concrete Powder", red_concrete_powder: "Red Concrete Powder", black_concrete_powder: "Black Concrete Powder", kelp: "Kelp", kelp_plant: "Kelp Plant", dried_kelp_block: "Dried Kelp Block", turtle_egg: "Turtle Egg", sniffer_egg: "Sniffer Egg", dried_ghast: "Dried Ghast", dead_tube_coral_block: "Dead Tube Coral Block", dead_brain_coral_block: "Dead Brain Coral Block", dead_bubble_coral_block: "Dead Bubble Coral Block", dead_fire_coral_block: "Dead Fire Coral Block", dead_horn_coral_block: "Dead Horn Coral Block", tube_coral_block: "Tube Coral Block", brain_coral_block: "Brain Coral Block", bubble_coral_block: "Bubble Coral Block", fire_coral_block: "Fire Coral Block", horn_coral_block: "Horn Coral Block", dead_tube_coral: "Dead Tube Coral", dead_brain_coral: "Dead Brain Coral", dead_bubble_coral: "Dead Bubble Coral", dead_fire_coral: "Dead Fire Coral", dead_horn_coral: "Dead Horn Coral", tube_coral: "Tube Coral", brain_coral: "Brain Coral", bubble_coral: "Bubble Coral", fire_coral: "Fire Coral", horn_coral: "Horn Coral", dead_tube_coral_fan: "Dead Tube Coral Fan", dead_brain_coral_fan: "Dead Brain Coral Fan", dead_bubble_coral_fan: "Dead Bubble Coral Fan", dead_fire_coral_fan: "Dead Fire Coral Fan", dead_horn_coral_fan: "Dead Horn Coral Fan", tube_coral_fan: "Tube Coral Fan", brain_coral_fan: "Brain Coral Fan", bubble_coral_fan: "Bubble Coral Fan", fire_coral_fan: "Fire Coral Fan", horn_coral_fan: "Horn Coral Fan", dead_tube_coral_wall_fan: "Dead Tube Coral Wall Fan", dead_brain_coral_wall_fan: "Dead Brain Coral Wall Fan", dead_bubble_coral_wall_fan: "Dead Bubble Coral Wall Fan", dead_fire_coral_wall_fan: "Dead Fire Coral Wall Fan", dead_horn_coral_wall_fan: "Dead Horn Coral Wall Fan", tube_coral_wall_fan: "Tube Coral Wall Fan", brain_coral_wall_fan: "Brain Coral Wall Fan", bubble_coral_wall_fan: "Bubble Coral Wall Fan", fire_coral_wall_fan: "Fire Coral Wall Fan", horn_coral_wall_fan: "Horn Coral Wall Fan", sea_pickle: "Sea Pickle", blue_ice: "Blue Ice", conduit: "Conduit", bamboo_sapling: "Bamboo Sapling", bamboo: "Bamboo", potted_bamboo: "Flower Pot", void_air: "Void Air", cave_air: "Cave Air", bubble_column: "Bubble Column", polished_granite_stairs: "Polished Granite Stairs", smooth_red_sandstone_stairs: "Smooth Red Sandstone Stairs", mossy_stone_brick_stairs: "Mossy Stone Brick Stairs", polished_diorite_stairs: "Polished Diorite Stairs", mossy_cobblestone_stairs: "Mossy Cobblestone Stairs", end_stone_brick_stairs: "End Stone Brick Stairs", stone_stairs: "Stone Stairs", smooth_sandstone_stairs: "Smooth Sandstone Stairs", smooth_quartz_stairs: "Smooth Quartz Stairs", granite_stairs: "Granite Stairs", andesite_stairs: "Andesite Stairs", red_nether_brick_stairs: "Nether Brick Stairs", polished_andesite_stairs: "Polished Andesite Stairs", diorite_stairs: "Diorite Stairs", polished_granite_slab: "Stone Slab", smooth_red_sandstone_slab: "Stone Slab", mossy_stone_brick_slab: "Stone Slab", polished_diorite_slab: "Stone Slab", mossy_cobblestone_slab: "Stone Slab", end_stone_brick_slab: "Stone Slab", smooth_sandstone_slab: "Stone Slab", smooth_quartz_slab: "Stone Slab", granite_slab: "Stone Slab", andesite_slab: "Stone Slab", red_nether_brick_slab: "Nether Brick Slab", polished_andesite_slab: "Stone Slab", diorite_slab: "Stone Slab", brick_wall: "Brick Wall", prismarine_wall: "Prismarine Wall", red_sandstone_wall: "Red Sandstone Wall", mossy_stone_brick_wall: "Mossy Stone Brick Wall", granite_wall: "Granite Wall", stone_brick_wall: "Stone Brick Wall", mud_brick_wall: "Mud Brick Wall", nether_brick_wall: "Nether Brick Wall", andesite_wall: "Andesite Wall", red_nether_brick_wall: "Red Nether Brick Wall", sandstone_wall: "Sandstone Wall", end_stone_brick_wall: "End Stone Brick Wall", diorite_wall: "Diorite Wall", scaffolding: "Scaffolding", loom: "Loom", barrel: "Barrel", smoker: "Smoker", blast_furnace: "Blast Furnace", cartography_table: "Cartography Table", fletching_table: "Fletching Table", grindstone: "Grindstone", lectern: "Lectern", smithing_table: "Smithing Table", stonecutter: "Stonecutter", bell: "Bell", lantern: "Lantern", soul_lantern: "Soul Lantern", copper_lantern: "Copper Lantern", exposed_copper_lantern: "Exposed Copper Lantern", weathered_copper_lantern: "Weathered Copper Lantern", oxidized_copper_lantern: "Oxidized Copper Lantern", waxed_copper_lantern: "Waxed Copper Lantern", waxed_exposed_copper_lantern: "Waxed Exposed Copper Lantern", waxed_weathered_copper_lantern: "Waxed Weathered Copper Lantern", waxed_oxidized_copper_lantern: "Waxed Oxidized Copper Lantern", campfire: "Campfire", soul_campfire: "Soul Campfire", sweet_berry_bush: "Sweet Berry Bush", warped_stem: "Warped Stem", stripped_warped_stem: "Stripped Warped Stem", warped_hyphae: "Warped Hyphae", stripped_warped_hyphae: "Stripped Warped Hyphae", warped_nylium: "Warped Nylium", warped_fungus: "Warped Fungus", warped_wart_block: "Warped Wart Block", warped_roots: "Warped Roots", nether_sprouts: "Nether Sprouts", crimson_stem: "Crimson Stem", stripped_crimson_stem: "Stripped Crimson Stem", crimson_hyphae: "Crimson Hyphae", stripped_crimson_hyphae: "Stripped Crimson Hyphae", crimson_nylium: "Crimson Nylium", crimson_fungus: "Crimson Fungus", shroomlight: "Shroomlight", weeping_vines: "Weeping Vines", weeping_vines_plant: "Weeping Vines Plant", twisting_vines: "Twisting Vines", twisting_vines_plant: "Twisting Vines Plant", crimson_roots: "Crimson Roots", crimson_planks: "Crimson Planks", warped_planks: "Warped Planks", crimson_slab: "Crimson Slab", warped_slab: "Warped Slab", crimson_pressure_plate: "Crimson Pressure Plate", warped_pressure_plate: "Warped Pressure Plate", crimson_fence: "Crimson Fence", warped_fence: "Warped Fence", crimson_trapdoor: "Crimson Trapdoor", warped_trapdoor: "Warped Trapdoor", crimson_fence_gate: "Crimson Fence Gate", warped_fence_gate: "Warped Fence Gate", crimson_stairs: "Crimson Stairs", warped_stairs: "Warped Stairs", crimson_button: "Crimson Button", warped_button: "Warped Button", crimson_door: "Crimson Door", warped_door: "Warped Door", crimson_sign: "Crimson Sign", warped_sign: "Warped Sign", crimson_wall_sign: "Crimson Wall Sign", warped_wall_sign: "Warped Wall Sign", structure_block: "Structure Block", jigsaw: "Jigsaw Block", test_block: "Test Block", test_instance_block: "Test Instance Block", composter: "Composter", target: "Target", bee_nest: "Bee Nest", beehive: "Beehive", honey_block: "Honey Block", honeycomb_block: "Honeycomb Block", netherite_block: "Block of Netherite", ancient_debris: "Ancient Debris", crying_obsidian: "Crying Obsidian", respawn_anchor: "Respawn Anchor", potted_crimson_fungus: "Potted Crimson Fungus", potted_warped_fungus: "Potted Warped Fungus", potted_crimson_roots: "Potted Crimson Roots", potted_warped_roots: "Potted Warped Roots", lodestone: "Lodestone", blackstone: "Blackstone", blackstone_stairs: "Blackstone Stairs", blackstone_wall: "Blackstone Wall", blackstone_slab: "Blackstone Slab", polished_blackstone: "Polished Blackstone", polished_blackstone_bricks: "Polished Blackstone Bricks", cracked_polished_blackstone_bricks: "Cracked Polished Blackstone Bricks", chiseled_polished_blackstone: "Chiseled Polished Blackstone", polished_blackstone_brick_slab: "Polished Blackstone Brick Slab", polished_blackstone_brick_stairs: "Polished Blackstone Brick Stairs", polished_blackstone_brick_wall: "Polished Blackstone Brick Wall", gilded_blackstone: "Gilded Blackstone", polished_blackstone_stairs: "Polished Blackstone Stairs", polished_blackstone_slab: "Polished Blackstone Slab", polished_blackstone_pressure_plate: "Polished Blackstone Pressure Plate", polished_blackstone_button: "Polished Blackstone Button", polished_blackstone_wall: "Polished Blackstone Wall", chiseled_nether_bricks: "Chiseled Nether Bricks", cracked_nether_bricks: "Cracked Nether Bricks", quartz_bricks: "Quartz Bricks", candle: "Candle", white_candle: "White Candle", orange_candle: "Orange Candle", magenta_candle: "Magenta Candle", light_blue_candle: "Light Blue Candle", yellow_candle: "Yellow Candle", lime_candle: "Lime Candle", pink_candle: "Pink Candle", gray_candle: "Gray Candle", light_gray_candle: "Light Gray Candle", cyan_candle: "Cyan Candle", purple_candle: "Purple Candle", blue_candle: "Blue Candle", brown_candle: "Brown Candle", green_candle: "Green Candle", red_candle: "Red Candle", black_candle: "Black Candle", candle_cake: "Air", white_candle_cake: "Air", orange_candle_cake: "Air", magenta_candle_cake: "Air", light_blue_candle_cake: "Air", yellow_candle_cake: "Air", lime_candle_cake: "Air", pink_candle_cake: "Air", gray_candle_cake: "Air", light_gray_candle_cake: "Air", cyan_candle_cake: "Air", purple_candle_cake: "Air", blue_candle_cake: "Air", brown_candle_cake: "Air", green_candle_cake: "Air", red_candle_cake: "Air", black_candle_cake: "Air", amethyst_block: "Block of Amethyst", budding_amethyst: "Budding Amethyst", amethyst_cluster: "Amethyst Cluster", large_amethyst_bud: "Large Amethyst Bud", medium_amethyst_bud: "Medium Amethyst Bud", small_amethyst_bud: "Small Amethyst Bud", tuff: "Tuff", tuff_slab: "Tuff Slab", tuff_stairs: "Tuff Stairs", tuff_wall: "Tuff Wall", polished_tuff: "Polished Tuff", polished_tuff_slab: "Polished Tuff Slab", polished_tuff_stairs: "Polished Tuff Stairs", polished_tuff_wall: "Polished Tuff Wall", chiseled_tuff: "Chiseled Tuff", tuff_bricks: "Tuff Bricks", tuff_brick_slab: "Tuff Brick Slab", tuff_brick_stairs: "Tuff Brick Stairs", tuff_brick_wall: "Tuff Brick Wall", chiseled_tuff_bricks: "Chiseled Tuff Bricks", calcite: "Calcite", tinted_glass: "Tinted Glass", powder_snow: "Powder Snow Bucket", sculk_sensor: "Sculk Sensor", calibrated_sculk_sensor: "Calibrated Sculk Sensor", sculk: "Sculk", sculk_vein: "Sculk Vein", sculk_catalyst: "Sculk Catalyst", sculk_shrieker: "Sculk Shrieker", copper_block: "Block of Copper", exposed_copper: "Exposed Copper", weathered_copper: "Weathered Copper", oxidized_copper: "Oxidized Copper", copper_ore: "Copper Ore", deepslate_copper_ore: "Deepslate Copper Ore", oxidized_cut_copper: "Oxidized Cut Copper", weathered_cut_copper: "Weathered Cut Copper", exposed_cut_copper: "Exposed Cut Copper", cut_copper: "Cut Copper", oxidized_chiseled_copper: "Oxidized Chiseled Copper", weathered_chiseled_copper: "Weathered Chiseled Copper", exposed_chiseled_copper: "Exposed Chiseled Copper", chiseled_copper: "Chiseled Copper", waxed_oxidized_chiseled_copper: "Waxed Oxidized Chiseled Copper", waxed_weathered_chiseled_copper: "Waxed Weathered Chiseled Copper", waxed_exposed_chiseled_copper: "Waxed Exposed Chiseled Copper", waxed_chiseled_copper: "Waxed Chiseled Copper", oxidized_cut_copper_stairs: "Oxidized Cut Copper Stairs", weathered_cut_copper_stairs: "Weathered Cut Copper Stairs", exposed_cut_copper_stairs: "Exposed Cut Copper Stairs", cut_copper_stairs: "Cut Copper Stairs", oxidized_cut_copper_slab: "Oxidized Cut Copper Slab", weathered_cut_copper_slab: "Weathered Cut Copper Slab", exposed_cut_copper_slab: "Exposed Cut Copper Slab", cut_copper_slab: "Cut Copper Slab", waxed_copper_block: "Waxed Block of Copper", waxed_weathered_copper: "Waxed Weathered Copper", waxed_exposed_copper: "Waxed Exposed Copper", waxed_oxidized_copper: "Waxed Oxidized Copper", waxed_oxidized_cut_copper: "Waxed Oxidized Cut Copper", waxed_weathered_cut_copper: "Waxed Weathered Cut Copper", waxed_exposed_cut_copper: "Waxed Exposed Cut Copper", waxed_cut_copper: "Waxed Cut Copper", waxed_oxidized_cut_copper_stairs: "Waxed Oxidized Cut Copper Stairs", waxed_weathered_cut_copper_stairs: "Waxed Weathered Cut Copper Stairs", waxed_exposed_cut_copper_stairs: "Waxed Exposed Cut Copper Stairs", waxed_cut_copper_stairs: "Waxed Cut Copper Stairs", waxed_oxidized_cut_copper_slab: "Waxed Oxidized Cut Copper Slab", waxed_weathered_cut_copper_slab: "Waxed Weathered Cut Copper Slab", waxed_exposed_cut_copper_slab: "Waxed Exposed Cut Copper Slab", waxed_cut_copper_slab: "Waxed Cut Copper Slab", copper_door: "Copper Door", exposed_copper_door: "Exposed Copper Door", oxidized_copper_door: "Oxidized Copper Door", weathered_copper_door: "Weathered Copper Door", waxed_copper_door: "Waxed Copper Door", waxed_exposed_copper_door: "Waxed Exposed Copper Door", waxed_oxidized_copper_door: "Waxed Oxidized Copper Door", waxed_weathered_copper_door: "Waxed Weathered Copper Door", copper_trapdoor: "Copper Trapdoor", exposed_copper_trapdoor: "Exposed Copper Trapdoor", oxidized_copper_trapdoor: "Oxidized Copper Trapdoor", weathered_copper_trapdoor: "Weathered Copper Trapdoor", waxed_copper_trapdoor: "Waxed Copper Trapdoor", waxed_exposed_copper_trapdoor: "Waxed Exposed Copper Trapdoor", waxed_oxidized_copper_trapdoor: "Waxed Oxidized Copper Trapdoor", waxed_weathered_copper_trapdoor: "Waxed Weathered Copper Trapdoor", copper_grate: "Copper Grate", exposed_copper_grate: "Exposed Copper Grate", weathered_copper_grate: "Weathered Copper Grate", oxidized_copper_grate: "Oxidized Copper Grate", waxed_copper_grate: "Waxed Copper Grate", waxed_exposed_copper_grate: "Waxed Exposed Copper Grate", waxed_weathered_copper_grate: "Waxed Weathered Copper Grate", waxed_oxidized_copper_grate: "Waxed Oxidized Copper Grate", copper_bulb: "Copper Bulb", exposed_copper_bulb: "Exposed Copper Bulb", weathered_copper_bulb: "Weathered Copper Bulb", oxidized_copper_bulb: "Oxidized Copper Bulb", waxed_copper_bulb: "Waxed Copper Bulb", waxed_exposed_copper_bulb: "Waxed Exposed Copper Bulb", waxed_weathered_copper_bulb: "Waxed Weathered Copper Bulb", waxed_oxidized_copper_bulb: "Waxed Oxidized Copper Bulb", copper_chest: "Copper Chest", exposed_copper_chest: "Exposed Copper Chest", weathered_copper_chest: "Weathered Copper Chest", oxidized_copper_chest: "Oxidized Copper Chest", waxed_copper_chest: "Waxed Copper Chest", waxed_exposed_copper_chest: "Waxed Exposed Copper Chest", waxed_weathered_copper_chest: "Waxed Weathered Copper Chest", waxed_oxidized_copper_chest: "Waxed Oxidized Copper Chest", copper_golem_statue: "Copper Golem Statue", exposed_copper_golem_statue: "Exposed Copper Golem Statue", weathered_copper_golem_statue: "Weathered Copper Golem Statue", oxidized_copper_golem_statue: "Oxidized Copper Golem Statue", waxed_copper_golem_statue: "Waxed Copper Golem Statue", waxed_exposed_copper_golem_statue: "Waxed Exposed Copper Golem Statue", waxed_weathered_copper_golem_statue: "Waxed Weathered Copper Golem Statue", waxed_oxidized_copper_golem_statue: "Waxed Oxidized Copper Golem Statue", lightning_rod: "Lightning Rod", exposed_lightning_rod: "Exposed Lightning Rod", weathered_lightning_rod: "Weathered Lightning Rod", oxidized_lightning_rod: "Oxidized Lightning Rod", waxed_lightning_rod: "Waxed Lightning Rod", waxed_exposed_lightning_rod: "Waxed Exposed Lightning Rod", waxed_weathered_lightning_rod: "Waxed Weathered Lightning Rod", waxed_oxidized_lightning_rod: "Waxed Oxidized Lightning Rod", pointed_dripstone: "Pointed Dripstone", dripstone_block: "Dripstone Block", cave_vines: "Glow Berries", cave_vines_plant: "Air", spore_blossom: "Spore Blossom", azalea: "Azalea", flowering_azalea: "Flowering Azalea", moss_carpet: "Moss Carpet", pink_petals: "Pink Petals", wildflowers: "Wildflowers", leaf_litter: "Leaf Litter", moss_block: "Moss Block", big_dripleaf: "Big Dripleaf", big_dripleaf_stem: "Air", small_dripleaf: "Small Dripleaf", hanging_roots: "Hanging Roots", rooted_dirt: "Rooted Dirt", mud: "Mud", deepslate: "Deepslate", cobbled_deepslate: "Cobbled Deepslate", cobbled_deepslate_stairs: "Cobbled Deepslate Stairs", cobbled_deepslate_slab: "Cobbled Deepslate Slab", cobbled_deepslate_wall: "Cobbled Deepslate Wall", polished_deepslate: "Polished Deepslate", polished_deepslate_stairs: "Polished Deepslate Stairs", polished_deepslate_slab: "Polished Deepslate Slab", polished_deepslate_wall: "Polished Deepslate Wall", deepslate_tiles: "Deepslate Tiles", deepslate_tile_stairs: "Deepslate Tile Stairs", deepslate_tile_slab: "Deepslate Tile Slab", deepslate_tile_wall: "Deepslate Tile Wall", deepslate_bricks: "Deepslate Bricks", deepslate_brick_stairs: "Deepslate Brick Stairs", deepslate_brick_slab: "Deepslate Brick Slab", deepslate_brick_wall: "Deepslate Brick Wall", chiseled_deepslate: "Chiseled Deepslate", cracked_deepslate_bricks: "Cracked Deepslate Bricks", cracked_deepslate_tiles: "Cracked Deepslate Tiles", infested_deepslate: "Infested Deepslate", smooth_basalt: "Smooth Basalt", raw_iron_block: "Block of Raw Iron", raw_copper_block: "Block of Raw Copper", raw_gold_block: "Block of Raw Gold", potted_azalea_bush: "Air", potted_flowering_azalea_bush: "Air", ochre_froglight: "Ochre Froglight", verdant_froglight: "Verdant Froglight", pearlescent_froglight: "Pearlescent Froglight", frogspawn: "Frogspawn", reinforced_deepslate: "Reinforced Deepslate", decorated_pot: "Decorated Pot", crafter: "Crafter", trial_spawner: "Trial Spawner", vault: "Vault", heavy_core: "Heavy Core", pale_moss_block: "Pale Moss Block", pale_moss_carpet: "Pale Moss Carpet", pale_hanging_moss: "Pale Hanging Moss", open_eyeblossom: "Open Eyeblossom", closed_eyeblossom: "Closed Eyeblossom", potted_open_eyeblossom: "Potted Open Eyeblossom", potted_closed_eyeblossom: "Potted Closed Eyeblossom", firefly_bush: "Firefly Bush", chain: "Chain", grass: "Grass", grass_path: "Grass Path", sign: "Sign", wall_sign: "Wall Sign" }, fullCubes: ["acacia_leaves", "acacia_log", "acacia_planks", "acacia_wood", "amethyst_block", "ancient_debris", "andesite", "azalea_leaves", "bamboo_block", "bamboo_mosaic", "bamboo_planks", "barrel", "barrier", "basalt", "beacon", "bedrock", "bee_nest", "beehive", "birch_leaves", "birch_log", "birch_planks", "birch_wood", "black_concrete", "black_concrete_powder", "black_glazed_terracotta", "black_shulker_box", "black_stained_glass", "black_terracotta", "black_wool", "blackstone", "blast_furnace", "blue_concrete", "blue_concrete_powder", "blue_glazed_terracotta", "blue_ice", "blue_shulker_box", "blue_stained_glass", "blue_terracotta", "blue_wool", "bone_block", "bookshelf", "brain_coral_block", "bricks", "brown_concrete", "brown_concrete_powder", "brown_glazed_terracotta", "brown_mushroom_block", "brown_shulker_box", "brown_stained_glass", "brown_terracotta", "brown_wool", "bubble_coral_block", "budding_amethyst", "calcite", "cartography_table", "carved_pumpkin", "chain_command_block", "cherry_leaves", "cherry_log", "cherry_planks", "cherry_wood", "chiseled_bookshelf", "chiseled_copper", "chiseled_deepslate", "chiseled_nether_bricks", "chiseled_polished_blackstone", "chiseled_quartz_block", "chiseled_red_sandstone", "chiseled_resin_bricks", "chiseled_sandstone", "chiseled_stone_bricks", "chiseled_tuff", "chiseled_tuff_bricks", "chorus_flower", "clay", "coal_block", "coal_ore", "coarse_dirt", "cobbled_deepslate", "cobblestone", "command_block", "copper_block", "copper_bulb", "copper_grate", "copper_ore", "cracked_deepslate_bricks", "cracked_deepslate_tiles", "cracked_nether_bricks", "cracked_polished_blackstone_bricks", "cracked_stone_bricks", "crafter", "crafting_table", "creaking_heart", "crimson_hyphae", "crimson_nylium", "crimson_planks", "crimson_stem", "crying_obsidian", "cut_copper", "cut_red_sandstone", "cut_sandstone", "cyan_concrete", "cyan_concrete_powder", "cyan_glazed_terracotta", "cyan_shulker_box", "cyan_stained_glass", "cyan_terracotta", "cyan_wool", "dark_oak_leaves", "dark_oak_log", "dark_oak_planks", "dark_oak_wood", "dark_prismarine", "dead_brain_coral_block", "dead_bubble_coral_block", "dead_fire_coral_block", "dead_horn_coral_block", "dead_tube_coral_block", "deepslate", "deepslate_bricks", "deepslate_coal_ore", "deepslate_copper_ore", "deepslate_diamond_ore", "deepslate_emerald_ore", "deepslate_gold_ore", "deepslate_iron_ore", "deepslate_lapis_ore", "deepslate_redstone_ore", "deepslate_tiles", "diamond_block", "diamond_ore", "diorite", "dirt", "dispenser", "dried_kelp_block", "dripstone_block", "dropper", "emerald_block", "emerald_ore", "end_stone", "end_stone_bricks", "exposed_chiseled_copper", "exposed_copper", "exposed_copper_bulb", "exposed_copper_grate", "exposed_cut_copper", "fire_coral_block", "fletching_table", "flowering_azalea_leaves", "frosted_ice", "furnace", "gilded_blackstone", "glass", "glowstone", "gold_block", "gold_ore", "granite", "grass_block", "gravel", "gray_concrete", "gray_concrete_powder", "gray_glazed_terracotta", "gray_shulker_box", "gray_stained_glass", "gray_terracotta", "gray_wool", "green_concrete", "green_concrete_powder", "green_glazed_terracotta", "green_shulker_box", "green_stained_glass", "green_terracotta", "green_wool", "hay_block", "honeycomb_block", "horn_coral_block", "ice", "infested_chiseled_stone_bricks", "infested_cobblestone", "infested_cracked_stone_bricks", "infested_deepslate", "infested_mossy_stone_bricks", "infested_stone", "infested_stone_bricks", "iron_block", "iron_ore", "jack_o_lantern", "jigsaw", "jukebox", "jungle_leaves", "jungle_log", "jungle_planks", "jungle_wood", "lapis_block", "lapis_ore", "light_blue_concrete", "light_blue_concrete_powder", "light_blue_glazed_terracotta", "light_blue_shulker_box", "light_blue_stained_glass", "light_blue_terracotta", "light_blue_wool", "light_gray_concrete", "light_gray_concrete_powder", "light_gray_glazed_terracotta", "light_gray_shulker_box", "light_gray_stained_glass", "light_gray_terracotta", "light_gray_wool", "lime_concrete", "lime_concrete_powder", "lime_glazed_terracotta", "lime_shulker_box", "lime_stained_glass", "lime_terracotta", "lime_wool", "lodestone", "loom", "magenta_concrete", "magenta_concrete_powder", "magenta_glazed_terracotta", "magenta_shulker_box", "magenta_stained_glass", "magenta_terracotta", "magenta_wool", "magma_block", "mangrove_leaves", "mangrove_log", "mangrove_planks", "mangrove_roots", "mangrove_wood", "melon", "moss_block", "mossy_cobblestone", "mossy_stone_bricks", "mud_bricks", "muddy_mangrove_roots", "mushroom_stem", "mycelium", "nether_bricks", "nether_gold_ore", "nether_quartz_ore", "nether_wart_block", "netherite_block", "netherrack", "note_block", "oak_leaves", "oak_log", "oak_planks", "oak_wood", "observer", "obsidian", "ochre_froglight", "orange_concrete", "orange_concrete_powder", "orange_glazed_terracotta", "orange_shulker_box", "orange_stained_glass", "orange_terracotta", "orange_wool", "oxidized_chiseled_copper", "oxidized_copper", "oxidized_copper_bulb", "oxidized_copper_grate", "oxidized_cut_copper", "packed_ice", "packed_mud", "pale_moss_block", "pale_oak_leaves", "pale_oak_log", "pale_oak_planks", "pale_oak_wood", "pearlescent_froglight", "pink_concrete", "pink_concrete_powder", "pink_glazed_terracotta", "pink_shulker_box", "pink_stained_glass", "pink_terracotta", "pink_wool", "podzol", "polished_andesite", "polished_basalt", "polished_blackstone", "polished_blackstone_bricks", "polished_deepslate", "polished_diorite", "polished_granite", "polished_tuff", "prismarine", "prismarine_bricks", "pumpkin", "purple_concrete", "purple_concrete_powder", "purple_glazed_terracotta", "purple_shulker_box", "purple_stained_glass", "purple_terracotta", "purple_wool", "purpur_block", "purpur_pillar", "quartz_block", "quartz_bricks", "quartz_pillar", "raw_copper_block", "raw_gold_block", "raw_iron_block", "red_concrete", "red_concrete_powder", "red_glazed_terracotta", "red_mushroom_block", "red_nether_bricks", "red_sand", "red_sandstone", "red_shulker_box", "red_stained_glass", "red_terracotta", "red_wool", "redstone_block", "redstone_lamp", "redstone_ore", "reinforced_deepslate", "repeating_command_block", "resin_block", "resin_bricks", "respawn_anchor", "rooted_dirt", "sand", "sandstone", "sculk", "sculk_catalyst", "sea_lantern", "shroomlight", "shulker_box", "slime_block", "smithing_table", "smoker", "smooth_basalt", "smooth_quartz", "smooth_red_sandstone", "smooth_sandstone", "smooth_stone", "snow_block", "soul_soil", "spawner", "sponge", "spruce_leaves", "spruce_log", "spruce_planks", "spruce_wood", "stone", "stone_bricks", "stripped_acacia_log", "stripped_acacia_wood", "stripped_bamboo_block", "stripped_birch_log", "stripped_birch_wood", "stripped_cherry_log", "stripped_cherry_wood", "stripped_crimson_hyphae", "stripped_crimson_stem", "stripped_dark_oak_log", "stripped_dark_oak_wood", "stripped_jungle_log", "stripped_jungle_wood", "stripped_mangrove_log", "stripped_mangrove_wood", "stripped_oak_log", "stripped_oak_wood", "stripped_pale_oak_log", "stripped_pale_oak_wood", "stripped_spruce_log", "stripped_spruce_wood", "stripped_warped_hyphae", "stripped_warped_stem", "structure_block", "suspicious_gravel", "suspicious_sand", "target", "terracotta", "test_block", "test_instance_block", "tinted_glass", "tnt", "trial_spawner", "tube_coral_block", "tuff", "tuff_bricks", "vault", "verdant_froglight", "warped_hyphae", "warped_nylium", "warped_planks", "warped_stem", "warped_wart_block", "waxed_chiseled_copper", "waxed_copper_block", "waxed_copper_bulb", "waxed_copper_grate", "waxed_cut_copper", "waxed_exposed_chiseled_copper", "waxed_exposed_copper", "waxed_exposed_copper_bulb", "waxed_exposed_copper_grate", "waxed_exposed_cut_copper", "waxed_oxidized_chiseled_copper", "waxed_oxidized_copper", "waxed_oxidized_copper_bulb", "waxed_oxidized_copper_grate", "waxed_oxidized_cut_copper", "waxed_weathered_chiseled_copper", "waxed_weathered_copper", "waxed_weathered_copper_bulb", "waxed_weathered_copper_grate", "waxed_weathered_cut_copper", "weathered_chiseled_copper", "weathered_copper", "weathered_copper_bulb", "weathered_copper_grate", "weathered_cut_copper", "wet_sponge", "white_concrete", "white_concrete_powder", "white_glazed_terracotta", "white_shulker_box", "white_stained_glass", "white_terracotta", "white_wool", "yellow_concrete", "yellow_concrete_powder", "yellow_glazed_terracotta", "yellow_shulker_box", "yellow_stained_glass", "yellow_terracotta", "yellow_wool"], legacyBlocks: { "0:0": "minecraft:air", "1:0": "minecraft:stone", "1:1": "minecraft:granite", "1:2": "minecraft:polished_granite", "1:3": "minecraft:diorite", "1:4": "minecraft:polished_diorite", "1:5": "minecraft:andesite", "1:6": "minecraft:polished_andesite", "2:0": "minecraft:grass_block[snowy=false]", "3:0": "minecraft:dirt", "3:1": "minecraft:coarse_dirt", "3:2": "minecraft:podzol[snowy=false]", "4:0": "minecraft:cobblestone", "5:0": "minecraft:oak_planks", "5:1": "minecraft:spruce_planks", "5:2": "minecraft:birch_planks", "5:3": "minecraft:jungle_planks", "5:4": "minecraft:acacia_planks", "5:5": "minecraft:dark_oak_planks", "6:0": "minecraft:oak_sapling[stage=0]", "6:1": "minecraft:spruce_sapling[stage=0]", "6:2": "minecraft:birch_sapling[stage=0]", "6:3": "minecraft:jungle_sapling[stage=0]", "6:4": "minecraft:acacia_sapling[stage=0]", "6:5": "minecraft:dark_oak_sapling[stage=0]", "6:8": "minecraft:oak_sapling[stage=1]", "6:9": "minecraft:spruce_sapling[stage=1]", "6:10": "minecraft:birch_sapling[stage=1]", "6:11": "minecraft:jungle_sapling[stage=1]", "6:12": "minecraft:acacia_sapling[stage=1]", "6:13": "minecraft:dark_oak_sapling[stage=1]", "7:0": "minecraft:bedrock", "8:0": "minecraft:water[level=0]", "8:1": "minecraft:water[level=1]", "8:2": "minecraft:water[level=2]", "8:3": "minecraft:water[level=3]", "8:4": "minecraft:water[level=4]", "8:5": "minecraft:water[level=5]", "8:6": "minecraft:water[level=6]", "8:7": "minecraft:water[level=7]", "8:8": "minecraft:water[level=8]", "8:9": "minecraft:water[level=9]", "8:10": "minecraft:water[level=10]", "8:11": "minecraft:water[level=11]", "8:12": "minecraft:water[level=12]", "8:13": "minecraft:water[level=13]", "8:14": "minecraft:water[level=14]", "8:15": "minecraft:water[level=15]", "9:0": "minecraft:water[level=0]", "9:1": "minecraft:water[level=1]", "9:2": "minecraft:water[level=2]", "9:3": "minecraft:water[level=3]", "9:4": "minecraft:water[level=4]", "9:5": "minecraft:water[level=5]", "9:6": "minecraft:water[level=6]", "9:7": "minecraft:water[level=7]", "9:8": "minecraft:water[level=8]", "9:9": "minecraft:water[level=9]", "9:10": "minecraft:water[level=10]", "9:11": "minecraft:water[level=11]", "9:12": "minecraft:water[level=12]", "9:13": "minecraft:water[level=13]", "9:14": "minecraft:water[level=14]", "9:15": "minecraft:water[level=15]", "10:0": "minecraft:lava[level=0]", "10:1": "minecraft:lava[level=1]", "10:2": "minecraft:lava[level=2]", "10:3": "minecraft:lava[level=3]", "10:4": "minecraft:lava[level=4]", "10:5": "minecraft:lava[level=5]", "10:6": "minecraft:lava[level=6]", "10:7": "minecraft:lava[level=7]", "10:8": "minecraft:lava[level=8]", "10:9": "minecraft:lava[level=9]", "10:10": "minecraft:lava[level=10]", "10:11": "minecraft:lava[level=11]", "10:12": "minecraft:lava[level=12]", "10:13": "minecraft:lava[level=13]", "10:14": "minecraft:lava[level=14]", "10:15": "minecraft:lava[level=15]", "11:0": "minecraft:lava[level=0]", "11:1": "minecraft:lava[level=1]", "11:2": "minecraft:lava[level=2]", "11:3": "minecraft:lava[level=3]", "11:4": "minecraft:lava[level=4]", "11:5": "minecraft:lava[level=5]", "11:6": "minecraft:lava[level=6]", "11:7": "minecraft:lava[level=7]", "11:8": "minecraft:lava[level=8]", "11:9": "minecraft:lava[level=9]", "11:10": "minecraft:lava[level=10]", "11:11": "minecraft:lava[level=11]", "11:12": "minecraft:lava[level=12]", "11:13": "minecraft:lava[level=13]", "11:14": "minecraft:lava[level=14]", "11:15": "minecraft:lava[level=15]", "12:0": "minecraft:sand", "12:1": "minecraft:red_sand", "13:0": "minecraft:gravel", "14:0": "minecraft:gold_ore", "15:0": "minecraft:iron_ore", "16:0": "minecraft:coal_ore", "17:0": "minecraft:oak_log[axis=y]", "17:1": "minecraft:spruce_log[axis=y]", "17:2": "minecraft:birch_log[axis=y]", "17:3": "minecraft:jungle_log[axis=y]", "17:4": "minecraft:oak_log[axis=x]", "17:5": "minecraft:spruce_log[axis=x]", "17:6": "minecraft:birch_log[axis=x]", "17:7": "minecraft:jungle_log[axis=x]", "17:8": "minecraft:oak_log[axis=z]", "17:9": "minecraft:spruce_log[axis=z]", "17:10": "minecraft:birch_log[axis=z]", "17:11": "minecraft:jungle_log[axis=z]", "17:12": "minecraft:oak_wood", "17:13": "minecraft:spruce_wood", "17:14": "minecraft:birch_wood", "17:15": "minecraft:jungle_wood", "18:0": "minecraft:oak_leaves[persistent=false,distance=1]", "18:1": "minecraft:spruce_leaves[persistent=false,distance=1]", "18:2": "minecraft:birch_leaves[persistent=false,distance=1]", "18:3": "minecraft:jungle_leaves[persistent=false,distance=1]", "18:4": "minecraft:oak_leaves[persistent=true,distance=1]", "18:5": "minecraft:spruce_leaves[persistent=true,distance=1]", "18:6": "minecraft:birch_leaves[persistent=true,distance=1]", "18:7": "minecraft:jungle_leaves[persistent=true,distance=1]", "18:8": "minecraft:oak_leaves[persistent=false,distance=1]", "18:9": "minecraft:spruce_leaves[persistent=false,distance=1]", "18:10": "minecraft:birch_leaves[persistent=false,distance=1]", "18:11": "minecraft:jungle_leaves[persistent=false,distance=1]", "18:12": "minecraft:oak_leaves[persistent=true,distance=1]", "18:13": "minecraft:spruce_leaves[persistent=true,distance=1]", "18:14": "minecraft:birch_leaves[persistent=true,distance=1]", "18:15": "minecraft:jungle_leaves[persistent=true,distance=1]", "19:0": "minecraft:sponge", "19:1": "minecraft:wet_sponge", "20:0": "minecraft:glass", "21:0": "minecraft:lapis_ore", "22:0": "minecraft:lapis_block", "23:0": "minecraft:dispenser[triggered=false,facing=down]", "23:1": "minecraft:dispenser[triggered=false,facing=up]", "23:2": "minecraft:dispenser[triggered=false,facing=north]", "23:3": "minecraft:dispenser[triggered=false,facing=south]", "23:4": "minecraft:dispenser[triggered=false,facing=west]", "23:5": "minecraft:dispenser[triggered=false,facing=east]", "23:8": "minecraft:dispenser[triggered=true,facing=down]", "23:9": "minecraft:dispenser[triggered=true,facing=up]", "23:10": "minecraft:dispenser[triggered=true,facing=north]", "23:11": "minecraft:dispenser[triggered=true,facing=south]", "23:12": "minecraft:dispenser[triggered=true,facing=west]", "23:13": "minecraft:dispenser[triggered=true,facing=east]", "24:0": "minecraft:sandstone", "24:1": "minecraft:chiseled_sandstone", "24:2": "minecraft:cut_sandstone", "25:0": "minecraft:note_block", "26:0": "minecraft:red_bed[part=foot,facing=south,occupied=false]", "26:1": "minecraft:red_bed[part=foot,facing=west,occupied=false]", "26:2": "minecraft:red_bed[part=foot,facing=north,occupied=false]", "26:3": "minecraft:red_bed[part=foot,facing=east,occupied=false]", "26:4": "minecraft:red_bed[part=foot,facing=south,occupied=true]", "26:5": "minecraft:red_bed[part=foot,facing=west,occupied=true]", "26:6": "minecraft:red_bed[part=foot,facing=north,occupied=true]", "26:7": "minecraft:red_bed[part=foot,facing=east,occupied=true]", "26:8": "minecraft:red_bed[part=head,facing=south,occupied=false]", "26:9": "minecraft:red_bed[part=head,facing=west,occupied=false]", "26:10": "minecraft:red_bed[part=head,facing=north,occupied=false]", "26:11": "minecraft:red_bed[part=head,facing=east,occupied=false]", "26:12": "minecraft:red_bed[part=head,facing=south,occupied=true]", "26:13": "minecraft:red_bed[part=head,facing=west,occupied=true]", "26:14": "minecraft:red_bed[part=head,facing=north,occupied=true]", "26:15": "minecraft:red_bed[part=head,facing=east,occupied=true]", "27:0": "minecraft:powered_rail[shape=north_south,powered=false]", "27:1": "minecraft:powered_rail[shape=east_west,powered=false]", "27:2": "minecraft:powered_rail[shape=ascending_east,powered=false]", "27:3": "minecraft:powered_rail[shape=ascending_west,powered=false]", "27:4": "minecraft:powered_rail[shape=ascending_north,powered=false]", "27:5": "minecraft:powered_rail[shape=ascending_south,powered=false]", "27:8": "minecraft:powered_rail[shape=north_south,powered=true]", "27:9": "minecraft:powered_rail[shape=east_west,powered=true]", "27:10": "minecraft:powered_rail[shape=ascending_east,powered=true]", "27:11": "minecraft:powered_rail[shape=ascending_west,powered=true]", "27:12": "minecraft:powered_rail[shape=ascending_north,powered=true]", "27:13": "minecraft:powered_rail[shape=ascending_south,powered=true]", "28:0": "minecraft:detector_rail[shape=north_south,powered=false]", "28:1": "minecraft:detector_rail[shape=east_west,powered=false]", "28:2": "minecraft:detector_rail[shape=ascending_east,powered=false]", "28:3": "minecraft:detector_rail[shape=ascending_west,powered=false]", "28:4": "minecraft:detector_rail[shape=ascending_north,powered=false]", "28:5": "minecraft:detector_rail[shape=ascending_south,powered=false]", "28:8": "minecraft:detector_rail[shape=north_south,powered=true]", "28:9": "minecraft:detector_rail[shape=east_west,powered=true]", "28:10": "minecraft:detector_rail[shape=ascending_east,powered=true]", "28:11": "minecraft:detector_rail[shape=ascending_west,powered=true]", "28:12": "minecraft:detector_rail[shape=ascending_north,powered=true]", "28:13": "minecraft:detector_rail[shape=ascending_south,powered=true]", "29:0": "minecraft:sticky_piston[facing=down,extended=false]", "29:1": "minecraft:sticky_piston[facing=up,extended=false]", "29:2": "minecraft:sticky_piston[facing=north,extended=false]", "29:3": "minecraft:sticky_piston[facing=south,extended=false]", "29:4": "minecraft:sticky_piston[facing=west,extended=false]", "29:5": "minecraft:sticky_piston[facing=east,extended=false]", "29:8": "minecraft:sticky_piston[facing=down,extended=true]", "29:9": "minecraft:sticky_piston[facing=up,extended=true]", "29:10": "minecraft:sticky_piston[facing=north,extended=true]", "29:11": "minecraft:sticky_piston[facing=south,extended=true]", "29:12": "minecraft:sticky_piston[facing=west,extended=true]", "29:13": "minecraft:sticky_piston[facing=east,extended=true]", "30:0": "minecraft:cobweb", "31:0": "minecraft:dead_bush", "31:1": "minecraft:grass", "31:2": "minecraft:fern", "32:0": "minecraft:dead_bush", "33:0": "minecraft:piston[facing=down,extended=false]", "33:1": "minecraft:piston[facing=up,extended=false]", "33:2": "minecraft:piston[facing=north,extended=false]", "33:3": "minecraft:piston[facing=south,extended=false]", "33:4": "minecraft:piston[facing=west,extended=false]", "33:5": "minecraft:piston[facing=east,extended=false]", "33:8": "minecraft:piston[facing=down,extended=true]", "33:9": "minecraft:piston[facing=up,extended=true]", "33:10": "minecraft:piston[facing=north,extended=true]", "33:11": "minecraft:piston[facing=south,extended=true]", "33:12": "minecraft:piston[facing=west,extended=true]", "33:13": "minecraft:piston[facing=east,extended=true]", "34:0": "minecraft:piston_head[short=false,facing=down,type=normal]", "34:1": "minecraft:piston_head[short=false,facing=up,type=normal]", "34:2": "minecraft:piston_head[short=false,facing=north,type=normal]", "34:3": "minecraft:piston_head[short=false,facing=south,type=normal]", "34:4": "minecraft:piston_head[short=false,facing=west,type=normal]", "34:5": "minecraft:piston_head[short=false,facing=east,type=normal]", "34:8": "minecraft:piston_head[short=false,facing=down,type=sticky]", "34:9": "minecraft:piston_head[short=false,facing=up,type=sticky]", "34:10": "minecraft:piston_head[short=false,facing=north,type=sticky]", "34:11": "minecraft:piston_head[short=false,facing=south,type=sticky]", "34:12": "minecraft:piston_head[short=false,facing=west,type=sticky]", "34:13": "minecraft:piston_head[short=false,facing=east,type=sticky]", "35:0": "minecraft:white_wool", "35:1": "minecraft:orange_wool", "35:2": "minecraft:magenta_wool", "35:3": "minecraft:light_blue_wool", "35:4": "minecraft:yellow_wool", "35:5": "minecraft:lime_wool", "35:6": "minecraft:pink_wool", "35:7": "minecraft:gray_wool", "35:8": "minecraft:light_gray_wool", "35:9": "minecraft:cyan_wool", "35:10": "minecraft:purple_wool", "35:11": "minecraft:blue_wool", "35:12": "minecraft:brown_wool", "35:13": "minecraft:green_wool", "35:14": "minecraft:red_wool", "35:15": "minecraft:black_wool", "36:0": "minecraft:moving_piston[facing=down,type=normal]", "36:1": "minecraft:moving_piston[facing=up,type=normal]", "36:2": "minecraft:moving_piston[facing=north,type=normal]", "36:3": "minecraft:moving_piston[facing=south,type=normal]", "36:4": "minecraft:moving_piston[facing=west,type=normal]", "36:5": "minecraft:moving_piston[facing=east,type=normal]", "36:8": "minecraft:moving_piston[facing=down,type=sticky]", "36:9": "minecraft:moving_piston[facing=up,type=sticky]", "36:10": "minecraft:moving_piston[facing=north,type=sticky]", "36:11": "minecraft:moving_piston[facing=south,type=sticky]", "36:12": "minecraft:moving_piston[facing=west,type=sticky]", "36:13": "minecraft:moving_piston[facing=east,type=sticky]", "37:0": "minecraft:dandelion", "38:0": "minecraft:poppy", "38:1": "minecraft:blue_orchid", "38:2": "minecraft:allium", "38:3": "minecraft:azure_bluet", "38:4": "minecraft:red_tulip", "38:5": "minecraft:orange_tulip", "38:6": "minecraft:white_tulip", "38:7": "minecraft:pink_tulip", "38:8": "minecraft:oxeye_daisy", "39:0": "minecraft:brown_mushroom", "40:0": "minecraft:red_mushroom", "41:0": "minecraft:gold_block", "42:0": "minecraft:iron_block", "43:0": "minecraft:stone_slab[type=double]", "43:1": "minecraft:sandstone_slab[type=double]", "43:2": "minecraft:petrified_oak_slab[type=double]", "43:3": "minecraft:cobblestone_slab[type=double]", "43:4": "minecraft:brick_slab[type=double]", "43:5": "minecraft:stone_brick_slab[type=double]", "43:6": "minecraft:nether_brick_slab[type=double]", "43:7": "minecraft:quartz_slab[type=double]", "43:8": "minecraft:smooth_stone", "43:9": "minecraft:smooth_sandstone", "43:10": "minecraft:petrified_oak_slab[type=double]", "43:11": "minecraft:cobblestone_slab[type=double]", "43:12": "minecraft:brick_slab[type=double]", "43:13": "minecraft:stone_brick_slab[type=double]", "43:14": "minecraft:nether_brick_slab[type=double]", "43:15": "minecraft:smooth_quartz", "44:0": "minecraft:stone_slab[type=bottom]", "44:1": "minecraft:sandstone_slab[type=bottom]", "44:2": "minecraft:petrified_oak_slab[type=bottom]", "44:3": "minecraft:cobblestone_slab[type=bottom]", "44:4": "minecraft:brick_slab[type=bottom]", "44:5": "minecraft:stone_brick_slab[type=bottom]", "44:6": "minecraft:nether_brick_slab[type=bottom]", "44:7": "minecraft:quartz_slab[type=bottom]", "44:8": "minecraft:stone_slab[type=top]", "44:9": "minecraft:sandstone_slab[type=top]", "44:10": "minecraft:petrified_oak_slab[type=top]", "44:11": "minecraft:cobblestone_slab[type=top]", "44:12": "minecraft:brick_slab[type=top]", "44:13": "minecraft:stone_brick_slab[type=top]", "44:14": "minecraft:nether_brick_slab[type=top]", "44:15": "minecraft:quartz_slab[type=top]", "45:0": "minecraft:bricks", "46:0": "minecraft:tnt[unstable=false]", "46:1": "minecraft:tnt[unstable=true]", "47:0": "minecraft:bookshelf", "48:0": "minecraft:mossy_cobblestone", "49:0": "minecraft:obsidian", "50:1": "minecraft:wall_torch[facing=east]", "50:2": "minecraft:wall_torch[facing=west]", "50:3": "minecraft:wall_torch[facing=south]", "50:4": "minecraft:wall_torch[facing=north]", "50:5": "minecraft:torch", "51:0": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=0]", "51:1": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=1]", "51:2": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=2]", "51:3": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=3]", "51:4": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=4]", "51:5": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=5]", "51:6": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=6]", "51:7": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=7]", "51:8": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=8]", "51:9": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=9]", "51:10": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=10]", "51:11": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=11]", "51:12": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=12]", "51:13": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=13]", "51:14": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=14]", "51:15": "minecraft:fire[east=false,south=false,north=false,west=false,up=false,age=15]", "52:0": "minecraft:spawner", "53:0": "minecraft:oak_stairs[half=bottom,shape=outer_right,facing=east]", "53:1": "minecraft:oak_stairs[half=bottom,shape=outer_right,facing=west]", "53:2": "minecraft:oak_stairs[half=bottom,shape=outer_right,facing=south]", "53:3": "minecraft:oak_stairs[half=bottom,shape=outer_right,facing=north]", "53:4": "minecraft:oak_stairs[half=top,shape=outer_right,facing=east]", "53:5": "minecraft:oak_stairs[half=top,shape=outer_right,facing=west]", "53:6": "minecraft:oak_stairs[half=top,shape=outer_right,facing=south]", "53:7": "minecraft:oak_stairs[half=top,shape=outer_right,facing=north]", "54:2": "minecraft:chest[facing=north,type=single]", "54:3": "minecraft:chest[facing=south,type=single]", "54:4": "minecraft:chest[facing=west,type=single]", "54:5": "minecraft:chest[facing=east,type=single]", "55:0": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=0]", "55:1": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=1]", "55:2": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=2]", "55:3": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=3]", "55:4": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=4]", "55:5": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=5]", "55:6": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=6]", "55:7": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=7]", "55:8": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=8]", "55:9": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=9]", "55:10": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=10]", "55:11": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=11]", "55:12": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=12]", "55:13": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=13]", "55:14": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=14]", "55:15": "minecraft:redstone_wire[east=none,south=none,north=none,west=none,power=15]", "56:0": "minecraft:diamond_ore", "57:0": "minecraft:diamond_block", "58:0": "minecraft:crafting_table", "59:0": "minecraft:wheat[age=0]", "59:1": "minecraft:wheat[age=1]", "59:2": "minecraft:wheat[age=2]", "59:3": "minecraft:wheat[age=3]", "59:4": "minecraft:wheat[age=4]", "59:5": "minecraft:wheat[age=5]", "59:6": "minecraft:wheat[age=6]", "59:7": "minecraft:wheat[age=7]", "60:0": "minecraft:farmland[moisture=0]", "60:1": "minecraft:farmland[moisture=1]", "60:2": "minecraft:farmland[moisture=2]", "60:3": "minecraft:farmland[moisture=3]", "60:4": "minecraft:farmland[moisture=4]", "60:5": "minecraft:farmland[moisture=5]", "60:6": "minecraft:farmland[moisture=6]", "60:7": "minecraft:farmland[moisture=7]", "61:2": "minecraft:furnace[facing=north,lit=false]", "61:3": "minecraft:furnace[facing=south,lit=false]", "61:4": "minecraft:furnace[facing=west,lit=false]", "61:5": "minecraft:furnace[facing=east,lit=false]", "62:2": "minecraft:furnace[facing=north,lit=true]", "62:3": "minecraft:furnace[facing=south,lit=true]", "62:4": "minecraft:furnace[facing=west,lit=true]", "62:5": "minecraft:furnace[facing=east,lit=true]", "63:0": "minecraft:sign[rotation=0]", "63:1": "minecraft:sign[rotation=1]", "63:2": "minecraft:sign[rotation=2]", "63:3": "minecraft:sign[rotation=3]", "63:4": "minecraft:sign[rotation=4]", "63:5": "minecraft:sign[rotation=5]", "63:6": "minecraft:sign[rotation=6]", "63:7": "minecraft:sign[rotation=7]", "63:8": "minecraft:sign[rotation=8]", "63:9": "minecraft:sign[rotation=9]", "63:10": "minecraft:sign[rotation=10]", "63:11": "minecraft:sign[rotation=11]", "63:12": "minecraft:sign[rotation=12]", "63:13": "minecraft:sign[rotation=13]", "63:14": "minecraft:sign[rotation=14]", "63:15": "minecraft:sign[rotation=15]", "64:0": "minecraft:oak_door[hinge=right,half=lower,powered=false,facing=east,open=false]", "64:1": "minecraft:oak_door[hinge=right,half=lower,powered=false,facing=south,open=false]", "64:2": "minecraft:oak_door[hinge=right,half=lower,powered=false,facing=west,open=false]", "64:3": "minecraft:oak_door[hinge=right,half=lower,powered=false,facing=north,open=false]", "64:4": "minecraft:oak_door[hinge=right,half=lower,powered=false,facing=east,open=true]", "64:5": "minecraft:oak_door[hinge=right,half=lower,powered=false,facing=south,open=true]", "64:6": "minecraft:oak_door[hinge=right,half=lower,powered=false,facing=west,open=true]", "64:7": "minecraft:oak_door[hinge=right,half=lower,powered=false,facing=north,open=true]", "64:8": "minecraft:oak_door[hinge=left,half=upper,powered=false,facing=east,open=false]", "64:9": "minecraft:oak_door[hinge=right,half=upper,powered=false,facing=east,open=false]", "64:10": "minecraft:oak_door[hinge=left,half=upper,powered=true,facing=east,open=false]", "64:11": "minecraft:oak_door[hinge=right,half=upper,powered=true,facing=east,open=false]", "65:2": "minecraft:ladder[facing=north]", "65:3": "minecraft:ladder[facing=south]", "65:4": "minecraft:ladder[facing=west]", "65:5": "minecraft:ladder[facing=east]", "66:0": "minecraft:rail[shape=north_south]", "66:1": "minecraft:rail[shape=east_west]", "66:2": "minecraft:rail[shape=ascending_east]", "66:3": "minecraft:rail[shape=ascending_west]", "66:4": "minecraft:rail[shape=ascending_north]", "66:5": "minecraft:rail[shape=ascending_south]", "66:6": "minecraft:rail[shape=south_east]", "66:7": "minecraft:rail[shape=south_west]", "66:8": "minecraft:rail[shape=north_west]", "66:9": "minecraft:rail[shape=north_east]", "67:0": "minecraft:cobblestone_stairs[half=bottom,shape=straight,facing=east]", "67:1": "minecraft:cobblestone_stairs[half=bottom,shape=straight,facing=west]", "67:2": "minecraft:cobblestone_stairs[half=bottom,shape=straight,facing=south]", "67:3": "minecraft:cobblestone_stairs[half=bottom,shape=straight,facing=north]", "67:4": "minecraft:cobblestone_stairs[half=top,shape=straight,facing=east]", "67:5": "minecraft:cobblestone_stairs[half=top,shape=straight,facing=west]", "67:6": "minecraft:cobblestone_stairs[half=top,shape=straight,facing=south]", "67:7": "minecraft:cobblestone_stairs[half=top,shape=straight,facing=north]", "68:2": "minecraft:wall_sign[facing=north]", "68:3": "minecraft:wall_sign[facing=south]", "68:4": "minecraft:wall_sign[facing=west]", "68:5": "minecraft:wall_sign[facing=east]", "69:0": "minecraft:lever[powered=false,facing=north,face=ceiling]", "69:1": "minecraft:lever[powered=false,facing=east,face=wall]", "69:2": "minecraft:lever[powered=false,facing=west,face=wall]", "69:3": "minecraft:lever[powered=false,facing=south,face=wall]", "69:4": "minecraft:lever[powered=false,facing=north,face=wall]", "69:5": "minecraft:lever[powered=false,facing=east,face=floor]", "69:6": "minecraft:lever[powered=false,facing=north,face=floor]", "69:7": "minecraft:lever[powered=false,facing=east,face=ceiling]", "69:8": "minecraft:lever[powered=true,facing=north,face=ceiling]", "69:9": "minecraft:lever[powered=true,facing=east,face=wall]", "69:10": "minecraft:lever[powered=true,facing=west,face=wall]", "69:11": "minecraft:lever[powered=true,facing=south,face=wall]", "69:12": "minecraft:lever[powered=true,facing=north,face=wall]", "69:13": "minecraft:lever[powered=true,facing=east,face=floor]", "69:14": "minecraft:lever[powered=true,facing=north,face=floor]", "69:15": "minecraft:lever[powered=true,facing=east,face=ceiling]", "70:0": "minecraft:stone_pressure_plate[powered=false]", "70:1": "minecraft:stone_pressure_plate[powered=true]", "71:0": "minecraft:iron_door[hinge=right,half=lower,powered=false,facing=east,open=false]", "71:1": "minecraft:iron_door[hinge=right,half=lower,powered=false,facing=south,open=false]", "71:2": "minecraft:iron_door[hinge=right,half=lower,powered=false,facing=west,open=false]", "71:3": "minecraft:iron_door[hinge=right,half=lower,powered=false,facing=north,open=false]", "71:4": "minecraft:iron_door[hinge=right,half=lower,powered=false,facing=east,open=true]", "71:5": "minecraft:iron_door[hinge=right,half=lower,powered=false,facing=south,open=true]", "71:6": "minecraft:iron_door[hinge=right,half=lower,powered=false,facing=west,open=true]", "71:7": "minecraft:iron_door[hinge=right,half=lower,powered=false,facing=north,open=true]", "71:8": "minecraft:iron_door[hinge=left,half=upper,powered=false,facing=east,open=false]", "71:9": "minecraft:iron_door[hinge=right,half=upper,powered=false,facing=east,open=false]", "71:10": "minecraft:iron_door[hinge=left,half=upper,powered=true,facing=east,open=false]", "71:11": "minecraft:iron_door[hinge=right,half=upper,powered=true,facing=east,open=false]", "72:0": "minecraft:oak_pressure_plate[powered=false]", "72:1": "minecraft:oak_pressure_plate[powered=true]", "73:0": "minecraft:redstone_ore[lit=false]", "74:0": "minecraft:redstone_ore[lit=true]", "75:1": "minecraft:redstone_wall_torch[facing=east,lit=false]", "75:2": "minecraft:redstone_wall_torch[facing=west,lit=false]", "75:3": "minecraft:redstone_wall_torch[facing=south,lit=false]", "75:4": "minecraft:redstone_wall_torch[facing=north,lit=false]", "75:5": "minecraft:redstone_torch[lit=false]", "76:1": "minecraft:redstone_wall_torch[facing=east,lit=true]", "76:2": "minecraft:redstone_wall_torch[facing=west,lit=true]", "76:3": "minecraft:redstone_wall_torch[facing=south,lit=true]", "76:4": "minecraft:redstone_wall_torch[facing=north,lit=true]", "76:5": "minecraft:redstone_torch[lit=true]", "77:0": "minecraft:stone_button[powered=false,facing=east,face=ceiling]", "77:1": "minecraft:stone_button[powered=false,facing=east,face=wall]", "77:2": "minecraft:stone_button[powered=false,facing=west,face=wall]", "77:3": "minecraft:stone_button[powered=false,facing=south,face=wall]", "77:4": "minecraft:stone_button[powered=false,facing=north,face=wall]", "77:5": "minecraft:stone_button[powered=false,facing=east,face=floor]", "77:8": "minecraft:stone_button[powered=true,facing=south,face=ceiling]", "77:9": "minecraft:stone_button[powered=true,facing=east,face=wall]", "77:10": "minecraft:stone_button[powered=true,facing=west,face=wall]", "77:11": "minecraft:stone_button[powered=true,facing=south,face=wall]", "77:12": "minecraft:stone_button[powered=true,facing=north,face=wall]", "77:13": "minecraft:stone_button[powered=true,facing=south,face=floor]", "78:0": "minecraft:snow[layers=1]", "78:1": "minecraft:snow[layers=2]", "78:2": "minecraft:snow[layers=3]", "78:3": "minecraft:snow[layers=4]", "78:4": "minecraft:snow[layers=5]", "78:5": "minecraft:snow[layers=6]", "78:6": "minecraft:snow[layers=7]", "78:7": "minecraft:snow[layers=8]", "79:0": "minecraft:ice", "80:0": "minecraft:snow_block", "81:0": "minecraft:cactus[age=0]", "81:1": "minecraft:cactus[age=1]", "81:2": "minecraft:cactus[age=2]", "81:3": "minecraft:cactus[age=3]", "81:4": "minecraft:cactus[age=4]", "81:5": "minecraft:cactus[age=5]", "81:6": "minecraft:cactus[age=6]", "81:7": "minecraft:cactus[age=7]", "81:8": "minecraft:cactus[age=8]", "81:9": "minecraft:cactus[age=9]", "81:10": "minecraft:cactus[age=10]", "81:11": "minecraft:cactus[age=11]", "81:12": "minecraft:cactus[age=12]", "81:13": "minecraft:cactus[age=13]", "81:14": "minecraft:cactus[age=14]", "81:15": "minecraft:cactus[age=15]", "82:0": "minecraft:clay", "83:0": "minecraft:sugar_cane[age=0]", "83:1": "minecraft:sugar_cane[age=1]", "83:2": "minecraft:sugar_cane[age=2]", "83:3": "minecraft:sugar_cane[age=3]", "83:4": "minecraft:sugar_cane[age=4]", "83:5": "minecraft:sugar_cane[age=5]", "83:6": "minecraft:sugar_cane[age=6]", "83:7": "minecraft:sugar_cane[age=7]", "83:8": "minecraft:sugar_cane[age=8]", "83:9": "minecraft:sugar_cane[age=9]", "83:10": "minecraft:sugar_cane[age=10]", "83:11": "minecraft:sugar_cane[age=11]", "83:12": "minecraft:sugar_cane[age=12]", "83:13": "minecraft:sugar_cane[age=13]", "83:14": "minecraft:sugar_cane[age=14]", "83:15": "minecraft:sugar_cane[age=15]", "84:0": "minecraft:jukebox[has_record=false]", "84:1": "minecraft:jukebox[has_record=true]", "85:0": "minecraft:oak_fence[east=false,south=false,north=false,west=false]", "86:0": "minecraft:carved_pumpkin[facing=south]", "86:1": "minecraft:carved_pumpkin[facing=west]", "86:2": "minecraft:carved_pumpkin[facing=north]", "86:3": "minecraft:carved_pumpkin[facing=east]", "87:0": "minecraft:netherrack", "88:0": "minecraft:soul_sand", "89:0": "minecraft:glowstone", "90:1": "minecraft:nether_portal[axis=x]", "90:2": "minecraft:nether_portal[axis=z]", "91:0": "minecraft:jack_o_lantern[facing=south]", "91:1": "minecraft:jack_o_lantern[facing=west]", "91:2": "minecraft:jack_o_lantern[facing=north]", "91:3": "minecraft:jack_o_lantern[facing=east]", "92:0": "minecraft:cake[bites=0]", "92:1": "minecraft:cake[bites=1]", "92:2": "minecraft:cake[bites=2]", "92:3": "minecraft:cake[bites=3]", "92:4": "minecraft:cake[bites=4]", "92:5": "minecraft:cake[bites=5]", "92:6": "minecraft:cake[bites=6]", "93:0": "minecraft:repeater[delay=1,facing=south,locked=false,powered=false]", "93:1": "minecraft:repeater[delay=1,facing=west,locked=false,powered=false]", "93:2": "minecraft:repeater[delay=1,facing=north,locked=false,powered=false]", "93:3": "minecraft:repeater[delay=1,facing=east,locked=false,powered=false]", "93:4": "minecraft:repeater[delay=2,facing=south,locked=false,powered=false]", "93:5": "minecraft:repeater[delay=2,facing=west,locked=false,powered=false]", "93:6": "minecraft:repeater[delay=2,facing=north,locked=false,powered=false]", "93:7": "minecraft:repeater[delay=2,facing=east,locked=false,powered=false]", "93:8": "minecraft:repeater[delay=3,facing=south,locked=false,powered=false]", "93:9": "minecraft:repeater[delay=3,facing=west,locked=false,powered=false]", "93:10": "minecraft:repeater[delay=3,facing=north,locked=false,powered=false]", "93:11": "minecraft:repeater[delay=3,facing=east,locked=false,powered=false]", "93:12": "minecraft:repeater[delay=4,facing=south,locked=false,powered=false]", "93:13": "minecraft:repeater[delay=4,facing=west,locked=false,powered=false]", "93:14": "minecraft:repeater[delay=4,facing=north,locked=false,powered=false]", "93:15": "minecraft:repeater[delay=4,facing=east,locked=false,powered=false]", "94:0": "minecraft:repeater[delay=1,facing=south,locked=false,powered=true]", "94:1": "minecraft:repeater[delay=1,facing=west,locked=false,powered=true]", "94:2": "minecraft:repeater[delay=1,facing=north,locked=false,powered=true]", "94:3": "minecraft:repeater[delay=1,facing=east,locked=false,powered=true]", "94:4": "minecraft:repeater[delay=2,facing=south,locked=false,powered=true]", "94:5": "minecraft:repeater[delay=2,facing=west,locked=false,powered=true]", "94:6": "minecraft:repeater[delay=2,facing=north,locked=false,powered=true]", "94:7": "minecraft:repeater[delay=2,facing=east,locked=false,powered=true]", "94:8": "minecraft:repeater[delay=3,facing=south,locked=false,powered=true]", "94:9": "minecraft:repeater[delay=3,facing=west,locked=false,powered=true]", "94:10": "minecraft:repeater[delay=3,facing=north,locked=false,powered=true]", "94:11": "minecraft:repeater[delay=3,facing=east,locked=false,powered=true]", "94:12": "minecraft:repeater[delay=4,facing=south,locked=false,powered=true]", "94:13": "minecraft:repeater[delay=4,facing=west,locked=false,powered=true]", "94:14": "minecraft:repeater[delay=4,facing=north,locked=false,powered=true]", "94:15": "minecraft:repeater[delay=4,facing=east,locked=false,powered=true]", "95:0": "minecraft:white_stained_glass", "95:1": "minecraft:orange_stained_glass", "95:2": "minecraft:magenta_stained_glass", "95:3": "minecraft:light_blue_stained_glass", "95:4": "minecraft:yellow_stained_glass", "95:5": "minecraft:lime_stained_glass", "95:6": "minecraft:pink_stained_glass", "95:7": "minecraft:gray_stained_glass", "95:8": "minecraft:light_gray_stained_glass", "95:9": "minecraft:cyan_stained_glass", "95:10": "minecraft:purple_stained_glass", "95:11": "minecraft:blue_stained_glass", "95:12": "minecraft:brown_stained_glass", "95:13": "minecraft:green_stained_glass", "95:14": "minecraft:red_stained_glass", "95:15": "minecraft:black_stained_glass", "96:0": "minecraft:oak_trapdoor[half=bottom,facing=north,open=false,powered=false]", "96:1": "minecraft:oak_trapdoor[half=bottom,facing=south,open=false,powered=false]", "96:2": "minecraft:oak_trapdoor[half=bottom,facing=west,open=false,powered=false]", "96:3": "minecraft:oak_trapdoor[half=bottom,facing=east,open=false,powered=false]", "96:4": "minecraft:oak_trapdoor[half=bottom,facing=north,open=true,powered=true]", "96:5": "minecraft:oak_trapdoor[half=bottom,facing=south,open=true,powered=true]", "96:6": "minecraft:oak_trapdoor[half=bottom,facing=west,open=true,powered=true]", "96:7": "minecraft:oak_trapdoor[half=bottom,facing=east,open=true,powered=true]", "96:8": "minecraft:oak_trapdoor[half=top,facing=north,open=false,powered=false]", "96:9": "minecraft:oak_trapdoor[half=top,facing=south,open=false,powered=false]", "96:10": "minecraft:oak_trapdoor[half=top,facing=west,open=false,powered=false]", "96:11": "minecraft:oak_trapdoor[half=top,facing=east,open=false,powered=false]", "96:12": "minecraft:oak_trapdoor[half=top,facing=north,open=true,powered=true]", "96:13": "minecraft:oak_trapdoor[half=top,facing=south,open=true,powered=true]", "96:14": "minecraft:oak_trapdoor[half=top,facing=west,open=true,powered=true]", "96:15": "minecraft:oak_trapdoor[half=top,facing=east,open=true,powered=true]", "97:0": "minecraft:infested_stone", "97:1": "minecraft:infested_cobblestone", "97:2": "minecraft:infested_stone_bricks", "97:3": "minecraft:infested_mossy_stone_bricks", "97:4": "minecraft:infested_cracked_stone_bricks", "97:5": "minecraft:infested_chiseled_stone_bricks", "98:0": "minecraft:stone_bricks", "98:1": "minecraft:mossy_stone_bricks", "98:2": "minecraft:cracked_stone_bricks", "98:3": "minecraft:chiseled_stone_bricks", "99:0": "minecraft:brown_mushroom_block[north=false,east=false,south=false,west=false,up=false,down=false]", "99:1": "minecraft:brown_mushroom_block[north=true,east=false,south=false,west=true,up=true,down=false]", "99:2": "minecraft:brown_mushroom_block[north=true,east=false,south=false,west=false,up=true,down=false]", "99:3": "minecraft:brown_mushroom_block[north=true,east=true,south=false,west=false,up=true,down=false]", "99:4": "minecraft:brown_mushroom_block[north=false,east=false,south=false,west=true,up=true,down=false]", "99:5": "minecraft:brown_mushroom_block[north=false,east=false,south=false,west=false,up=true,down=false]", "99:6": "minecraft:brown_mushroom_block[north=false,east=true,south=false,west=false,up=true,down=false]", "99:7": "minecraft:brown_mushroom_block[north=false,east=false,south=true,west=true,up=true,down=false]", "99:8": "minecraft:brown_mushroom_block[north=false,east=false,south=true,west=false,up=true,down=false]", "99:9": "minecraft:brown_mushroom_block[north=false,east=true,south=true,west=false,up=true,down=false]", "99:10": "minecraft:mushroom_stem[north=true,east=true,south=true,west=true,up=false,down=false]", "99:14": "minecraft:brown_mushroom_block[north=true,east=true,south=true,west=true,up=true,down=true]", "99:15": "minecraft:mushroom_stem[north=true,east=true,south=true,west=true,up=true,down=true]", "100:0": "minecraft:red_mushroom_block[north=false,east=false,south=false,west=false,up=false,down=false]", "100:1": "minecraft:red_mushroom_block[north=true,east=false,south=false,west=true,up=true,down=false]", "100:2": "minecraft:red_mushroom_block[north=true,east=false,south=false,west=false,up=true,down=false]", "100:3": "minecraft:red_mushroom_block[north=true,east=true,south=false,west=false,up=true,down=false]", "100:4": "minecraft:red_mushroom_block[north=false,east=false,south=false,west=true,up=true,down=false]", "100:5": "minecraft:red_mushroom_block[north=false,east=false,south=false,west=false,up=true,down=false]", "100:6": "minecraft:red_mushroom_block[north=false,east=true,south=false,west=false,up=true,down=false]", "100:7": "minecraft:red_mushroom_block[north=false,east=false,south=true,west=true,up=true,down=false]", "100:8": "minecraft:red_mushroom_block[north=false,east=false,south=true,west=false,up=true,down=false]", "100:9": "minecraft:red_mushroom_block[north=false,east=true,south=true,west=false,up=true,down=false]", "100:10": "minecraft:mushroom_stem[north=true,east=true,south=true,west=true,up=false,down=false]", "100:14": "minecraft:red_mushroom_block[north=true,east=true,south=true,west=true,up=true,down=true]", "100:15": "minecraft:mushroom_stem[north=true,east=true,south=true,west=true,up=true,down=true]", "101:0": "minecraft:iron_bars[east=false,south=false,north=false,west=false]", "102:0": "minecraft:glass_pane[east=false,south=false,north=false,west=false]", "103:0": "minecraft:melon", "104:0": "minecraft:pumpkin_stem[age=0]", "104:1": "minecraft:pumpkin_stem[age=1]", "104:2": "minecraft:pumpkin_stem[age=2]", "104:3": "minecraft:pumpkin_stem[age=3]", "104:4": "minecraft:pumpkin_stem[age=4]", "104:5": "minecraft:pumpkin_stem[age=5]", "104:6": "minecraft:pumpkin_stem[age=6]", "104:7": "minecraft:pumpkin_stem[age=7]", "105:0": "minecraft:melon_stem[age=0]", "105:1": "minecraft:melon_stem[age=1]", "105:2": "minecraft:melon_stem[age=2]", "105:3": "minecraft:melon_stem[age=3]", "105:4": "minecraft:melon_stem[age=4]", "105:5": "minecraft:melon_stem[age=5]", "105:6": "minecraft:melon_stem[age=6]", "105:7": "minecraft:melon_stem[age=7]", "106:0": "minecraft:vine[east=false,south=false,north=false,west=false,up=false]", "106:1": "minecraft:vine[east=false,south=true,north=false,west=false,up=false]", "106:2": "minecraft:vine[east=false,south=false,north=false,west=true,up=false]", "106:3": "minecraft:vine[east=false,south=true,north=false,west=true,up=false]", "106:4": "minecraft:vine[east=false,south=false,north=true,west=false,up=false]", "106:5": "minecraft:vine[east=false,south=true,north=true,west=false,up=false]", "106:6": "minecraft:vine[east=false,south=false,north=true,west=true,up=false]", "106:7": "minecraft:vine[east=false,south=true,north=true,west=true,up=false]", "106:8": "minecraft:vine[east=true,south=false,north=false,west=false,up=false]", "106:9": "minecraft:vine[east=true,south=true,north=false,west=false,up=false]", "106:10": "minecraft:vine[east=true,south=false,north=false,west=true,up=false]", "106:11": "minecraft:vine[east=true,south=true,north=false,west=true,up=false]", "106:12": "minecraft:vine[east=true,south=false,north=true,west=false,up=false]", "106:13": "minecraft:vine[east=true,south=true,north=true,west=false,up=false]", "106:14": "minecraft:vine[east=true,south=false,north=true,west=true,up=false]", "106:15": "minecraft:vine[east=true,south=true,north=true,west=true,up=false]", "107:0": "minecraft:oak_fence_gate[in_wall=false,powered=false,facing=south,open=false]", "107:1": "minecraft:oak_fence_gate[in_wall=false,powered=false,facing=west,open=false]", "107:2": "minecraft:oak_fence_gate[in_wall=false,powered=false,facing=north,open=false]", "107:3": "minecraft:oak_fence_gate[in_wall=false,powered=false,facing=east,open=false]", "107:4": "minecraft:oak_fence_gate[in_wall=false,powered=false,facing=south,open=true]", "107:5": "minecraft:oak_fence_gate[in_wall=false,powered=false,facing=west,open=true]", "107:6": "minecraft:oak_fence_gate[in_wall=false,powered=false,facing=north,open=true]", "107:7": "minecraft:oak_fence_gate[in_wall=false,powered=false,facing=east,open=true]", "107:8": "minecraft:oak_fence_gate[in_wall=false,powered=true,facing=south,open=false]", "107:9": "minecraft:oak_fence_gate[in_wall=false,powered=true,facing=west,open=false]", "107:10": "minecraft:oak_fence_gate[in_wall=false,powered=true,facing=north,open=false]", "107:11": "minecraft:oak_fence_gate[in_wall=false,powered=true,facing=east,open=false]", "107:12": "minecraft:oak_fence_gate[in_wall=false,powered=true,facing=south,open=true]", "107:13": "minecraft:oak_fence_gate[in_wall=false,powered=true,facing=west,open=true]", "107:14": "minecraft:oak_fence_gate[in_wall=false,powered=true,facing=north,open=true]", "107:15": "minecraft:oak_fence_gate[in_wall=false,powered=true,facing=east,open=true]", "108:0": "minecraft:brick_stairs[half=bottom,shape=straight,facing=east]", "108:1": "minecraft:brick_stairs[half=bottom,shape=straight,facing=west]", "108:2": "minecraft:brick_stairs[half=bottom,shape=straight,facing=south]", "108:3": "minecraft:brick_stairs[half=bottom,shape=straight,facing=north]", "108:4": "minecraft:brick_stairs[half=top,shape=straight,facing=east]", "108:5": "minecraft:brick_stairs[half=top,shape=straight,facing=west]", "108:6": "minecraft:brick_stairs[half=top,shape=straight,facing=south]", "108:7": "minecraft:brick_stairs[half=top,shape=straight,facing=north]", "109:0": "minecraft:stone_brick_stairs[half=bottom,shape=straight,facing=east]", "109:1": "minecraft:stone_brick_stairs[half=bottom,shape=straight,facing=west]", "109:2": "minecraft:stone_brick_stairs[half=bottom,shape=straight,facing=south]", "109:3": "minecraft:stone_brick_stairs[half=bottom,shape=straight,facing=north]", "109:4": "minecraft:stone_brick_stairs[half=top,shape=straight,facing=east]", "109:5": "minecraft:stone_brick_stairs[half=top,shape=straight,facing=west]", "109:6": "minecraft:stone_brick_stairs[half=top,shape=straight,facing=south]", "109:7": "minecraft:stone_brick_stairs[half=top,shape=straight,facing=north]", "110:0": "minecraft:mycelium[snowy=false]", "111:0": "minecraft:lily_pad", "112:0": "minecraft:nether_bricks", "113:0": "minecraft:nether_brick_fence[east=false,south=false,north=false,west=false]", "114:0": "minecraft:nether_brick_stairs[half=bottom,shape=straight,facing=east]", "114:1": "minecraft:nether_brick_stairs[half=bottom,shape=straight,facing=west]", "114:2": "minecraft:nether_brick_stairs[half=bottom,shape=straight,facing=south]", "114:3": "minecraft:nether_brick_stairs[half=bottom,shape=straight,facing=north]", "114:4": "minecraft:nether_brick_stairs[half=top,shape=straight,facing=east]", "114:5": "minecraft:nether_brick_stairs[half=top,shape=straight,facing=west]", "114:6": "minecraft:nether_brick_stairs[half=top,shape=straight,facing=south]", "114:7": "minecraft:nether_brick_stairs[half=top,shape=straight,facing=north]", "115:0": "minecraft:nether_wart[age=0]", "115:1": "minecraft:nether_wart[age=1]", "115:2": "minecraft:nether_wart[age=2]", "115:3": "minecraft:nether_wart[age=3]", "116:0": "minecraft:enchanting_table", "117:0": "minecraft:brewing_stand[has_bottle_0=false,has_bottle_1=false,has_bottle_2=false]", "117:1": "minecraft:brewing_stand[has_bottle_0=true,has_bottle_1=false,has_bottle_2=false]", "117:2": "minecraft:brewing_stand[has_bottle_0=false,has_bottle_1=true,has_bottle_2=false]", "117:3": "minecraft:brewing_stand[has_bottle_0=true,has_bottle_1=true,has_bottle_2=false]", "117:4": "minecraft:brewing_stand[has_bottle_0=false,has_bottle_1=false,has_bottle_2=true]", "117:5": "minecraft:brewing_stand[has_bottle_0=true,has_bottle_1=false,has_bottle_2=true]", "117:6": "minecraft:brewing_stand[has_bottle_0=false,has_bottle_1=true,has_bottle_2=true]", "117:7": "minecraft:brewing_stand[has_bottle_0=true,has_bottle_1=true,has_bottle_2=true]", "118:0": "minecraft:cauldron[level=0]", "118:1": "minecraft:cauldron[level=1]", "118:2": "minecraft:cauldron[level=2]", "118:3": "minecraft:cauldron[level=3]", "119:0": "minecraft:end_portal", "120:0": "minecraft:end_portal_frame[eye=false,facing=south]", "120:1": "minecraft:end_portal_frame[eye=false,facing=west]", "120:2": "minecraft:end_portal_frame[eye=false,facing=north]", "120:3": "minecraft:end_portal_frame[eye=false,facing=east]", "120:4": "minecraft:end_portal_frame[eye=true,facing=south]", "120:5": "minecraft:end_portal_frame[eye=true,facing=west]", "120:6": "minecraft:end_portal_frame[eye=true,facing=north]", "120:7": "minecraft:end_portal_frame[eye=true,facing=east]", "121:0": "minecraft:end_stone", "122:0": "minecraft:dragon_egg", "123:0": "minecraft:redstone_lamp[lit=false]", "124:0": "minecraft:redstone_lamp[lit=true]", "125:0": "minecraft:oak_slab[type=double]", "125:1": "minecraft:spruce_slab[type=double]", "125:2": "minecraft:birch_slab[type=double]", "125:3": "minecraft:jungle_slab[type=double]", "125:4": "minecraft:acacia_slab[type=double]", "125:5": "minecraft:dark_oak_slab[type=double]", "126:0": "minecraft:oak_slab[type=bottom]", "126:1": "minecraft:spruce_slab[type=bottom]", "126:2": "minecraft:birch_slab[type=bottom]", "126:3": "minecraft:jungle_slab[type=bottom]", "126:4": "minecraft:acacia_slab[type=bottom]", "126:5": "minecraft:dark_oak_slab[type=bottom]", "126:8": "minecraft:oak_slab[type=top]", "126:9": "minecraft:spruce_slab[type=top]", "126:10": "minecraft:birch_slab[type=top]", "126:11": "minecraft:jungle_slab[type=top]", "126:12": "minecraft:acacia_slab[type=top]", "126:13": "minecraft:dark_oak_slab[type=top]", "127:0": "minecraft:cocoa[facing=south,age=0]", "127:1": "minecraft:cocoa[facing=west,age=0]", "127:2": "minecraft:cocoa[facing=north,age=0]", "127:3": "minecraft:cocoa[facing=east,age=0]", "127:4": "minecraft:cocoa[facing=south,age=1]", "127:5": "minecraft:cocoa[facing=west,age=1]", "127:6": "minecraft:cocoa[facing=north,age=1]", "127:7": "minecraft:cocoa[facing=east,age=1]", "127:8": "minecraft:cocoa[facing=south,age=2]", "127:9": "minecraft:cocoa[facing=west,age=2]", "127:10": "minecraft:cocoa[facing=north,age=2]", "127:11": "minecraft:cocoa[facing=east,age=2]", "128:0": "minecraft:sandstone_stairs[half=bottom,shape=straight,facing=east]", "128:1": "minecraft:sandstone_stairs[half=bottom,shape=straight,facing=west]", "128:2": "minecraft:sandstone_stairs[half=bottom,shape=straight,facing=south]", "128:3": "minecraft:sandstone_stairs[half=bottom,shape=straight,facing=north]", "128:4": "minecraft:sandstone_stairs[half=top,shape=straight,facing=east]", "128:5": "minecraft:sandstone_stairs[half=top,shape=straight,facing=west]", "128:6": "minecraft:sandstone_stairs[half=top,shape=straight,facing=south]", "128:7": "minecraft:sandstone_stairs[half=top,shape=straight,facing=north]", "129:0": "minecraft:emerald_ore", "130:2": "minecraft:ender_chest[facing=north]", "130:3": "minecraft:ender_chest[facing=south]", "130:4": "minecraft:ender_chest[facing=west]", "130:5": "minecraft:ender_chest[facing=east]", "131:0": "minecraft:tripwire_hook[powered=false,attached=false,facing=south]", "131:1": "minecraft:tripwire_hook[powered=false,attached=false,facing=west]", "131:2": "minecraft:tripwire_hook[powered=false,attached=false,facing=north]", "131:3": "minecraft:tripwire_hook[powered=false,attached=false,facing=east]", "131:4": "minecraft:tripwire_hook[powered=false,attached=true,facing=south]", "131:5": "minecraft:tripwire_hook[powered=false,attached=true,facing=west]", "131:6": "minecraft:tripwire_hook[powered=false,attached=true,facing=north]", "131:7": "minecraft:tripwire_hook[powered=false,attached=true,facing=east]", "131:8": "minecraft:tripwire_hook[powered=true,attached=false,facing=south]", "131:9": "minecraft:tripwire_hook[powered=true,attached=false,facing=west]", "131:10": "minecraft:tripwire_hook[powered=true,attached=false,facing=north]", "131:11": "minecraft:tripwire_hook[powered=true,attached=false,facing=east]", "131:12": "minecraft:tripwire_hook[powered=true,attached=true,facing=south]", "131:13": "minecraft:tripwire_hook[powered=true,attached=true,facing=west]", "131:14": "minecraft:tripwire_hook[powered=true,attached=true,facing=north]", "131:15": "minecraft:tripwire_hook[powered=true,attached=true,facing=east]", "132:0": "minecraft:tripwire[disarmed=false,east=false,powered=false,south=false,north=false,west=false,attached=false]", "132:1": "minecraft:tripwire[disarmed=false,east=false,powered=true,south=false,north=false,west=false,attached=false]", "132:4": "minecraft:tripwire[disarmed=false,east=false,powered=false,south=false,north=false,west=false,attached=true]", "132:5": "minecraft:tripwire[disarmed=false,east=false,powered=true,south=false,north=false,west=false,attached=true]", "132:8": "minecraft:tripwire[disarmed=true,east=false,powered=false,south=false,north=false,west=false,attached=false]", "132:9": "minecraft:tripwire[disarmed=true,east=false,powered=true,south=false,north=false,west=false,attached=false]", "132:12": "minecraft:tripwire[disarmed=true,east=false,powered=false,south=false,north=false,west=false,attached=true]", "132:13": "minecraft:tripwire[disarmed=true,east=false,powered=true,south=false,north=false,west=false,attached=true]", "133:0": "minecraft:emerald_block", "134:0": "minecraft:spruce_stairs[half=bottom,shape=straight,facing=east]", "134:1": "minecraft:spruce_stairs[half=bottom,shape=straight,facing=west]", "134:2": "minecraft:spruce_stairs[half=bottom,shape=straight,facing=south]", "134:3": "minecraft:spruce_stairs[half=bottom,shape=straight,facing=north]", "134:4": "minecraft:spruce_stairs[half=top,shape=straight,facing=east]", "134:5": "minecraft:spruce_stairs[half=top,shape=straight,facing=west]", "134:6": "minecraft:spruce_stairs[half=top,shape=straight,facing=south]", "134:7": "minecraft:spruce_stairs[half=top,shape=straight,facing=north]", "135:0": "minecraft:birch_stairs[half=bottom,shape=straight,facing=east]", "135:1": "minecraft:birch_stairs[half=bottom,shape=straight,facing=west]", "135:2": "minecraft:birch_stairs[half=bottom,shape=straight,facing=south]", "135:3": "minecraft:birch_stairs[half=bottom,shape=straight,facing=north]", "135:4": "minecraft:birch_stairs[half=top,shape=straight,facing=east]", "135:5": "minecraft:birch_stairs[half=top,shape=straight,facing=west]", "135:6": "minecraft:birch_stairs[half=top,shape=straight,facing=south]", "135:7": "minecraft:birch_stairs[half=top,shape=straight,facing=north]", "136:0": "minecraft:jungle_stairs[half=bottom,shape=straight,facing=east]", "136:1": "minecraft:jungle_stairs[half=bottom,shape=straight,facing=west]", "136:2": "minecraft:jungle_stairs[half=bottom,shape=straight,facing=south]", "136:3": "minecraft:jungle_stairs[half=bottom,shape=straight,facing=north]", "136:4": "minecraft:jungle_stairs[half=top,shape=straight,facing=east]", "136:5": "minecraft:jungle_stairs[half=top,shape=straight,facing=west]", "136:6": "minecraft:jungle_stairs[half=top,shape=straight,facing=south]", "136:7": "minecraft:jungle_stairs[half=top,shape=straight,facing=north]", "137:0": "minecraft:command_block[conditional=false,facing=down]", "137:1": "minecraft:command_block[conditional=false,facing=up]", "137:2": "minecraft:command_block[conditional=false,facing=north]", "137:3": "minecraft:command_block[conditional=false,facing=south]", "137:4": "minecraft:command_block[conditional=false,facing=west]", "137:5": "minecraft:command_block[conditional=false,facing=east]", "137:8": "minecraft:command_block[conditional=true,facing=down]", "137:9": "minecraft:command_block[conditional=true,facing=up]", "137:10": "minecraft:command_block[conditional=true,facing=north]", "137:11": "minecraft:command_block[conditional=true,facing=south]", "137:12": "minecraft:command_block[conditional=true,facing=west]", "137:13": "minecraft:command_block[conditional=true,facing=east]", "138:0": "minecraft:beacon", "139:0": "minecraft:cobblestone_wall[east=false,south=false,north=false,west=false,up=false]", "139:1": "minecraft:mossy_cobblestone_wall[east=false,south=false,north=false,west=false,up=false]", "140:0": "minecraft:flower_pot", "140:1": "minecraft:potted_poppy", "140:2": "minecraft:potted_dandelion", "140:3": "minecraft:potted_oak_sapling", "140:4": "minecraft:potted_spruce_sapling", "140:5": "minecraft:potted_birch_sapling", "140:6": "minecraft:potted_jungle_sapling", "140:7": "minecraft:potted_red_mushroom", "140:8": "minecraft:potted_brown_mushroom", "140:9": "minecraft:potted_cactus", "140:10": "minecraft:potted_dead_bush", "140:11": "minecraft:potted_fern", "140:12": "minecraft:potted_acacia_sapling", "140:13": "minecraft:potted_dark_oak_sapling", "140:14": "minecraft:potted_blue_orchid", "140:15": "minecraft:potted_allium", "141:0": "minecraft:carrots[age=0]", "141:1": "minecraft:carrots[age=1]", "141:2": "minecraft:carrots[age=2]", "141:3": "minecraft:carrots[age=3]", "141:4": "minecraft:carrots[age=4]", "141:5": "minecraft:carrots[age=5]", "141:6": "minecraft:carrots[age=6]", "141:7": "minecraft:carrots[age=7]", "142:0": "minecraft:potatoes[age=0]", "142:1": "minecraft:potatoes[age=1]", "142:2": "minecraft:potatoes[age=2]", "142:3": "minecraft:potatoes[age=3]", "142:4": "minecraft:potatoes[age=4]", "142:5": "minecraft:potatoes[age=5]", "142:6": "minecraft:potatoes[age=6]", "142:7": "minecraft:potatoes[age=7]", "143:0": "minecraft:oak_button[powered=false,facing=east,face=ceiling]", "143:1": "minecraft:oak_button[powered=false,facing=east,face=wall]", "143:2": "minecraft:oak_button[powered=false,facing=west,face=wall]", "143:3": "minecraft:oak_button[powered=false,facing=south,face=wall]", "143:4": "minecraft:oak_button[powered=false,facing=north,face=wall]", "143:5": "minecraft:oak_button[powered=false,facing=east,face=floor]", "143:8": "minecraft:oak_button[powered=true,facing=south,face=ceiling]", "143:9": "minecraft:oak_button[powered=true,facing=east,face=wall]", "143:10": "minecraft:oak_button[powered=true,facing=west,face=wall]", "143:11": "minecraft:oak_button[powered=true,facing=south,face=wall]", "143:12": "minecraft:oak_button[powered=true,facing=north,face=wall]", "143:13": "minecraft:oak_button[powered=true,facing=south,face=floor]", "144:0": "minecraft:skeleton_skull[rotation=0]", "144:1": "minecraft:skeleton_skull[rotation=4]", "144:2": "minecraft:skeleton_wall_skull[facing=north]", "144:3": "minecraft:skeleton_wall_skull[facing=south]", "144:4": "minecraft:skeleton_wall_skull[facing=west]", "144:5": "minecraft:skeleton_wall_skull[facing=east]", "144:8": "minecraft:skeleton_skull[rotation=8]", "144:9": "minecraft:skeleton_skull[rotation=12]", "144:10": "minecraft:skeleton_wall_skull[facing=north]", "144:11": "minecraft:skeleton_wall_skull[facing=south]", "144:12": "minecraft:skeleton_wall_skull[facing=west]", "144:13": "minecraft:skeleton_wall_skull[facing=east]", "145:0": "minecraft:anvil[facing=south]", "145:1": "minecraft:anvil[facing=west]", "145:2": "minecraft:anvil[facing=north]", "145:3": "minecraft:anvil[facing=east]", "145:4": "minecraft:chipped_anvil[facing=south]", "145:5": "minecraft:chipped_anvil[facing=west]", "145:6": "minecraft:chipped_anvil[facing=north]", "145:7": "minecraft:chipped_anvil[facing=east]", "145:8": "minecraft:damaged_anvil[facing=south]", "145:9": "minecraft:damaged_anvil[facing=west]", "145:10": "minecraft:damaged_anvil[facing=north]", "145:11": "minecraft:damaged_anvil[facing=east]", "146:2": "minecraft:trapped_chest[facing=north,type=single]", "146:3": "minecraft:trapped_chest[facing=south,type=single]", "146:4": "minecraft:trapped_chest[facing=west,type=single]", "146:5": "minecraft:trapped_chest[facing=east,type=single]", "147:0": "minecraft:light_weighted_pressure_plate[power=0]", "147:1": "minecraft:light_weighted_pressure_plate[power=1]", "147:2": "minecraft:light_weighted_pressure_plate[power=2]", "147:3": "minecraft:light_weighted_pressure_plate[power=3]", "147:4": "minecraft:light_weighted_pressure_plate[power=4]", "147:5": "minecraft:light_weighted_pressure_plate[power=5]", "147:6": "minecraft:light_weighted_pressure_plate[power=6]", "147:7": "minecraft:light_weighted_pressure_plate[power=7]", "147:8": "minecraft:light_weighted_pressure_plate[power=8]", "147:9": "minecraft:light_weighted_pressure_plate[power=9]", "147:10": "minecraft:light_weighted_pressure_plate[power=10]", "147:11": "minecraft:light_weighted_pressure_plate[power=11]", "147:12": "minecraft:light_weighted_pressure_plate[power=12]", "147:13": "minecraft:light_weighted_pressure_plate[power=13]", "147:14": "minecraft:light_weighted_pressure_plate[power=14]", "147:15": "minecraft:light_weighted_pressure_plate[power=15]", "148:0": "minecraft:heavy_weighted_pressure_plate[power=0]", "148:1": "minecraft:heavy_weighted_pressure_plate[power=1]", "148:2": "minecraft:heavy_weighted_pressure_plate[power=2]", "148:3": "minecraft:heavy_weighted_pressure_plate[power=3]", "148:4": "minecraft:heavy_weighted_pressure_plate[power=4]", "148:5": "minecraft:heavy_weighted_pressure_plate[power=5]", "148:6": "minecraft:heavy_weighted_pressure_plate[power=6]", "148:7": "minecraft:heavy_weighted_pressure_plate[power=7]", "148:8": "minecraft:heavy_weighted_pressure_plate[power=8]", "148:9": "minecraft:heavy_weighted_pressure_plate[power=9]", "148:10": "minecraft:heavy_weighted_pressure_plate[power=10]", "148:11": "minecraft:heavy_weighted_pressure_plate[power=11]", "148:12": "minecraft:heavy_weighted_pressure_plate[power=12]", "148:13": "minecraft:heavy_weighted_pressure_plate[power=13]", "148:14": "minecraft:heavy_weighted_pressure_plate[power=14]", "148:15": "minecraft:heavy_weighted_pressure_plate[power=15]", "149:0": "minecraft:comparator[mode=compare,powered=false,facing=south]", "149:1": "minecraft:comparator[mode=compare,powered=false,facing=west]", "149:2": "minecraft:comparator[mode=compare,powered=false,facing=north]", "149:3": "minecraft:comparator[mode=compare,powered=false,facing=east]", "149:4": "minecraft:comparator[mode=subtract,powered=false,facing=south]", "149:5": "minecraft:comparator[mode=subtract,powered=false,facing=west]", "149:6": "minecraft:comparator[mode=subtract,powered=false,facing=north]", "149:7": "minecraft:comparator[mode=subtract,powered=false,facing=east]", "149:8": "minecraft:comparator[mode=compare,powered=false,facing=south]", "149:9": "minecraft:comparator[mode=compare,powered=false,facing=west]", "149:10": "minecraft:comparator[mode=compare,powered=false,facing=north]", "149:11": "minecraft:comparator[mode=compare,powered=false,facing=east]", "149:12": "minecraft:comparator[mode=subtract,powered=false,facing=south]", "149:13": "minecraft:comparator[mode=subtract,powered=false,facing=west]", "149:14": "minecraft:comparator[mode=subtract,powered=false,facing=north]", "149:15": "minecraft:comparator[mode=subtract,powered=false,facing=east]", "150:0": "minecraft:comparator[mode=compare,powered=true,facing=south]", "150:1": "minecraft:comparator[mode=compare,powered=true,facing=west]", "150:2": "minecraft:comparator[mode=compare,powered=true,facing=north]", "150:3": "minecraft:comparator[mode=compare,powered=true,facing=east]", "150:4": "minecraft:comparator[mode=subtract,powered=true,facing=south]", "150:5": "minecraft:comparator[mode=subtract,powered=true,facing=west]", "150:6": "minecraft:comparator[mode=subtract,powered=true,facing=north]", "150:7": "minecraft:comparator[mode=subtract,powered=true,facing=east]", "150:8": "minecraft:comparator[mode=compare,powered=true,facing=south]", "150:9": "minecraft:comparator[mode=compare,powered=true,facing=west]", "150:10": "minecraft:comparator[mode=compare,powered=true,facing=north]", "150:11": "minecraft:comparator[mode=compare,powered=true,facing=east]", "150:12": "minecraft:comparator[mode=subtract,powered=true,facing=south]", "150:13": "minecraft:comparator[mode=subtract,powered=true,facing=west]", "150:14": "minecraft:comparator[mode=subtract,powered=true,facing=north]", "150:15": "minecraft:comparator[mode=subtract,powered=true,facing=east]", "151:0": "minecraft:daylight_detector[inverted=false,power=0]", "151:1": "minecraft:daylight_detector[inverted=false,power=1]", "151:2": "minecraft:daylight_detector[inverted=false,power=2]", "151:3": "minecraft:daylight_detector[inverted=false,power=3]", "151:4": "minecraft:daylight_detector[inverted=false,power=4]", "151:5": "minecraft:daylight_detector[inverted=false,power=5]", "151:6": "minecraft:daylight_detector[inverted=false,power=6]", "151:7": "minecraft:daylight_detector[inverted=false,power=7]", "151:8": "minecraft:daylight_detector[inverted=false,power=8]", "151:9": "minecraft:daylight_detector[inverted=false,power=9]", "151:10": "minecraft:daylight_detector[inverted=false,power=10]", "151:11": "minecraft:daylight_detector[inverted=false,power=11]", "151:12": "minecraft:daylight_detector[inverted=false,power=12]", "151:13": "minecraft:daylight_detector[inverted=false,power=13]", "151:14": "minecraft:daylight_detector[inverted=false,power=14]", "151:15": "minecraft:daylight_detector[inverted=false,power=15]", "152:0": "minecraft:redstone_block", "153:0": "minecraft:nether_quartz_ore", "154:0": "minecraft:hopper[facing=down,enabled=true]", "154:2": "minecraft:hopper[facing=north,enabled=true]", "154:3": "minecraft:hopper[facing=south,enabled=true]", "154:4": "minecraft:hopper[facing=west,enabled=true]", "154:5": "minecraft:hopper[facing=east,enabled=true]", "154:8": "minecraft:hopper[facing=down,enabled=false]", "154:10": "minecraft:hopper[facing=north,enabled=false]", "154:11": "minecraft:hopper[facing=south,enabled=false]", "154:12": "minecraft:hopper[facing=west,enabled=false]", "154:13": "minecraft:hopper[facing=east,enabled=false]", "155:0": "minecraft:quartz_block", "155:1": "minecraft:chiseled_quartz_block", "155:2": "minecraft:quartz_pillar[axis=y]", "155:3": "minecraft:quartz_pillar[axis=x]", "155:4": "minecraft:quartz_pillar[axis=z]", "155:6": "minecraft:quartz_pillar[axis=x]", "155:10": "minecraft:quartz_pillar[axis=z]", "156:0": "minecraft:quartz_stairs[half=bottom,shape=straight,facing=east]", "156:1": "minecraft:quartz_stairs[half=bottom,shape=straight,facing=west]", "156:2": "minecraft:quartz_stairs[half=bottom,shape=straight,facing=south]", "156:3": "minecraft:quartz_stairs[half=bottom,shape=straight,facing=north]", "156:4": "minecraft:quartz_stairs[half=top,shape=straight,facing=east]", "156:5": "minecraft:quartz_stairs[half=top,shape=straight,facing=west]", "156:6": "minecraft:quartz_stairs[half=top,shape=straight,facing=south]", "156:7": "minecraft:quartz_stairs[half=top,shape=straight,facing=north]", "157:0": "minecraft:activator_rail[shape=north_south,powered=false]", "157:1": "minecraft:activator_rail[shape=east_west,powered=false]", "157:2": "minecraft:activator_rail[shape=ascending_east,powered=false]", "157:3": "minecraft:activator_rail[shape=ascending_west,powered=false]", "157:4": "minecraft:activator_rail[shape=ascending_north,powered=false]", "157:5": "minecraft:activator_rail[shape=ascending_south,powered=false]", "157:8": "minecraft:activator_rail[shape=north_south,powered=true]", "157:9": "minecraft:activator_rail[shape=east_west,powered=true]", "157:10": "minecraft:activator_rail[shape=ascending_east,powered=true]", "157:11": "minecraft:activator_rail[shape=ascending_west,powered=true]", "157:12": "minecraft:activator_rail[shape=ascending_north,powered=true]", "157:13": "minecraft:activator_rail[shape=ascending_south,powered=true]", "158:0": "minecraft:dropper[triggered=false,facing=down]", "158:1": "minecraft:dropper[triggered=false,facing=up]", "158:2": "minecraft:dropper[triggered=false,facing=north]", "158:3": "minecraft:dropper[triggered=false,facing=south]", "158:4": "minecraft:dropper[triggered=false,facing=west]", "158:5": "minecraft:dropper[triggered=false,facing=east]", "158:8": "minecraft:dropper[triggered=true,facing=down]", "158:9": "minecraft:dropper[triggered=true,facing=up]", "158:10": "minecraft:dropper[triggered=true,facing=north]", "158:11": "minecraft:dropper[triggered=true,facing=south]", "158:12": "minecraft:dropper[triggered=true,facing=west]", "158:13": "minecraft:dropper[triggered=true,facing=east]", "159:0": "minecraft:white_terracotta", "159:1": "minecraft:orange_terracotta", "159:2": "minecraft:magenta_terracotta", "159:3": "minecraft:light_blue_terracotta", "159:4": "minecraft:yellow_terracotta", "159:5": "minecraft:lime_terracotta", "159:6": "minecraft:pink_terracotta", "159:7": "minecraft:gray_terracotta", "159:8": "minecraft:light_gray_terracotta", "159:9": "minecraft:cyan_terracotta", "159:10": "minecraft:purple_terracotta", "159:11": "minecraft:blue_terracotta", "159:12": "minecraft:brown_terracotta", "159:13": "minecraft:green_terracotta", "159:14": "minecraft:red_terracotta", "159:15": "minecraft:black_terracotta", "160:0": "minecraft:white_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:1": "minecraft:orange_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:2": "minecraft:magenta_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:3": "minecraft:light_blue_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:4": "minecraft:yellow_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:5": "minecraft:lime_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:6": "minecraft:pink_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:7": "minecraft:gray_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:8": "minecraft:light_gray_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:9": "minecraft:cyan_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:10": "minecraft:purple_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:11": "minecraft:blue_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:12": "minecraft:brown_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:13": "minecraft:green_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:14": "minecraft:red_stained_glass_pane[east=false,south=false,north=false,west=false]", "160:15": "minecraft:black_stained_glass_pane[east=false,south=false,north=false,west=false]", "161:0": "minecraft:acacia_leaves[persistent=false,distance=1]", "161:1": "minecraft:dark_oak_leaves[persistent=false,distance=1]", "161:4": "minecraft:acacia_leaves[persistent=true,distance=1]", "161:5": "minecraft:dark_oak_leaves[persistent=true,distance=1]", "161:8": "minecraft:acacia_leaves[persistent=false,distance=1]", "161:9": "minecraft:dark_oak_leaves[persistent=false,distance=1]", "161:12": "minecraft:acacia_leaves[persistent=true,distance=1]", "161:13": "minecraft:dark_oak_leaves[persistent=true,distance=1]", "162:0": "minecraft:acacia_log[axis=y]", "162:1": "minecraft:dark_oak_log[axis=y]", "162:4": "minecraft:acacia_log[axis=x]", "162:5": "minecraft:dark_oak_log[axis=x]", "162:8": "minecraft:acacia_log[axis=z]", "162:9": "minecraft:dark_oak_log[axis=z]", "162:12": "minecraft:acacia_wood", "162:13": "minecraft:dark_oak_wood", "163:0": "minecraft:acacia_stairs[half=bottom,shape=straight,facing=east]", "163:1": "minecraft:acacia_stairs[half=bottom,shape=straight,facing=west]", "163:2": "minecraft:acacia_stairs[half=bottom,shape=straight,facing=south]", "163:3": "minecraft:acacia_stairs[half=bottom,shape=straight,facing=north]", "163:4": "minecraft:acacia_stairs[half=top,shape=straight,facing=east]", "163:5": "minecraft:acacia_stairs[half=top,shape=straight,facing=west]", "163:6": "minecraft:acacia_stairs[half=top,shape=straight,facing=south]", "163:7": "minecraft:acacia_stairs[half=top,shape=straight,facing=north]", "164:0": "minecraft:dark_oak_stairs[half=bottom,shape=straight,facing=east]", "164:1": "minecraft:dark_oak_stairs[half=bottom,shape=straight,facing=west]", "164:2": "minecraft:dark_oak_stairs[half=bottom,shape=straight,facing=south]", "164:3": "minecraft:dark_oak_stairs[half=bottom,shape=straight,facing=north]", "164:4": "minecraft:dark_oak_stairs[half=top,shape=straight,facing=east]", "164:5": "minecraft:dark_oak_stairs[half=top,shape=straight,facing=west]", "164:6": "minecraft:dark_oak_stairs[half=top,shape=straight,facing=south]", "164:7": "minecraft:dark_oak_stairs[half=top,shape=straight,facing=north]", "165:0": "minecraft:slime_block", "166:0": "minecraft:barrier", "167:0": "minecraft:iron_trapdoor[half=bottom,facing=north,open=false]", "167:1": "minecraft:iron_trapdoor[half=bottom,facing=south,open=false]", "167:2": "minecraft:iron_trapdoor[half=bottom,facing=west,open=false]", "167:3": "minecraft:iron_trapdoor[half=bottom,facing=east,open=false]", "167:4": "minecraft:iron_trapdoor[half=bottom,facing=north,open=true]", "167:5": "minecraft:iron_trapdoor[half=bottom,facing=south,open=true]", "167:6": "minecraft:iron_trapdoor[half=bottom,facing=west,open=true]", "167:7": "minecraft:iron_trapdoor[half=bottom,facing=east,open=true]", "167:8": "minecraft:iron_trapdoor[half=top,facing=north,open=false]", "167:9": "minecraft:iron_trapdoor[half=top,facing=south,open=false]", "167:10": "minecraft:iron_trapdoor[half=top,facing=west,open=false]", "167:11": "minecraft:iron_trapdoor[half=top,facing=east,open=false]", "167:12": "minecraft:iron_trapdoor[half=top,facing=north,open=true]", "167:13": "minecraft:iron_trapdoor[half=top,facing=south,open=true]", "167:14": "minecraft:iron_trapdoor[half=top,facing=west,open=true]", "167:15": "minecraft:iron_trapdoor[half=top,facing=east,open=true]", "168:0": "minecraft:prismarine", "168:1": "minecraft:prismarine_bricks", "168:2": "minecraft:dark_prismarine", "169:0": "minecraft:sea_lantern", "170:0": "minecraft:hay_block[axis=y]", "170:4": "minecraft:hay_block[axis=x]", "170:8": "minecraft:hay_block[axis=z]", "171:0": "minecraft:white_carpet", "171:1": "minecraft:orange_carpet", "171:2": "minecraft:magenta_carpet", "171:3": "minecraft:light_blue_carpet", "171:4": "minecraft:yellow_carpet", "171:5": "minecraft:lime_carpet", "171:6": "minecraft:pink_carpet", "171:7": "minecraft:gray_carpet", "171:8": "minecraft:light_gray_carpet", "171:9": "minecraft:cyan_carpet", "171:10": "minecraft:purple_carpet", "171:11": "minecraft:blue_carpet", "171:12": "minecraft:brown_carpet", "171:13": "minecraft:green_carpet", "171:14": "minecraft:red_carpet", "171:15": "minecraft:black_carpet", "172:0": "minecraft:terracotta", "173:0": "minecraft:coal_block", "174:0": "minecraft:packed_ice", "175:0": "minecraft:sunflower[half=lower]", "175:1": "minecraft:lilac[half=lower]", "175:2": "minecraft:tall_grass[half=lower]", "175:3": "minecraft:large_fern[half=lower]", "175:4": "minecraft:rose_bush[half=lower]", "175:5": "minecraft:peony[half=lower]", "175:8": "minecraft:sunflower[half=upper]", "175:9": "minecraft:lilac[half=upper]", "175:10": "minecraft:tall_grass[half=upper]", "175:11": "minecraft:large_fern[half=upper]", "175:12": "minecraft:rose_bush[half=upper]", "175:13": "minecraft:peony[half=upper]", "176:0": "minecraft:white_banner[rotation=0]", "176:1": "minecraft:white_banner[rotation=1]", "176:2": "minecraft:white_banner[rotation=2]", "176:3": "minecraft:white_banner[rotation=3]", "176:4": "minecraft:white_banner[rotation=4]", "176:5": "minecraft:white_banner[rotation=5]", "176:6": "minecraft:white_banner[rotation=6]", "176:7": "minecraft:white_banner[rotation=7]", "176:8": "minecraft:white_banner[rotation=8]", "176:9": "minecraft:white_banner[rotation=9]", "176:10": "minecraft:white_banner[rotation=10]", "176:11": "minecraft:white_banner[rotation=11]", "176:12": "minecraft:white_banner[rotation=12]", "176:13": "minecraft:white_banner[rotation=13]", "176:14": "minecraft:white_banner[rotation=14]", "176:15": "minecraft:white_banner[rotation=15]", "177:2": "minecraft:white_wall_banner[facing=north]", "177:3": "minecraft:white_wall_banner[facing=south]", "177:4": "minecraft:white_wall_banner[facing=west]", "177:5": "minecraft:white_wall_banner[facing=east]", "178:0": "minecraft:daylight_detector[inverted=true,power=0]", "178:1": "minecraft:daylight_detector[inverted=true,power=1]", "178:2": "minecraft:daylight_detector[inverted=true,power=2]", "178:3": "minecraft:daylight_detector[inverted=true,power=3]", "178:4": "minecraft:daylight_detector[inverted=true,power=4]", "178:5": "minecraft:daylight_detector[inverted=true,power=5]", "178:6": "minecraft:daylight_detector[inverted=true,power=6]", "178:7": "minecraft:daylight_detector[inverted=true,power=7]", "178:8": "minecraft:daylight_detector[inverted=true,power=8]", "178:9": "minecraft:daylight_detector[inverted=true,power=9]", "178:10": "minecraft:daylight_detector[inverted=true,power=10]", "178:11": "minecraft:daylight_detector[inverted=true,power=11]", "178:12": "minecraft:daylight_detector[inverted=true,power=12]", "178:13": "minecraft:daylight_detector[inverted=true,power=13]", "178:14": "minecraft:daylight_detector[inverted=true,power=14]", "178:15": "minecraft:daylight_detector[inverted=true,power=15]", "179:0": "minecraft:red_sandstone", "179:1": "minecraft:chiseled_red_sandstone", "179:2": "minecraft:cut_red_sandstone", "180:0": "minecraft:red_sandstone_stairs[half=bottom,shape=straight,facing=east]", "180:1": "minecraft:red_sandstone_stairs[half=bottom,shape=straight,facing=west]", "180:2": "minecraft:red_sandstone_stairs[half=bottom,shape=straight,facing=south]", "180:3": "minecraft:red_sandstone_stairs[half=bottom,shape=straight,facing=north]", "180:4": "minecraft:red_sandstone_stairs[half=top,shape=straight,facing=east]", "180:5": "minecraft:red_sandstone_stairs[half=top,shape=straight,facing=west]", "180:6": "minecraft:red_sandstone_stairs[half=top,shape=straight,facing=south]", "180:7": "minecraft:red_sandstone_stairs[half=top,shape=straight,facing=north]", "181:0": "minecraft:red_sandstone_slab[type=double]", "181:8": "minecraft:smooth_red_sandstone", "182:0": "minecraft:red_sandstone_slab[type=bottom]", "182:8": "minecraft:red_sandstone_slab[type=top]", "183:0": "minecraft:spruce_fence_gate[in_wall=false,powered=false,facing=south,open=false]", "183:1": "minecraft:spruce_fence_gate[in_wall=false,powered=false,facing=west,open=false]", "183:2": "minecraft:spruce_fence_gate[in_wall=false,powered=false,facing=north,open=false]", "183:3": "minecraft:spruce_fence_gate[in_wall=false,powered=false,facing=east,open=false]", "183:4": "minecraft:spruce_fence_gate[in_wall=false,powered=false,facing=south,open=true]", "183:5": "minecraft:spruce_fence_gate[in_wall=false,powered=false,facing=west,open=true]", "183:6": "minecraft:spruce_fence_gate[in_wall=false,powered=false,facing=north,open=true]", "183:7": "minecraft:spruce_fence_gate[in_wall=false,powered=false,facing=east,open=true]", "183:8": "minecraft:spruce_fence_gate[in_wall=false,powered=true,facing=south,open=false]", "183:9": "minecraft:spruce_fence_gate[in_wall=false,powered=true,facing=west,open=false]", "183:10": "minecraft:spruce_fence_gate[in_wall=false,powered=true,facing=north,open=false]", "183:11": "minecraft:spruce_fence_gate[in_wall=false,powered=true,facing=east,open=false]", "183:12": "minecraft:spruce_fence_gate[in_wall=false,powered=true,facing=south,open=true]", "183:13": "minecraft:spruce_fence_gate[in_wall=false,powered=true,facing=west,open=true]", "183:14": "minecraft:spruce_fence_gate[in_wall=false,powered=true,facing=north,open=true]", "183:15": "minecraft:spruce_fence_gate[in_wall=false,powered=true,facing=east,open=true]", "184:0": "minecraft:birch_fence_gate[in_wall=false,powered=false,facing=south,open=false]", "184:1": "minecraft:birch_fence_gate[in_wall=false,powered=false,facing=west,open=false]", "184:2": "minecraft:birch_fence_gate[in_wall=false,powered=false,facing=north,open=false]", "184:3": "minecraft:birch_fence_gate[in_wall=false,powered=false,facing=east,open=false]", "184:4": "minecraft:birch_fence_gate[in_wall=false,powered=false,facing=south,open=true]", "184:5": "minecraft:birch_fence_gate[in_wall=false,powered=false,facing=west,open=true]", "184:6": "minecraft:birch_fence_gate[in_wall=false,powered=false,facing=north,open=true]", "184:7": "minecraft:birch_fence_gate[in_wall=false,powered=false,facing=east,open=true]", "184:8": "minecraft:birch_fence_gate[in_wall=false,powered=true,facing=south,open=false]", "184:9": "minecraft:birch_fence_gate[in_wall=false,powered=true,facing=west,open=false]", "184:10": "minecraft:birch_fence_gate[in_wall=false,powered=true,facing=north,open=false]", "184:11": "minecraft:birch_fence_gate[in_wall=false,powered=true,facing=east,open=false]", "184:12": "minecraft:birch_fence_gate[in_wall=false,powered=true,facing=south,open=true]", "184:13": "minecraft:birch_fence_gate[in_wall=false,powered=true,facing=west,open=true]", "184:14": "minecraft:birch_fence_gate[in_wall=false,powered=true,facing=north,open=true]", "184:15": "minecraft:birch_fence_gate[in_wall=false,powered=true,facing=east,open=true]", "185:0": "minecraft:jungle_fence_gate[in_wall=false,powered=false,facing=south,open=false]", "185:1": "minecraft:jungle_fence_gate[in_wall=false,powered=false,facing=west,open=false]", "185:2": "minecraft:jungle_fence_gate[in_wall=false,powered=false,facing=north,open=false]", "185:3": "minecraft:jungle_fence_gate[in_wall=false,powered=false,facing=east,open=false]", "185:4": "minecraft:jungle_fence_gate[in_wall=false,powered=false,facing=south,open=true]", "185:5": "minecraft:jungle_fence_gate[in_wall=false,powered=false,facing=west,open=true]", "185:6": "minecraft:jungle_fence_gate[in_wall=false,powered=false,facing=north,open=true]", "185:7": "minecraft:jungle_fence_gate[in_wall=false,powered=false,facing=east,open=true]", "185:8": "minecraft:jungle_fence_gate[in_wall=false,powered=true,facing=south,open=false]", "185:9": "minecraft:jungle_fence_gate[in_wall=false,powered=true,facing=west,open=false]", "185:10": "minecraft:jungle_fence_gate[in_wall=false,powered=true,facing=north,open=false]", "185:11": "minecraft:jungle_fence_gate[in_wall=false,powered=true,facing=east,open=false]", "185:12": "minecraft:jungle_fence_gate[in_wall=false,powered=true,facing=south,open=true]", "185:13": "minecraft:jungle_fence_gate[in_wall=false,powered=true,facing=west,open=true]", "185:14": "minecraft:jungle_fence_gate[in_wall=false,powered=true,facing=north,open=true]", "185:15": "minecraft:jungle_fence_gate[in_wall=false,powered=true,facing=east,open=true]", "186:0": "minecraft:dark_oak_fence_gate[in_wall=false,powered=false,facing=south,open=false]", "186:1": "minecraft:dark_oak_fence_gate[in_wall=false,powered=false,facing=west,open=false]", "186:2": "minecraft:dark_oak_fence_gate[in_wall=false,powered=false,facing=north,open=false]", "186:3": "minecraft:dark_oak_fence_gate[in_wall=false,powered=false,facing=east,open=false]", "186:4": "minecraft:dark_oak_fence_gate[in_wall=false,powered=false,facing=south,open=true]", "186:5": "minecraft:dark_oak_fence_gate[in_wall=false,powered=false,facing=west,open=true]", "186:6": "minecraft:dark_oak_fence_gate[in_wall=false,powered=false,facing=north,open=true]", "186:7": "minecraft:dark_oak_fence_gate[in_wall=false,powered=false,facing=east,open=true]", "186:8": "minecraft:dark_oak_fence_gate[in_wall=false,powered=true,facing=south,open=false]", "186:9": "minecraft:dark_oak_fence_gate[in_wall=false,powered=true,facing=west,open=false]", "186:10": "minecraft:dark_oak_fence_gate[in_wall=false,powered=true,facing=north,open=false]", "186:11": "minecraft:dark_oak_fence_gate[in_wall=false,powered=true,facing=east,open=false]", "186:12": "minecraft:dark_oak_fence_gate[in_wall=false,powered=true,facing=south,open=true]", "186:13": "minecraft:dark_oak_fence_gate[in_wall=false,powered=true,facing=west,open=true]", "186:14": "minecraft:dark_oak_fence_gate[in_wall=false,powered=true,facing=north,open=true]", "186:15": "minecraft:dark_oak_fence_gate[in_wall=false,powered=true,facing=east,open=true]", "187:0": "minecraft:acacia_fence_gate[in_wall=false,powered=false,facing=south,open=false]", "187:1": "minecraft:acacia_fence_gate[in_wall=false,powered=false,facing=west,open=false]", "187:2": "minecraft:acacia_fence_gate[in_wall=false,powered=false,facing=north,open=false]", "187:3": "minecraft:acacia_fence_gate[in_wall=false,powered=false,facing=east,open=false]", "187:4": "minecraft:acacia_fence_gate[in_wall=false,powered=false,facing=south,open=true]", "187:5": "minecraft:acacia_fence_gate[in_wall=false,powered=false,facing=west,open=true]", "187:6": "minecraft:acacia_fence_gate[in_wall=false,powered=false,facing=north,open=true]", "187:7": "minecraft:acacia_fence_gate[in_wall=false,powered=false,facing=east,open=true]", "187:8": "minecraft:acacia_fence_gate[in_wall=false,powered=true,facing=south,open=false]", "187:9": "minecraft:acacia_fence_gate[in_wall=false,powered=true,facing=west,open=false]", "187:10": "minecraft:acacia_fence_gate[in_wall=false,powered=true,facing=north,open=false]", "187:11": "minecraft:acacia_fence_gate[in_wall=false,powered=true,facing=east,open=false]", "187:12": "minecraft:acacia_fence_gate[in_wall=false,powered=true,facing=south,open=true]", "187:13": "minecraft:acacia_fence_gate[in_wall=false,powered=true,facing=west,open=true]", "187:14": "minecraft:acacia_fence_gate[in_wall=false,powered=true,facing=north,open=true]", "187:15": "minecraft:acacia_fence_gate[in_wall=false,powered=true,facing=east,open=true]", "188:0": "minecraft:spruce_fence[east=false,south=false,north=false,west=false]", "189:0": "minecraft:birch_fence[east=false,south=false,north=false,west=false]", "190:0": "minecraft:jungle_fence[east=false,south=false,north=false,west=false]", "191:0": "minecraft:dark_oak_fence[east=false,south=false,north=false,west=false]", "192:0": "minecraft:acacia_fence[east=false,south=false,north=false,west=false]", "193:0": "minecraft:spruce_door[hinge=right,half=lower,powered=false,facing=east,open=false]", "193:1": "minecraft:spruce_door[hinge=right,half=lower,powered=false,facing=south,open=false]", "193:2": "minecraft:spruce_door[hinge=right,half=lower,powered=false,facing=west,open=false]", "193:3": "minecraft:spruce_door[hinge=right,half=lower,powered=false,facing=north,open=false]", "193:4": "minecraft:spruce_door[hinge=right,half=lower,powered=false,facing=east,open=true]", "193:5": "minecraft:spruce_door[hinge=right,half=lower,powered=false,facing=south,open=true]", "193:6": "minecraft:spruce_door[hinge=right,half=lower,powered=false,facing=west,open=true]", "193:7": "minecraft:spruce_door[hinge=right,half=lower,powered=false,facing=north,open=true]", "193:8": "minecraft:spruce_door[hinge=left,half=upper,powered=false,facing=east,open=false]", "193:9": "minecraft:spruce_door[hinge=right,half=upper,powered=false,facing=east,open=false]", "193:10": "minecraft:spruce_door[hinge=left,half=upper,powered=true,facing=east,open=false]", "193:11": "minecraft:spruce_door[hinge=right,half=upper,powered=true,facing=east,open=false]", "194:0": "minecraft:birch_door[hinge=right,half=lower,powered=false,facing=east,open=false]", "194:1": "minecraft:birch_door[hinge=right,half=lower,powered=false,facing=south,open=false]", "194:2": "minecraft:birch_door[hinge=right,half=lower,powered=false,facing=west,open=false]", "194:3": "minecraft:birch_door[hinge=right,half=lower,powered=false,facing=north,open=false]", "194:4": "minecraft:birch_door[hinge=right,half=lower,powered=false,facing=east,open=true]", "194:5": "minecraft:birch_door[hinge=right,half=lower,powered=false,facing=south,open=true]", "194:6": "minecraft:birch_door[hinge=right,half=lower,powered=false,facing=west,open=true]", "194:7": "minecraft:birch_door[hinge=right,half=lower,powered=false,facing=north,open=true]", "194:8": "minecraft:birch_door[hinge=left,half=upper,powered=false,facing=east,open=false]", "194:9": "minecraft:birch_door[hinge=right,half=upper,powered=false,facing=east,open=false]", "194:10": "minecraft:birch_door[hinge=left,half=upper,powered=true,facing=east,open=false]", "194:11": "minecraft:birch_door[hinge=right,half=upper,powered=true,facing=east,open=false]", "195:0": "minecraft:jungle_door[hinge=right,half=lower,powered=false,facing=east,open=false]", "195:1": "minecraft:jungle_door[hinge=right,half=lower,powered=false,facing=south,open=false]", "195:2": "minecraft:jungle_door[hinge=right,half=lower,powered=false,facing=west,open=false]", "195:3": "minecraft:jungle_door[hinge=right,half=lower,powered=false,facing=north,open=false]", "195:4": "minecraft:jungle_door[hinge=right,half=lower,powered=false,facing=east,open=true]", "195:5": "minecraft:jungle_door[hinge=right,half=lower,powered=false,facing=south,open=true]", "195:6": "minecraft:jungle_door[hinge=right,half=lower,powered=false,facing=west,open=true]", "195:7": "minecraft:jungle_door[hinge=right,half=lower,powered=false,facing=north,open=true]", "195:8": "minecraft:jungle_door[hinge=left,half=upper,powered=false,facing=east,open=false]", "195:9": "minecraft:jungle_door[hinge=right,half=upper,powered=false,facing=east,open=false]", "195:10": "minecraft:jungle_door[hinge=left,half=upper,powered=true,facing=east,open=false]", "195:11": "minecraft:jungle_door[hinge=right,half=upper,powered=true,facing=east,open=false]", "196:0": "minecraft:acacia_door[hinge=right,half=lower,powered=false,facing=east,open=false]", "196:1": "minecraft:acacia_door[hinge=right,half=lower,powered=false,facing=south,open=false]", "196:2": "minecraft:acacia_door[hinge=right,half=lower,powered=false,facing=west,open=false]", "196:3": "minecraft:acacia_door[hinge=right,half=lower,powered=false,facing=north,open=false]", "196:4": "minecraft:acacia_door[hinge=right,half=lower,powered=false,facing=east,open=true]", "196:5": "minecraft:acacia_door[hinge=right,half=lower,powered=false,facing=south,open=true]", "196:6": "minecraft:acacia_door[hinge=right,half=lower,powered=false,facing=west,open=true]", "196:7": "minecraft:acacia_door[hinge=right,half=lower,powered=false,facing=north,open=true]", "196:8": "minecraft:acacia_door[hinge=left,half=upper,powered=false,facing=east,open=false]", "196:9": "minecraft:acacia_door[hinge=right,half=upper,powered=false,facing=east,open=false]", "196:10": "minecraft:acacia_door[hinge=left,half=upper,powered=true,facing=east,open=false]", "196:11": "minecraft:acacia_door[hinge=right,half=upper,powered=true,facing=east,open=false]", "197:0": "minecraft:dark_oak_door[hinge=right,half=lower,powered=false,facing=east,open=false]", "197:1": "minecraft:dark_oak_door[hinge=right,half=lower,powered=false,facing=south,open=false]", "197:2": "minecraft:dark_oak_door[hinge=right,half=lower,powered=false,facing=west,open=false]", "197:3": "minecraft:dark_oak_door[hinge=right,half=lower,powered=false,facing=north,open=false]", "197:4": "minecraft:dark_oak_door[hinge=right,half=lower,powered=false,facing=east,open=true]", "197:5": "minecraft:dark_oak_door[hinge=right,half=lower,powered=false,facing=south,open=true]", "197:6": "minecraft:dark_oak_door[hinge=right,half=lower,powered=false,facing=west,open=true]", "197:7": "minecraft:dark_oak_door[hinge=right,half=lower,powered=false,facing=north,open=true]", "197:8": "minecraft:dark_oak_door[hinge=left,half=upper,powered=false,facing=east,open=false]", "197:9": "minecraft:dark_oak_door[hinge=right,half=upper,powered=false,facing=east,open=false]", "197:10": "minecraft:dark_oak_door[hinge=left,half=upper,powered=true,facing=east,open=false]", "197:11": "minecraft:dark_oak_door[hinge=right,half=upper,powered=true,facing=east,open=false]", "198:0": "minecraft:end_rod[facing=down]", "198:1": "minecraft:end_rod[facing=up]", "198:2": "minecraft:end_rod[facing=north]", "198:3": "minecraft:end_rod[facing=south]", "198:4": "minecraft:end_rod[facing=west]", "198:5": "minecraft:end_rod[facing=east]", "199:0": "minecraft:chorus_plant[east=false,south=false,north=false,west=false,up=false,down=false]", "200:0": "minecraft:chorus_flower[age=0]", "200:1": "minecraft:chorus_flower[age=1]", "200:2": "minecraft:chorus_flower[age=2]", "200:3": "minecraft:chorus_flower[age=3]", "200:4": "minecraft:chorus_flower[age=4]", "200:5": "minecraft:chorus_flower[age=5]", "201:0": "minecraft:purpur_block", "202:0": "minecraft:purpur_pillar[axis=y]", "202:4": "minecraft:purpur_pillar[axis=x]", "202:8": "minecraft:purpur_pillar[axis=z]", "203:0": "minecraft:purpur_stairs[half=bottom,shape=straight,facing=east]", "203:1": "minecraft:purpur_stairs[half=bottom,shape=straight,facing=west]", "203:2": "minecraft:purpur_stairs[half=bottom,shape=straight,facing=south]", "203:3": "minecraft:purpur_stairs[half=bottom,shape=straight,facing=north]", "203:4": "minecraft:purpur_stairs[half=top,shape=straight,facing=east]", "203:5": "minecraft:purpur_stairs[half=top,shape=straight,facing=west]", "203:6": "minecraft:purpur_stairs[half=top,shape=straight,facing=south]", "203:7": "minecraft:purpur_stairs[half=top,shape=straight,facing=north]", "204:0": "minecraft:purpur_slab[type=double]", "205:0": "minecraft:purpur_slab[type=bottom]", "205:8": "minecraft:purpur_slab[type=top]", "206:0": "minecraft:end_stone_bricks", "207:0": "minecraft:beetroots[age=0]", "207:1": "minecraft:beetroots[age=1]", "207:2": "minecraft:beetroots[age=2]", "207:3": "minecraft:beetroots[age=3]", "208:0": "minecraft:grass_path", "209:0": "minecraft:end_gateway", "210:0": "minecraft:repeating_command_block[conditional=false,facing=down]", "210:1": "minecraft:repeating_command_block[conditional=false,facing=up]", "210:2": "minecraft:repeating_command_block[conditional=false,facing=north]", "210:3": "minecraft:repeating_command_block[conditional=false,facing=south]", "210:4": "minecraft:repeating_command_block[conditional=false,facing=west]", "210:5": "minecraft:repeating_command_block[conditional=false,facing=east]", "210:8": "minecraft:repeating_command_block[conditional=true,facing=down]", "210:9": "minecraft:repeating_command_block[conditional=true,facing=up]", "210:10": "minecraft:repeating_command_block[conditional=true,facing=north]", "210:11": "minecraft:repeating_command_block[conditional=true,facing=south]", "210:12": "minecraft:repeating_command_block[conditional=true,facing=west]", "210:13": "minecraft:repeating_command_block[conditional=true,facing=east]", "211:0": "minecraft:chain_command_block[conditional=false,facing=down]", "211:1": "minecraft:chain_command_block[conditional=false,facing=up]", "211:2": "minecraft:chain_command_block[conditional=false,facing=north]", "211:3": "minecraft:chain_command_block[conditional=false,facing=south]", "211:4": "minecraft:chain_command_block[conditional=false,facing=west]", "211:5": "minecraft:chain_command_block[conditional=false,facing=east]", "211:8": "minecraft:chain_command_block[conditional=true,facing=down]", "211:9": "minecraft:chain_command_block[conditional=true,facing=up]", "211:10": "minecraft:chain_command_block[conditional=true,facing=north]", "211:11": "minecraft:chain_command_block[conditional=true,facing=south]", "211:12": "minecraft:chain_command_block[conditional=true,facing=west]", "211:13": "minecraft:chain_command_block[conditional=true,facing=east]", "212:0": "minecraft:frosted_ice[age=0]", "212:1": "minecraft:frosted_ice[age=1]", "212:2": "minecraft:frosted_ice[age=2]", "212:3": "minecraft:frosted_ice[age=3]", "213:0": "minecraft:magma_block", "214:0": "minecraft:nether_wart_block", "215:0": "minecraft:red_nether_bricks", "216:0": "minecraft:bone_block[axis=y]", "216:4": "minecraft:bone_block[axis=x]", "216:8": "minecraft:bone_block[axis=z]", "217:0": "minecraft:structure_void", "218:0": "minecraft:observer[powered=false,facing=down]", "218:1": "minecraft:observer[powered=false,facing=up]", "218:2": "minecraft:observer[powered=false,facing=north]", "218:3": "minecraft:observer[powered=false,facing=south]", "218:4": "minecraft:observer[powered=false,facing=west]", "218:5": "minecraft:observer[powered=false,facing=east]", "218:8": "minecraft:observer[powered=true,facing=down]", "218:9": "minecraft:observer[powered=true,facing=up]", "218:10": "minecraft:observer[powered=true,facing=north]", "218:11": "minecraft:observer[powered=true,facing=south]", "218:12": "minecraft:observer[powered=true,facing=west]", "218:13": "minecraft:observer[powered=true,facing=east]", "219:0": "minecraft:white_shulker_box[facing=down]", "219:1": "minecraft:white_shulker_box[facing=up]", "219:2": "minecraft:white_shulker_box[facing=north]", "219:3": "minecraft:white_shulker_box[facing=south]", "219:4": "minecraft:white_shulker_box[facing=west]", "219:5": "minecraft:white_shulker_box[facing=east]", "220:0": "minecraft:orange_shulker_box[facing=down]", "220:1": "minecraft:orange_shulker_box[facing=up]", "220:2": "minecraft:orange_shulker_box[facing=north]", "220:3": "minecraft:orange_shulker_box[facing=south]", "220:4": "minecraft:orange_shulker_box[facing=west]", "220:5": "minecraft:orange_shulker_box[facing=east]", "221:0": "minecraft:magenta_shulker_box[facing=down]", "221:1": "minecraft:magenta_shulker_box[facing=up]", "221:2": "minecraft:magenta_shulker_box[facing=north]", "221:3": "minecraft:magenta_shulker_box[facing=south]", "221:4": "minecraft:magenta_shulker_box[facing=west]", "221:5": "minecraft:magenta_shulker_box[facing=east]", "222:0": "minecraft:light_blue_shulker_box[facing=down]", "222:1": "minecraft:light_blue_shulker_box[facing=up]", "222:2": "minecraft:light_blue_shulker_box[facing=north]", "222:3": "minecraft:light_blue_shulker_box[facing=south]", "222:4": "minecraft:light_blue_shulker_box[facing=west]", "222:5": "minecraft:light_blue_shulker_box[facing=east]", "223:0": "minecraft:yellow_shulker_box[facing=down]", "223:1": "minecraft:yellow_shulker_box[facing=up]", "223:2": "minecraft:yellow_shulker_box[facing=north]", "223:3": "minecraft:yellow_shulker_box[facing=south]", "223:4": "minecraft:yellow_shulker_box[facing=west]", "223:5": "minecraft:yellow_shulker_box[facing=east]", "224:0": "minecraft:lime_shulker_box[facing=down]", "224:1": "minecraft:lime_shulker_box[facing=up]", "224:2": "minecraft:lime_shulker_box[facing=north]", "224:3": "minecraft:lime_shulker_box[facing=south]", "224:4": "minecraft:lime_shulker_box[facing=west]", "224:5": "minecraft:lime_shulker_box[facing=east]", "225:0": "minecraft:pink_shulker_box[facing=down]", "225:1": "minecraft:pink_shulker_box[facing=up]", "225:2": "minecraft:pink_shulker_box[facing=north]", "225:3": "minecraft:pink_shulker_box[facing=south]", "225:4": "minecraft:pink_shulker_box[facing=west]", "225:5": "minecraft:pink_shulker_box[facing=east]", "226:0": "minecraft:gray_shulker_box[facing=down]", "226:1": "minecraft:gray_shulker_box[facing=up]", "226:2": "minecraft:gray_shulker_box[facing=north]", "226:3": "minecraft:gray_shulker_box[facing=south]", "226:4": "minecraft:gray_shulker_box[facing=west]", "226:5": "minecraft:gray_shulker_box[facing=east]", "227:0": "minecraft:light_gray_shulker_box[facing=down]", "227:1": "minecraft:light_gray_shulker_box[facing=up]", "227:2": "minecraft:light_gray_shulker_box[facing=north]", "227:3": "minecraft:light_gray_shulker_box[facing=south]", "227:4": "minecraft:light_gray_shulker_box[facing=west]", "227:5": "minecraft:light_gray_shulker_box[facing=east]", "228:0": "minecraft:cyan_shulker_box[facing=down]", "228:1": "minecraft:cyan_shulker_box[facing=up]", "228:2": "minecraft:cyan_shulker_box[facing=north]", "228:3": "minecraft:cyan_shulker_box[facing=south]", "228:4": "minecraft:cyan_shulker_box[facing=west]", "228:5": "minecraft:cyan_shulker_box[facing=east]", "229:0": "minecraft:purple_shulker_box[facing=down]", "229:1": "minecraft:purple_shulker_box[facing=up]", "229:2": "minecraft:purple_shulker_box[facing=north]", "229:3": "minecraft:purple_shulker_box[facing=south]", "229:4": "minecraft:purple_shulker_box[facing=west]", "229:5": "minecraft:purple_shulker_box[facing=east]", "230:0": "minecraft:blue_shulker_box[facing=down]", "230:1": "minecraft:blue_shulker_box[facing=up]", "230:2": "minecraft:blue_shulker_box[facing=north]", "230:3": "minecraft:blue_shulker_box[facing=south]", "230:4": "minecraft:blue_shulker_box[facing=west]", "230:5": "minecraft:blue_shulker_box[facing=east]", "231:0": "minecraft:brown_shulker_box[facing=down]", "231:1": "minecraft:brown_shulker_box[facing=up]", "231:2": "minecraft:brown_shulker_box[facing=north]", "231:3": "minecraft:brown_shulker_box[facing=south]", "231:4": "minecraft:brown_shulker_box[facing=west]", "231:5": "minecraft:brown_shulker_box[facing=east]", "232:0": "minecraft:green_shulker_box[facing=down]", "232:1": "minecraft:green_shulker_box[facing=up]", "232:2": "minecraft:green_shulker_box[facing=north]", "232:3": "minecraft:green_shulker_box[facing=south]", "232:4": "minecraft:green_shulker_box[facing=west]", "232:5": "minecraft:green_shulker_box[facing=east]", "233:0": "minecraft:red_shulker_box[facing=down]", "233:1": "minecraft:red_shulker_box[facing=up]", "233:2": "minecraft:red_shulker_box[facing=north]", "233:3": "minecraft:red_shulker_box[facing=south]", "233:4": "minecraft:red_shulker_box[facing=west]", "233:5": "minecraft:red_shulker_box[facing=east]", "234:0": "minecraft:black_shulker_box[facing=down]", "234:1": "minecraft:black_shulker_box[facing=up]", "234:2": "minecraft:black_shulker_box[facing=north]", "234:3": "minecraft:black_shulker_box[facing=south]", "234:4": "minecraft:black_shulker_box[facing=west]", "234:5": "minecraft:black_shulker_box[facing=east]", "235:0": "minecraft:white_glazed_terracotta[facing=south]", "235:1": "minecraft:white_glazed_terracotta[facing=west]", "235:2": "minecraft:white_glazed_terracotta[facing=north]", "235:3": "minecraft:white_glazed_terracotta[facing=east]", "236:0": "minecraft:orange_glazed_terracotta[facing=south]", "236:1": "minecraft:orange_glazed_terracotta[facing=west]", "236:2": "minecraft:orange_glazed_terracotta[facing=north]", "236:3": "minecraft:orange_glazed_terracotta[facing=east]", "237:0": "minecraft:magenta_glazed_terracotta[facing=south]", "237:1": "minecraft:magenta_glazed_terracotta[facing=west]", "237:2": "minecraft:magenta_glazed_terracotta[facing=north]", "237:3": "minecraft:magenta_glazed_terracotta[facing=east]", "238:0": "minecraft:light_blue_glazed_terracotta[facing=south]", "238:1": "minecraft:light_blue_glazed_terracotta[facing=west]", "238:2": "minecraft:light_blue_glazed_terracotta[facing=north]", "238:3": "minecraft:light_blue_glazed_terracotta[facing=east]", "239:0": "minecraft:yellow_glazed_terracotta[facing=south]", "239:1": "minecraft:yellow_glazed_terracotta[facing=west]", "239:2": "minecraft:yellow_glazed_terracotta[facing=north]", "239:3": "minecraft:yellow_glazed_terracotta[facing=east]", "240:0": "minecraft:lime_glazed_terracotta[facing=south]", "240:1": "minecraft:lime_glazed_terracotta[facing=west]", "240:2": "minecraft:lime_glazed_terracotta[facing=north]", "240:3": "minecraft:lime_glazed_terracotta[facing=east]", "241:0": "minecraft:pink_glazed_terracotta[facing=south]", "241:1": "minecraft:pink_glazed_terracotta[facing=west]", "241:2": "minecraft:pink_glazed_terracotta[facing=north]", "241:3": "minecraft:pink_glazed_terracotta[facing=east]", "242:0": "minecraft:gray_glazed_terracotta[facing=south]", "242:1": "minecraft:gray_glazed_terracotta[facing=west]", "242:2": "minecraft:gray_glazed_terracotta[facing=north]", "242:3": "minecraft:gray_glazed_terracotta[facing=east]", "243:0": "minecraft:light_gray_glazed_terracotta[facing=south]", "243:1": "minecraft:light_gray_glazed_terracotta[facing=west]", "243:2": "minecraft:light_gray_glazed_terracotta[facing=north]", "243:3": "minecraft:light_gray_glazed_terracotta[facing=east]", "244:0": "minecraft:cyan_glazed_terracotta[facing=south]", "244:1": "minecraft:cyan_glazed_terracotta[facing=west]", "244:2": "minecraft:cyan_glazed_terracotta[facing=north]", "244:3": "minecraft:cyan_glazed_terracotta[facing=east]", "245:0": "minecraft:purple_glazed_terracotta[facing=south]", "245:1": "minecraft:purple_glazed_terracotta[facing=west]", "245:2": "minecraft:purple_glazed_terracotta[facing=north]", "245:3": "minecraft:purple_glazed_terracotta[facing=east]", "246:0": "minecraft:blue_glazed_terracotta[facing=south]", "246:1": "minecraft:blue_glazed_terracotta[facing=west]", "246:2": "minecraft:blue_glazed_terracotta[facing=north]", "246:3": "minecraft:blue_glazed_terracotta[facing=east]", "247:0": "minecraft:brown_glazed_terracotta[facing=south]", "247:1": "minecraft:brown_glazed_terracotta[facing=west]", "247:2": "minecraft:brown_glazed_terracotta[facing=north]", "247:3": "minecraft:brown_glazed_terracotta[facing=east]", "248:0": "minecraft:green_glazed_terracotta[facing=south]", "248:1": "minecraft:green_glazed_terracotta[facing=west]", "248:2": "minecraft:green_glazed_terracotta[facing=north]", "248:3": "minecraft:green_glazed_terracotta[facing=east]", "249:0": "minecraft:red_glazed_terracotta[facing=south]", "249:1": "minecraft:red_glazed_terracotta[facing=west]", "249:2": "minecraft:red_glazed_terracotta[facing=north]", "249:3": "minecraft:red_glazed_terracotta[facing=east]", "250:0": "minecraft:black_glazed_terracotta[facing=south]", "250:1": "minecraft:black_glazed_terracotta[facing=west]", "250:2": "minecraft:black_glazed_terracotta[facing=north]", "250:3": "minecraft:black_glazed_terracotta[facing=east]", "251:0": "minecraft:white_concrete", "251:1": "minecraft:orange_concrete", "251:2": "minecraft:magenta_concrete", "251:3": "minecraft:light_blue_concrete", "251:4": "minecraft:yellow_concrete", "251:5": "minecraft:lime_concrete", "251:6": "minecraft:pink_concrete", "251:7": "minecraft:gray_concrete", "251:8": "minecraft:light_gray_concrete", "251:9": "minecraft:cyan_concrete", "251:10": "minecraft:purple_concrete", "251:11": "minecraft:blue_concrete", "251:12": "minecraft:brown_concrete", "251:13": "minecraft:green_concrete", "251:14": "minecraft:red_concrete", "251:15": "minecraft:black_concrete", "252:0": "minecraft:white_concrete_powder", "252:1": "minecraft:orange_concrete_powder", "252:2": "minecraft:magenta_concrete_powder", "252:3": "minecraft:light_blue_concrete_powder", "252:4": "minecraft:yellow_concrete_powder", "252:5": "minecraft:lime_concrete_powder", "252:6": "minecraft:pink_concrete_powder", "252:7": "minecraft:gray_concrete_powder", "252:8": "minecraft:light_gray_concrete_powder", "252:9": "minecraft:cyan_concrete_powder", "252:10": "minecraft:purple_concrete_powder", "252:11": "minecraft:blue_concrete_powder", "252:12": "minecraft:brown_concrete_powder", "252:13": "minecraft:green_concrete_powder", "252:14": "minecraft:red_concrete_powder", "252:15": "minecraft:black_concrete_powder", "255:0": "minecraft:structure_block[mode=save]", "255:1": "minecraft:structure_block[mode=load]", "255:2": "minecraft:structure_block[mode=corner]", "255:3": "minecraft:structure_block[mode=data]" } };

// packages/catalog/src/data.ts
var catalogData = catalog_default;

// packages/catalog/src/versions.ts
function compareVersions(a, b) {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
function majorOf(id) {
  return id.split(".").slice(0, 2).join(".");
}
var VERSIONS = catalogData.versions.map((v) => ({
  id: v.id,
  dataVersion: v.dataVersion,
  dataset: v.dataset,
  legacy: catalogData.datasets[v.dataset]?.legacy ?? false,
  major: majorOf(v.id)
}));
var BY_ID = new Map(VERSIONS.map((v) => [v.id, v]));
function listVersions() {
  return VERSIONS;
}
var LATEST_VERSION = VERSIONS[0];
function resolveVersion(input) {
  const s = input.trim().toLowerCase().replace(/^(java|je|v)\s*/, "");
  if (s === "latest" || s === "") return LATEST_VERSION;
  const exact = BY_ID.get(s);
  if (exact) return exact;
  const family = s.replace(/\.(x|\*)$/, "");
  if (family !== s || /^\d+\.\d+$/.test(family)) {
    return VERSIONS.find((v) => v.major === family);
  }
  return void 0;
}
function assetVersionFor(version) {
  return version.legacy ? "1.13.2" : version.id;
}
var LATEST_DATA_RELEASE = LATEST_VERSION.dataset.replace(/^pc\//, "").replace(/~.*$/, "");
function blockDataIsOlder(version) {
  return compareVersions(version.id, LATEST_DATA_RELEASE) > 0;
}

// packages/catalog/src/blockState.ts
var STATE_RE = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)(?:\[([^\]]*)\])?$/;
function parseBlockState(input) {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const m = STATE_RE.exec(s);
  if (!m)
    return { error: `"${input}" is not a valid block state (expected name[prop=value,...]).` };
  const props = {};
  if (m[3]) {
    for (const pair of m[3].split(",")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0 || eq === pair.length - 1) {
        return { error: `"${input}": property "${pair}" must look like key=value.` };
      }
      props[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return { namespace: m[1] ?? "minecraft", name: m[2], props };
}
function stringifyState(name, props, namespace = "minecraft") {
  const keys = Object.keys(props).sort();
  const base = `${namespace}:${name}`;
  if (keys.length === 0) return base;
  return `${base}[${keys.map((k) => `${k}=${props[k]}`).join(",")}]`;
}
function blockNameOf(state) {
  const noNs = state.includes(":") ? state.slice(state.indexOf(":") + 1) : state;
  const br = noNs.indexOf("[");
  return br === -1 ? noNs : noNs.slice(0, br);
}
function propsOf(state) {
  const br = state.indexOf("[");
  const out = {};
  if (br === -1) return out;
  for (const pair of state.slice(br + 1, -1).split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

// packages/catalog/src/BlockCatalog.ts
var ALIASES = {
  dirt_path: ["grass_path"],
  grass_path: ["dirt_path"],
  short_grass: ["grass"],
  grass: ["short_grass"],
  oak_sign: ["sign"],
  sign: ["oak_sign"],
  oak_wall_sign: ["wall_sign"],
  wall_sign: ["oak_wall_sign"],
  iron_chain: ["chain"],
  chain: ["iron_chain"],
  smooth_stone_slab: ["stone_slab"]
};
var FULL_CUBES = new Set(catalogData.fullCubes);
var MATERIAL_SUBSTITUTES = {
  deepslate: ["stone", "cobblestone", "andesite", "polished_andesite"],
  cobbled: ["cobblestone"],
  tuff: ["andesite", "stone"],
  calcite: ["diorite", "quartz", "white_concrete"],
  mud: ["brick", "terracotta", "granite"],
  packed: ["terracotta"],
  cherry: ["birch", "jungle"],
  bamboo: ["birch", "jungle", "oak"],
  mangrove: ["jungle", "dark_oak", "acacia"],
  crimson: ["dark_oak", "jungle"],
  warped: ["dark_prismarine", "prismarine", "spruce"],
  pale: ["birch"],
  blackstone: ["cobblestone", "stone"],
  basalt: ["stone", "andesite"],
  copper: ["terracotta", "prismarine", "brick"],
  oxidized: ["prismarine"],
  resin: ["brick", "red_sandstone"],
  amethyst: ["purpur", "magenta_concrete"],
  prismarine: ["stone", "cobblestone"],
  purpur: ["quartz", "sandstone"],
  quartz: ["smooth_stone", "snow", "white_wool"],
  concrete: ["wool", "terracotta"],
  moss: ["mossy_cobblestone", "grass", "oak_leaves"],
  andesite: ["stone", "cobblestone"],
  diorite: ["quartz", "stone"],
  granite: ["brick", "red_sandstone"],
  cinnabar: ["red_nether", "brick", "granite"],
  sulfur: ["sandstone", "yellow_terracotta"]
};
var sinceCache = null;
function blockAddedIn(name) {
  if (!sinceCache) {
    sinceCache = /* @__PURE__ */ new Map();
    const oldestFirst = [...listVersions()].reverse();
    for (const v of oldestFirst) {
      for (const n of getCatalog(v).names()) {
        if (!sinceCache.has(n)) sinceCache.set(n, v.id);
      }
    }
  }
  return sinceCache.get(name);
}
function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}
var BlockCatalog = class {
  version;
  blocks = /* @__PURE__ */ new Map();
  cache = /* @__PURE__ */ new Map();
  constructor(version) {
    this.version = version;
    const ds = catalogData.datasets[version.dataset];
    if (!ds) throw new Error(`No block data for Minecraft ${version.id}.`);
    for (let i = 0; i < ds.blocks.length; i += 2) {
      const name = catalogData.names[ds.blocks[i]];
      this.blocks.set(name, catalogData.sigs[ds.blocks[i + 1]] ?? []);
    }
  }
  has(name) {
    return this.blocks.has(name);
  }
  /**
   * Add a block the bundled data doesn't know yet (releases newer than minecraft-data), with
   * properties taken from the game's own resources. Existing blocks are left untouched.
   */
  augment(name, props) {
    if (this.blocks.has(name)) return false;
    this.blocks.set(name, props);
    this.cache.clear();
    return true;
  }
  /** Signature of an existing block, to reuse for a new block of the same family. */
  propSpec(name) {
    return this.blocks.get(name);
  }
  names() {
    return [...this.blocks.keys()];
  }
  get size() {
    return this.blocks.size;
  }
  props(name) {
    const spec = this.blocks.get(name);
    if (!spec) return void 0;
    return spec.map(([n, values, d]) => ({ name: n, values, default: values[d] }));
  }
  /** Allowed values of one property, or undefined if the block lacks it. */
  propValues(name, prop) {
    const spec = this.blocks.get(name);
    return spec?.find((p) => p[0] === prop)?.[1];
  }
  defaultProps(name) {
    const out = {};
    for (const [n, values, d] of this.blocks.get(name) ?? []) out[n] = values[d];
    return out;
  }
  displayName(name) {
    return catalogData.displayNames[name] ?? name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  /** Collision shape is a full cube (fences/walls/panes connect to it). */
  isFullCube(name) {
    return FULL_CUBES.has(name);
  }
  /** Map a name to this version's name for the same block, if it differs. */
  resolveName(name) {
    if (this.blocks.has(name)) return name;
    for (const alias of ALIASES[name] ?? []) if (this.blocks.has(alias)) return alias;
    return void 0;
  }
  /**
   * Alternatives for a block that is missing or misspelled: same shape in a similar material
   * (cherry_stairs → birch_stairs, deepslate_tiles → stone_bricks), the plain variant
   * (stripped_spruce_log → spruce_log), then names sharing words, then spelling.
   */
  suggest(name, limit = 4) {
    const out = [];
    const add = (n) => {
      if (this.blocks.has(n) && !out.includes(n) && n !== name) out.push(n);
    };
    const words = name.split("_");
    for (let i = 0; i < words.length; i++) {
      for (const sub of MATERIAL_SUBSTITUTES[words[i]] ?? []) {
        const swapped = [...words.slice(0, i), ...sub.split("_"), ...words.slice(i + 1)].join("_");
        add(swapped);
        add(swapped.replace(/_tile_/, "_brick_"));
        add(swapped.replace(/_tiles?\b/, "_bricks"));
        add(swapped.replace(/_tiles?$/, ""));
        add(swapped.replace(/^polished_/, ""));
        add(swapped.replace(/_bricks?$/, ""));
      }
    }
    add(name.replace(/^(stripped|polished|chiseled|cut|smooth|cracked|mossy|waxed|infested)_/, ""));
    add(name.replace(/_tiles$/, "_bricks"));
    add(name.replace(/_bricks$/, "s"));
    if (out.length < limit) {
      const wordSet = new Set(words);
      const scored = [];
      for (const n of this.blocks.keys()) {
        if (out.includes(n)) continue;
        const nw = n.split("_");
        const shared = nw.filter((w) => wordSet.has(w)).length;
        const lev = levenshtein(name, n) / Math.max(name.length, n.length);
        const score = lev - shared * 0.25 - (n.includes(name) ? 0.2 : 0);
        if (shared > 0 || lev < 0.35) scored.push([n, score]);
      }
      scored.sort((a, b) => a[1] - b[1]);
      for (const [n] of scored) {
        if (out.length >= limit) break;
        out.push(n);
      }
    }
    return out.slice(0, limit);
  }
  /** Validate and complete a block state string for this version. Memoized. */
  normalize(input) {
    const cached = this.cache.get(input);
    if (cached) return cached;
    const result = this.normalizeUncached(input);
    this.cache.set(input, result);
    return result;
  }
  normalizeUncached(input) {
    const parsed = parseBlockState(input);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    if (parsed.namespace !== "minecraft") {
      return { ok: false, error: `"${input}": only vanilla minecraft: blocks are supported.` };
    }
    const name = this.resolveName(parsed.name);
    if (!name) return { ok: false, error: this.unknownBlockMessage(parsed.name) };
    const spec = this.blocks.get(name) ?? [];
    const props = {};
    for (const [n, values, d] of spec) props[n] = values[d];
    const explicit = [];
    for (const [key, value] of Object.entries(parsed.props)) {
      const def = spec.find((p) => p[0] === key);
      if (!def) {
        const known = spec.map((p) => p[0]).join(", ") || "none";
        return {
          ok: false,
          error: `"${input}": ${name} has no property "${key}" in ${this.version.id} (properties: ${known}).`
        };
      }
      if (!def[1].includes(value)) {
        return {
          ok: false,
          error: `"${input}": ${key}=${value} is invalid for ${name} (allowed: ${def[1].join(", ")}).`
        };
      }
      props[key] = value;
      explicit.push(key);
    }
    return {
      ok: true,
      state: stringifyState(name, props),
      name,
      props,
      explicit,
      ...name !== parsed.name ? { renamedFrom: parsed.name } : {}
    };
  }
  unknownBlockMessage(name) {
    const since = blockAddedIn(name);
    if (since && compareVersions(since, this.version.id) > 0) {
      const alt2 = this.suggest(name, 3);
      return `minecraft:${name} does not exist in ${this.version.id} (added in ${since}).` + (alt2.length ? ` Closest blocks available in ${this.version.id}: ${alt2.join(", ")}.` : "");
    }
    if (since) {
      return `minecraft:${name} is not available in ${this.version.id}.`;
    }
    const alt = this.suggest(name);
    return `Unknown block "minecraft:${name}".` + (alt.length ? ` Did you mean: ${alt.join(", ")}?` : "");
  }
  /** Substring search over names (all words must match), shortest names first. */
  search(query, limit = 60) {
    const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const out = this.names().filter((n) => words.every((w) => n.includes(w)));
    out.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return out.slice(0, limit);
  }
};
var catalogs = /* @__PURE__ */ new Map();
function getCatalog(version) {
  const info = typeof version === "string" ? resolveVersion(version) : version;
  if (!info) throw new Error(`Unsupported Minecraft version "${String(version)}".`);
  let cat = catalogs.get(info.id);
  if (!cat) {
    cat = new BlockCatalog(info);
    catalogs.set(info.id, cat);
  }
  return cat;
}

// packages/catalog/src/legacy.ts
var index = null;
var resolved = /* @__PURE__ */ new Map();
function buildIndex() {
  const map = /* @__PURE__ */ new Map();
  for (const [key, state] of Object.entries(catalogData.legacyBlocks)) {
    const [id, meta] = key.split(":").map(Number);
    const name = blockNameOf(state);
    const list2 = map.get(name) ?? [];
    list2.push({ id, meta, props: propsOf(state) });
    map.set(name, list2);
  }
  for (const list2 of map.values()) list2.sort((a, b) => a.id - b.id || a.meta - b.meta);
  return map;
}
function toLegacyIdMeta(state) {
  const hit = resolved.get(state);
  if (hit !== void 0) return hit;
  index ??= buildIndex();
  const entries = index.get(blockNameOf(state));
  let best = null;
  let bestScore = -1;
  if (entries) {
    const props = propsOf(state);
    for (const e of entries) {
      let score = 0;
      for (const [k, v] of Object.entries(e.props)) {
        if (props[k] === v) score += 2;
        else if (k in props) score -= 1;
      }
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
  }
  const result = best ? { id: best.id, meta: best.meta } : null;
  resolved.set(state, result);
  return result;
}

// packages/shared/src/assets.ts
var QUAD_STRIDE = 26;

// packages/shared/src/blockColor.ts
function cleanName(state) {
  const s = state.toLowerCase();
  const withoutNs = s.includes(":") ? s.slice(s.indexOf(":") + 1) : s;
  return withoutNs.replace(/\[.*$/, "");
}
var KEYWORD_COLORS = [
  { re: /sea_lantern|prismarine/, hex: "#9fc6bd" },
  { re: /end_rod/, hex: "#e6e2d6" },
  { re: /glass|pane/, hex: "#a9e0f5" },
  { re: /water/, hex: "#3b6feb" },
  { re: /lava|magma/, hex: "#d8662a" },
  { re: /glowstone|shroomlight|redstone_lamp|lantern|torch|lamp|^light$/, hex: "#f4d27a" },
  { re: /mossy/, hex: "#6f7f53" },
  { re: /cobble/, hex: "#7c7c7c" },
  { re: /stone_brick|brick_stone/, hex: "#8a8a8a" },
  { re: /deepslate/, hex: "#3b3b40" },
  { re: /blackstone|basalt|obsidian/, hex: "#2b2b33" },
  { re: /andesite|gravel/, hex: "#9a9a9a" },
  { re: /diorite|quartz|calcite/, hex: "#e7e5dd" },
  { re: /amethyst/, hex: "#9a70c4" },
  { re: /purpur/, hex: "#ab63ab" },
  { re: /granite/, hex: "#9a6a5a" },
  { re: /stone|smooth_stone/, hex: "#8f8f8f" },
  { re: /dark_oak|stripped_spruce/, hex: "#4b3621" },
  { re: /spruce/, hex: "#6f4f2a" },
  { re: /birch/, hex: "#d8c896" },
  { re: /acacia/, hex: "#b5642e" },
  { re: /jungle/, hex: "#9b6b3f" },
  { re: /mangrove/, hex: "#7a3f3a" },
  { re: /cherry/, hex: "#e3b6c8" },
  { re: /bamboo/, hex: "#c2b24a" },
  { re: /crimson/, hex: "#7b3a4b" },
  { re: /warped/, hex: "#2c8374" },
  { re: /oak|plank|log|wood|fence|stripped/, hex: "#9c7a48" },
  { re: /red_sand/, hex: "#bd6b3a" },
  { re: /sand|sandstone/, hex: "#dcd0a0" },
  { re: /nether_brick/, hex: "#3f2226" },
  { re: /brick/, hex: "#9b5b4a" },
  { re: /netherrack|nether/, hex: "#6e3334" },
  { re: /dirt|coarse|podzol|mud|clay|mycelium/, hex: "#7a5a3a" },
  { re: /grass|moss|leaves|vine|fern|kelp|lily/, hex: "#5d8a3a" },
  { re: /snow|powder_snow/, hex: "#eef3f6" },
  { re: /ice/, hex: "#9fd0ff" },
  { re: /wool|concrete|terracotta|glazed/, hex: "#b0795a" },
  { re: /netherite/, hex: "#4a4348" },
  { re: /iron/, hex: "#d8d8d8" },
  { re: /gold/, hex: "#f4d35e" },
  { re: /diamond/, hex: "#5fded0" },
  { re: /emerald/, hex: "#37c87a" },
  { re: /lapis/, hex: "#1f4ea1" },
  { re: /redstone/, hex: "#b32d2d" },
  { re: /coal/, hex: "#2a2a2a" },
  { re: /copper/, hex: "#c1714b" },
  { re: /bone/, hex: "#e3e0ca" }
];
var DYE_COLORS = {
  white: "#e3e6e6",
  light_gray: "#8e8e86",
  gray: "#3f4448",
  black: "#1a1c20",
  brown: "#7a4d2b",
  red: "#a52722",
  orange: "#f07613",
  yellow: "#f8c627",
  lime: "#64ab18",
  green: "#5a7d1d",
  cyan: "#158a8f",
  light_blue: "#3ab3da",
  blue: "#3a3cc1",
  purple: "#8a2db5",
  magenta: "#c14cc4",
  pink: "#ed9ab4"
};
var DYE_NAMES = Object.keys(DYE_COLORS).sort((a, b) => b.length - a.length);
var COLORED_BLOCK = /concrete|wool|terracotta|stained_glass|carpet|candle|shulker_box|glazed|bed|banner/;
function dyeColorFor(name) {
  for (const dye of DYE_NAMES) {
    if (name.startsWith(`${dye}_`)) return DYE_COLORS[dye] ?? null;
  }
  return null;
}
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = h * 31 + s.charCodeAt(i) | 0;
  }
  return (h % 360 + 360) % 360;
}
function blockShape(state) {
  const s = cleanName(state);
  if (/stairs/.test(s)) return "stairs";
  if (/slab/.test(s)) return "slab";
  if (/_bars|^bars$|fence|_pane$|chain|end_rod|lightning_rod|_wall$|wall$|_rail|^rail$|ladder/.test(s)) {
    return "thin";
  }
  if (/glass/.test(s)) return "glass";
  return "full";
}
function colorFor(state) {
  const s = state.toLowerCase();
  const name = cleanName(state);
  if (COLORED_BLOCK.test(name)) {
    const dye = dyeColorFor(name);
    if (dye) return dye;
  }
  for (const { re, hex } of KEYWORD_COLORS) {
    if (re.test(s)) return hex;
  }
  return `hsl(${hashHue(s)}, 42%, 55%)`;
}

// packages/shared/src/version.ts
var APP_VERSION = "0.3.0";

// apps/server/src/assets/ModelBaker.ts
var DIRS = ["down", "up", "north", "south", "west", "east"];
var DIR_INDEX = {
  down: 0,
  up: 1,
  north: 2,
  south: 3,
  west: 4,
  east: 5,
  bottom: 0,
  top: 1
};
var NORMALS = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0]
];
var GRASS = 9551193;
var FOLIAGE = 7842607;
var TINTS = [
  [
    /^(grass_block|short_grass|grass|tall_grass|fern|large_fern|potted_fern|sugar_cane|bush)$/,
    GRASS
  ],
  [/^spruce_leaves$/, 6396257],
  [/^birch_leaves$/, 8431445],
  [/^(oak_leaves|jungle_leaves|acacia_leaves|dark_oak_leaves|mangrove_leaves|vine)$/, FOLIAGE],
  [/^lily_pad$/, 2129968],
  [/^(water|water_cauldron|bubble_column)$/, 4159204],
  [/^leaf_litter$/, 10848842],
  [/^(attached_)?(melon|pumpkin)_stem$/, 14731036],
  [/^redstone_wire$/, 11796480]
];
var SELF_CULL = /(^|_)glass$|^ice$|^packed_ice$|^blue_ice$|^slime_block$|^honey_block$|^water$|^lava$|^tinted_glass$/;
var INVISIBLE = /^(air|cave_air|void_air|barrier|light|structure_void|moving_piston)$/;
function faceCorners(face, f, t) {
  switch (face) {
    case "north":
      return [
        [t[0], t[1], f[2]],
        [t[0], f[1], f[2]],
        [f[0], f[1], f[2]],
        [f[0], t[1], f[2]]
      ];
    case "south":
      return [
        [f[0], t[1], t[2]],
        [f[0], f[1], t[2]],
        [t[0], f[1], t[2]],
        [t[0], t[1], t[2]]
      ];
    case "west":
      return [
        [f[0], t[1], f[2]],
        [f[0], f[1], f[2]],
        [f[0], f[1], t[2]],
        [f[0], t[1], t[2]]
      ];
    case "east":
      return [
        [t[0], t[1], t[2]],
        [t[0], f[1], t[2]],
        [t[0], f[1], f[2]],
        [t[0], t[1], f[2]]
      ];
    case "up":
      return [
        [f[0], t[1], f[2]],
        [f[0], t[1], t[2]],
        [t[0], t[1], t[2]],
        [t[0], t[1], f[2]]
      ];
    case "down":
      return [
        [f[0], f[1], t[2]],
        [f[0], f[1], f[2]],
        [t[0], f[1], f[2]],
        [t[0], f[1], t[2]]
      ];
  }
}
function defaultUv(face, f, t) {
  switch (face) {
    case "down":
      return [f[0], 16 - t[2], t[0], 16 - f[2]];
    case "up":
      return [f[0], f[2], t[0], t[2]];
    case "north":
      return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
    case "south":
      return [f[0], 16 - t[1], t[0], 16 - f[1]];
    case "west":
      return [f[2], 16 - t[1], t[2], 16 - f[1]];
    case "east":
      return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
  }
}
function lockedUv(dir, p) {
  switch (dir) {
    case 0:
      return [p[0], 16 - p[2]];
    case 1:
      return [p[0], p[2]];
    case 2:
      return [16 - p[0], 16 - p[1]];
    case 3:
      return [p[0], 16 - p[1]];
    case 4:
      return [p[2], 16 - p[1]];
    default:
      return [16 - p[2], 16 - p[1]];
  }
}
function rotateAround(p, axis2, rad, o) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const x = p[0] - o[0];
  const y = p[1] - o[1];
  const z3 = p[2] - o[2];
  let r;
  if (axis2 === "x") r = [x, y * c - z3 * s, y * s + z3 * c];
  else if (axis2 === "y") r = [x * c + z3 * s, y, -x * s + z3 * c];
  else r = [x * c - y * s, x * s + y * c, z3];
  return [r[0] + o[0], r[1] + o[1], r[2] + o[2]];
}
function nearestDir(n) {
  let best = 1;
  let bestDot = -Infinity;
  NORMALS.forEach((d, i) => {
    const dot = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  });
  return best;
}
function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}
function matches(cond, props) {
  if ("OR" in cond) return cond.OR.some((c) => matches(c, props));
  if ("AND" in cond) return cond.AND.every((c) => matches(c, props));
  return Object.entries(cond).every(([k, v]) => {
    const allowed = String(v).split("|");
    return allowed.includes(props[k] ?? "");
  });
}
function variantKeyMatches(key, props) {
  if (key === "" || key === "normal") return true;
  return key.split(",").every((pair) => {
    const [k, v] = pair.split("=");
    return props[k] === v;
  });
}
var DYES = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black"
];
var ModelBaker = class {
  constructor(pack) {
    this.pack = pack;
    pack.manifest.textures.forEach((n, i) => this.layerOf.set(n, i));
  }
  layerOf = /* @__PURE__ */ new Map();
  resolved = /* @__PURE__ */ new Map();
  cache = /* @__PURE__ */ new Map();
  bake(state) {
    const hit = this.cache.get(state);
    if (hit) return hit;
    const baked = this.bakeUncached(state);
    this.cache.set(state, baked);
    return baked;
  }
  texLayer(ref, textures) {
    let r = ref;
    for (let i = 0; i < 10 && r?.startsWith("#"); i++) r = textures[r.slice(1)];
    if (!r) return 0;
    const name = r.replace(/^minecraft:/, "").replace(/^block\//, "").replace(/^blocks\//, "");
    return this.layerOf.get(name) ?? 0;
  }
  resolve(ref) {
    const key = ref.replace(/^minecraft:/, "");
    const hit = this.resolved.get(key);
    if (hit !== void 0) return hit;
    let out = null;
    const chain = [];
    let cur = key;
    for (let depth = 0; cur && depth < 16; depth++) {
      const m = this.pack.models[cur];
      if (!m) break;
      chain.push(m);
      cur = m.parent?.replace(/^minecraft:/, "");
      if (cur && !cur.includes("/")) cur = `block/${cur}`;
    }
    if (chain.length > 0) {
      const textures = {};
      let elements = [];
      let ao = true;
      for (let i = chain.length - 1; i >= 0; i--) {
        const m = chain[i];
        Object.assign(textures, m.textures ?? {});
        if (m.elements) elements = m.elements;
        if (m.ambientocclusion === false) ao = false;
      }
      out = { textures, elements, ao };
    }
    this.resolved.set(key, out);
    return out;
  }
  /** Biome/fixed colour the game applies to tinted faces; untinted blocks (cherry, azalea…) keep their texture colour. */
  tintFor(name) {
    for (const [re, color] of TINTS) if (re.test(name)) return color;
    return -1;
  }
  /** Quads of one model placed with a variant rotation. */
  bakeModel(model, name, rx, ry, uvlock, out) {
    const center = [8, 8, 8];
    const tint = this.tintFor(name);
    for (const el of model.elements) {
      for (const face of DIRS) {
        const fd = el.faces[face];
        if (!fd) continue;
        let pts = faceCorners(face, el.from, el.to);
        const uv = fd.uv ?? defaultUv(face, el.from, el.to);
        let uvs = [
          [uv[0], uv[1]],
          [uv[0], uv[3]],
          [uv[2], uv[3]],
          [uv[2], uv[1]]
        ];
        if (fd.rotation) {
          const steps = (fd.rotation / 90 % 4 + 4) % 4;
          const cw = [uvs[0], uvs[3], uvs[2], uvs[1]];
          const rot = cw.map((_, i) => cw[(i - steps + 4) % 4]);
          uvs = [rot[0], rot[3], rot[2], rot[1]];
        }
        let normal = NORMALS[DIR_INDEX[face]];
        if (el.rotation && el.rotation.angle) {
          const r = el.rotation;
          const rad = r.angle * Math.PI / 180;
          pts = pts.map((p) => rotateAround(p, r.axis, rad, r.origin));
          if (r.rescale) {
            const k = 1 / Math.cos(rad);
            pts = pts.map((p) => {
              const q = [...p];
              for (const a of [0, 1, 2]) {
                if (r.axis === "x" && a === 0 || r.axis === "y" && a === 1 || r.axis === "z" && a === 2)
                  continue;
                q[a] = (p[a] - r.origin[a]) * k + r.origin[a];
              }
              return q;
            });
          }
          normal = rotateAround(normal, r.axis, rad, [0, 0, 0]);
        }
        let cull = fd.cullface !== void 0 ? DIR_INDEX[fd.cullface] ?? -1 : -1;
        if (rx || ry) {
          const radX = -rx * Math.PI / 180;
          const radY = -ry * Math.PI / 180;
          pts = pts.map((p) => rotateAround(rotateAround(p, "x", radX, center), "y", radY, center));
          normal = rotateAround(rotateAround(normal, "x", radX, [0, 0, 0]), "y", radY, [0, 0, 0]);
          if (cull >= 0) {
            const cn = rotateAround(
              rotateAround(NORMALS[cull], "x", radX, [0, 0, 0]),
              "y",
              radY,
              [0, 0, 0]
            );
            cull = nearestDir(cn);
          }
        }
        const dir = nearestDir(normal);
        if (uvlock && (rx || ry)) uvs = pts.map((p) => lockedUv(dir, p));
        const layer = this.texLayer(fd.texture, model.textures);
        const alpha = this.pack.manifest.alpha[layer] ?? 0;
        for (const p of pts) out.push(round4(p[0] / 16), round4(p[1] / 16), round4(p[2] / 16));
        for (const [u, v] of uvs) out.push(round4(u / 16), round4(v / 16));
        out.push(
          layer,
          cull,
          el.shade === false ? -1 : dir,
          fd.tintindex !== void 0 && fd.tintindex >= 0 ? tint : -1,
          alpha,
          model.ao ? 1 : 0
        );
      }
    }
  }
  isFullOpaque(model) {
    return model.elements.some((el) => {
      if (el.rotation?.angle) return false;
      if (el.from.some((v) => v !== 0) || el.to.some((v) => v !== 16)) return false;
      return DIRS.every((d) => {
        const f = el.faces[d];
        if (!f) return false;
        return (this.pack.manifest.alpha[this.texLayer(f.texture, model.textures)] ?? 0) === 0;
      });
    });
  }
  bakeUncached(state) {
    const name = blockNameOf(state);
    const props = propsOf(state);
    const empty = { v: [{ w: 1, q: [] }], full: false, self: false };
    if (INVISIBLE.test(name)) return empty;
    if (name === "water" || name === "lava" || name === "bubble_column") {
      const fluid = name === "lava" ? "lava" : "water";
      return {
        ...empty,
        self: true,
        fluid,
        fluidTex: [this.layerOf.get(`${fluid}_still`) ?? 0, this.layerOf.get(`${fluid}_flow`) ?? 0],
        fluidTint: fluid === "water" ? 4159204 : -1
      };
    }
    const bs = this.pack.blockstates[name];
    const variants = [];
    if (bs?.variants) {
      const key = Object.keys(bs.variants).find((k) => variantKeyMatches(k, props));
      const value = key !== void 0 ? bs.variants[key] : void 0;
      if (value) {
        const list2 = Array.isArray(value) ? value : [value];
        for (const ref of list2) variants.push({ w: ref.weight ?? 1, refs: [ref] });
      }
    } else if (bs?.multipart) {
      const refs = [];
      for (const part of bs.multipart) {
        if (part.when && !matches(part.when, props)) continue;
        const apply = Array.isArray(part.apply) ? part.apply[0] : part.apply;
        if (apply) refs.push(apply);
      }
      variants.push({ w: 1, refs });
    }
    let full = false;
    const out = [];
    for (const v of variants) {
      const q = [];
      for (const ref of v.refs) {
        const model = this.resolve(ref.model);
        if (!model) continue;
        if (model.elements.length === 0) continue;
        if (variants.length && out.length === 0 && this.isFullOpaque(model)) full = true;
        this.bakeModel(model, name, ref.x ?? 0, ref.y ?? 0, ref.uvlock ?? false, q);
      }
      out.push({ w: v.w, q });
    }
    if (out.every((v) => v.q.length === 0)) {
      const stand = this.standIn(name, props, variants[0]?.refs[0]?.model);
      if (stand) return stand;
    }
    if (props.waterlogged === "true") {
      for (const v of out) this.waterOverlay(v.q);
    }
    return { v: out.length ? out : [{ w: 1, q: [] }], full, self: SELF_CULL.test(name) };
  }
  waterOverlay(q) {
    const still = this.layerOf.get("water_still") ?? 0;
    const model = {
      textures: { w: `block/${this.pack.manifest.textures[still]}` },
      ao: false,
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 14, 16],
          faces: Object.fromEntries(
            DIRS.map((d) => [d, { texture: "#w", cullface: d, tintindex: 0 }])
          )
        }
      ]
    };
    this.bakeModel(model, "water", 0, 0, false, q);
  }
  /** Simple shapes for blocks the game renders in code (block entities). */
  standIn(name, props, modelRef) {
    const model = modelRef ? this.resolve(modelRef) : null;
    let particle = model?.textures.particle ?? "block/oak_planks";
    for (let i = 0; i < 5 && particle.startsWith("#"); i++)
      particle = model?.textures[particle.slice(1)] ?? "block/oak_planks";
    const dye = DYES.find((d) => name.startsWith(`${d}_`));
    const box2 = (from, to, tex = "#p") => ({
      from,
      to,
      faces: Object.fromEntries(DIRS.map((d) => [d, { texture: tex }]))
    });
    const textures = {
      p: particle,
      wool: `block/${dye ?? "white"}_wool`,
      white: "block/white_wool"
    };
    const facingY = { north: 0, east: 90, south: 180, west: 270 };
    let elements = [];
    let ry = facingY[props.facing ?? "north"] ?? 0;
    if (/chest$/.test(name)) {
      elements = [box2([1, 0, 1], [15, 14, 15]), box2([7, 7, 0], [9, 11, 1], "#p")];
    } else if (name.endsWith("_bed")) {
      elements = [
        box2([0, 3, 0], [16, 9, 16], "#wool"),
        box2([0, 0, 0], [3, 3, 3]),
        box2([13, 0, 0], [16, 3, 3])
      ];
      if (props.part === "head") elements.push(box2([2, 9, 1], [14, 11, 7], "#white"));
      ry = (ry + 180) % 360;
    } else if (name.endsWith("_wall_hanging_sign")) {
      elements = [box2([1, 0, 7], [15, 10, 9]), box2([0, 14, 6], [16, 16, 10])];
    } else if (name.endsWith("_hanging_sign")) {
      elements = [box2([1, 0, 7], [15, 10, 9])];
      ry = Number(props.rotation ?? 0) * 22.5;
    } else if (name.endsWith("_wall_sign")) {
      elements = [box2([0, 4.5, 14], [16, 12.5, 16])];
    } else if (name.endsWith("_sign")) {
      elements = [box2([7.25, 0, 7.25], [8.75, 9.3, 8.75]), box2([0, 9.3, 7.25], [16, 17.3, 8.75])];
      ry = Number(props.rotation ?? 0) * 22.5 + 180;
    } else if (name.endsWith("_wall_banner")) {
      elements = [box2([1, -14, 14], [15, 14, 15], "#wool"), box2([0, 14, 13], [16, 15.5, 16])];
    } else if (name.endsWith("_banner")) {
      elements = [
        box2([7.25, 0, 7.25], [8.75, 28, 8.75]),
        box2([1, 0, 8.75], [15, 28, 9.75], "#wool"),
        box2([0, 28, 7.25], [16, 29.5, 9.25])
      ];
      ry = Number(props.rotation ?? 0) * 22.5 + 180;
    } else if (/_wall_(head|skull)$/.test(name)) {
      elements = [box2([4, 4, 8], [12, 12, 16])];
    } else if (/_(head|skull)$/.test(name)) {
      elements = [box2([4, 0, 4], [12, 8, 12])];
      ry = Number(props.rotation ?? 0) * 22.5;
    } else if (name === "decorated_pot") {
      elements = [box2([1, 0, 1], [15, 16, 15])];
    } else if (name === "conduit") {
      elements = [box2([5, 5, 5], [11, 11, 11])];
    } else if (model) {
      elements = [box2([0, 0, 0], [16, 16, 16])];
    } else {
      return null;
    }
    const q = [];
    this.bakeModel({ textures, elements, ao: true }, name, 0, ry, false, q);
    return { v: [{ w: 1, q }], full: false, self: false };
  }
  /** Average top and side colors of a state (for the flat fallback renderer). */
  colors(state) {
    const baked = this.bake(state);
    const q = baked.v[0]?.q ?? [];
    let top = -1;
    let side = -1;
    for (let i = 0; i < q.length; i += QUAD_STRIDE) {
      const layer = q[i + 20];
      const dir = q[i + 22];
      let color = this.pack.manifest.avg[layer] ?? 8421504;
      const tint = q[i + 23];
      if (tint >= 0) color = multiply(color, tint);
      if (dir === 1 && top < 0) top = color;
      if (dir >= 2 && side < 0) side = color;
    }
    if (baked.fluid) {
      const c = baked.fluid === "water" ? 4159204 : 14182942;
      return { top: c, side: c };
    }
    if (top < 0 && side < 0) return null;
    return { top: top < 0 ? side : top, side: side < 0 ? top : side };
  }
};
function multiply(a, b) {
  const r = (a >> 16 & 255) * (b >> 16 & 255) / 255;
  const g = (a >> 8 & 255) * (b >> 8 & 255) / 255;
  const bl = (a & 255) * (b & 255) / 255;
  return Math.round(r) << 16 | Math.round(g) << 8 | Math.round(bl);
}

// apps/server/src/assets/AssetStore.ts
var PACK_FORMAT = 3;
var AssetStore = class {
  constructor(onStatus = () => {
  }) {
    this.onStatus = onStatus;
  }
  packs = /* @__PURE__ */ new Map();
  loading = /* @__PURE__ */ new Map();
  status = /* @__PURE__ */ new Map();
  getStatus(version) {
    if (this.packs.has(version)) return { version, state: "ready" };
    return this.status.get(version) ?? { version, state: "missing" };
  }
  peek(version) {
    return this.packs.get(version);
  }
  setStatus(s) {
    this.status.set(s.version, s);
    this.onStatus(s);
  }
  ensure(version) {
    const ready = this.packs.get(version);
    if (ready) return Promise.resolve(ready);
    let p = this.loading.get(version);
    if (!p) {
      p = this.load(version).finally(() => this.loading.delete(version));
      this.loading.set(version, p);
    }
    return p;
  }
  async load(version) {
    const dir = appDir("assets", version);
    const packFile = join3(dir, "pack.json");
    const atlasFile = join3(dir, "atlas.png");
    try {
      let data = null;
      let atlas = null;
      if (existsSync2(packFile) && existsSync2(atlasFile)) {
        const parsed = JSON.parse(readFileSync2(packFile, "utf8"));
        if (parsed.format === PACK_FORMAT) {
          data = parsed;
          atlas = readFileSync2(atlasFile);
        }
      }
      if (!data || !atlas) {
        this.setStatus({
          version,
          state: "loading",
          message: `Preparing Minecraft ${version} textures\u2026`
        });
        const progress = (message, fraction) => this.setStatus({
          version,
          state: "loading",
          message,
          ...fraction !== void 0 ? { progress: fraction } : {}
        });
        const jar = await obtainClientJar(version, progress);
        const built = await buildPack(version, jar, progress);
        data = built.data;
        atlas = built.atlas;
        writeFileSync2(packFile, JSON.stringify({ format: PACK_FORMAT, ...data }));
        writeFileSync2(atlasFile, atlas);
      }
      const pack = { data, atlas, baker: new ModelBaker(data) };
      this.packs.set(version, pack);
      this.setStatus({ version, state: "ready" });
      return pack;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ version, state: "error", message });
      throw error;
    }
  }
  async bake(version, states) {
    const pack = await this.ensure(version);
    const out = {};
    for (const s of states) out[s] = pack.baker.bake(s);
    return out;
  }
};

// apps/server/src/config.ts
import { existsSync as existsSync3 } from "node:fs";
import { fileURLToPath } from "node:url";
function resolveGuides() {
  const candidates = [
    fileURLToPath(new URL("./guides", import.meta.url)),
    fileURLToPath(new URL("../guides", import.meta.url))
  ];
  return candidates.find((d) => existsSync3(d)) ?? candidates[1];
}
function resolveWebDist() {
  const candidates = [];
  if (process.env.WEB_DIST_PATH) {
    candidates.push(process.env.WEB_DIST_PATH);
  }
  candidates.push(fileURLToPath(new URL("./web/dist", import.meta.url)));
  candidates.push(fileURLToPath(new URL("../../web/dist", import.meta.url)));
  for (const dir of candidates) {
    if (existsSync3(`${dir}/index.html`)) {
      return dir;
    }
  }
  return candidates[candidates.length - 1];
}
function loadConfig(argv = process.argv.slice(2)) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "", 10) || 8765;
  const mcpMode = argv.includes("--mcp") || process.env.MCP === "1";
  const baseUrl = `http://${host}:${port}`;
  const webDist = resolveWebDist();
  return { host, port, baseUrl, mcpMode, webDist, guidesDir: resolveGuides() };
}

// apps/server/src/core/BuildService.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join4 } from "node:path";
import { gzipSync as gzipSync2 } from "node:zlib";
import jsonpatch from "fast-json-patch";

// packages/block-compiler/src/BlockVolume.ts
var AIR = "minecraft:air";
function sortPair(a, b) {
  return a <= b ? [a, b] : [b, a];
}
var BlockVolume = class _BlockVolume {
  sizeX;
  sizeY;
  sizeZ;
  /** Spec coordinates of local cell (0,0,0). */
  origin;
  palette;
  data;
  /** Which operation wrote each cell (index into provenance table), 0 = none. */
  prov;
  blockEntities;
  paletteIndex;
  constructor(sizeX, sizeY, sizeZ, origin = [0, 0, 0], palette = [AIR], data, prov, blockEntities = []) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.origin = origin;
    this.palette = palette;
    this.data = data ?? new Uint16Array(sizeX * sizeY * sizeZ);
    this.prov = prov ?? new Uint16Array(sizeX * sizeY * sizeZ);
    this.blockEntities = blockEntities;
    this.paletteIndex = new Map(palette.map((s, i) => [s, i]));
  }
  get volume() {
    return this.sizeX * this.sizeY * this.sizeZ;
  }
  index(x, y, z3) {
    return x + this.sizeX * (z3 + this.sizeZ * y);
  }
  inBounds(x, y, z3) {
    return x >= 0 && y >= 0 && z3 >= 0 && x < this.sizeX && y < this.sizeY && z3 < this.sizeZ;
  }
  idFor(state) {
    const hit = this.paletteIndex.get(state);
    if (hit !== void 0) return hit;
    const id = this.palette.length;
    this.palette.push(state);
    this.paletteIndex.set(state, id);
    return id;
  }
  getId(x, y, z3) {
    if (!this.inBounds(x, y, z3)) return 0;
    return this.data[this.index(x, y, z3)];
  }
  getState(x, y, z3) {
    return this.palette[this.getId(x, y, z3)] ?? AIR;
  }
  setState(x, y, z3, state) {
    if (!this.inBounds(x, y, z3)) return;
    this.data[this.index(x, y, z3)] = this.idFor(state);
  }
  /** Non-air block count per state. */
  counts() {
    const byId = new Uint32Array(this.palette.length);
    for (let i = 0; i < this.data.length; i++) byId[this.data[i]]++;
    const out = /* @__PURE__ */ new Map();
    for (let id = 1; id < byId.length; id++) {
      const n = byId[id];
      if (n > 0) out.set(this.palette[id], n);
    }
    return out;
  }
  countBlocks() {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== 0) n++;
    return n;
  }
  /** Drop unused palette entries and renumber (air stays 0). Returns a new volume. */
  compact() {
    const used = new Uint8Array(this.palette.length);
    for (let i = 0; i < this.data.length; i++) used[this.data[i]] = 1;
    const remap = new Uint16Array(this.palette.length);
    const palette = [AIR];
    for (let id = 1; id < this.palette.length; id++) {
      if (!used[id]) continue;
      remap[id] = palette.length;
      palette.push(this.palette[id]);
    }
    const data = new Uint16Array(this.data.length);
    for (let i = 0; i < data.length; i++) data[i] = remap[this.data[i]];
    return new _BlockVolume(
      this.sizeX,
      this.sizeY,
      this.sizeZ,
      this.origin,
      palette,
      data,
      this.prov,
      this.blockEntities
    );
  }
  /** state -> positions, iterating in YZX order. */
  toInstanceGroups() {
    const groups = {};
    let i = 0;
    for (let y = 0; y < this.sizeY; y++) {
      for (let z3 = 0; z3 < this.sizeZ; z3++) {
        for (let x = 0; x < this.sizeX; x++, i++) {
          const id = this.data[i];
          if (id === 0) continue;
          (groups[this.palette[id]] ??= []).push([x, y, z3]);
        }
      }
    }
    return groups;
  }
};

// packages/build-spec/src/schema.ts
import { z } from "zod";
var vec3 = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
var vec3f = z.tuple([z.number(), z.number(), z.number()]);
var vec2 = z.tuple([z.number().int(), z.number().int()]);
var blockRef = z.string().min(1);
var axis = z.enum(["x", "y", "z"]);
var horizontalAxis = z.enum(["x", "z"]);
var direction = z.enum(["north", "south", "east", "west"]);
var rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
var mask = z.union([z.enum(["air", "solid"]), z.array(blockRef).min(1)]);
var common = {
  /** Stable name so later edits can target this operation. */
  id: z.string().min(1).optional(),
  note: z.string().optional(),
  mask: mask.optional()
};
var boxOp = z.object({
  type: z.literal("box"),
  ...common,
  from: vec3,
  to: vec3,
  block: blockRef,
  /** Only the 6-sided shell. */
  hollow: z.boolean().optional(),
  /** Only the 4 vertical sides (no floor/ceiling). */
  walls: z.boolean().optional(),
  thickness: z.number().int().positive().optional(),
  /** With hollow/walls: also fill the inside with this (e.g. "air" to carve it out). */
  inner: blockRef.optional()
}).strict();
var lineOp = z.object({
  type: z.literal("line"),
  ...common,
  from: vec3.optional(),
  to: vec3.optional(),
  /** Polyline through these points (instead of from/to). */
  points: z.array(vec3).min(2).optional(),
  block: blockRef,
  /** Brush radius; 0 = single-block line. */
  radius: z.number().nonnegative().optional()
}).strict();
var cylinderOp = z.object({
  type: z.literal("cylinder"),
  ...common,
  /** Center of the base disc. */
  center: vec3f,
  radius: z.number().positive(),
  /** Ellipse: second radius (z for vertical cylinders). */
  radius2: z.number().positive().optional(),
  /** Radius at the top end (frustum); 0 makes a cone. */
  radiusTop: z.number().nonnegative().optional(),
  height: z.number().int().positive(),
  axis: axis.optional(),
  block: blockRef,
  hollow: z.boolean().optional(),
  thickness: z.number().positive().optional()
}).strict();
var coneOp = z.object({
  type: z.literal("cone"),
  ...common,
  center: vec3f,
  radius: z.number().positive(),
  height: z.number().int().positive(),
  axis: axis.optional(),
  block: blockRef,
  hollow: z.boolean().optional()
}).strict();
var sphereOp = z.object({
  type: z.literal("sphere"),
  ...common,
  center: vec3f,
  radius: z.number().positive().optional(),
  /** Ellipsoid radii [rx, ry, rz] (instead of radius). */
  radii: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
  block: blockRef,
  hollow: z.boolean().optional(),
  thickness: z.number().positive().optional(),
  /** Keep only one half: "top" makes a dome. */
  half: z.enum(["top", "bottom", "north", "south", "east", "west"]).optional()
}).strict();
var domeOp = z.object({
  type: z.literal("dome"),
  ...common,
  /** Center of the dome's base circle. */
  center: vec3f,
  radius: z.number().positive(),
  /** Vertical radius (defaults to radius). */
  height: z.number().positive().optional(),
  block: blockRef,
  hollow: z.boolean().optional(),
  thickness: z.number().positive().optional()
}).strict();
var polygonOp = z.object({
  type: z.literal("polygon"),
  ...common,
  /** Footprint corners [x, z] in order. */
  points: z.array(vec2).min(3),
  y: z.number().int(),
  height: z.number().int().positive(),
  block: blockRef,
  /** Only the outline walls. */
  hollow: z.boolean().optional(),
  thickness: z.number().int().positive().optional()
}).strict();
var roofOp = z.object({
  type: z.literal("roof"),
  ...common,
  shape: z.enum(["gable", "hip", "shed", "flat", "cone"]),
  /** Wall footprint: from/to x,z are the outer wall faces; from.y is the first layer above the walls. */
  from: vec3.optional(),
  to: vec3.optional(),
  /** cone: center [x, y, z] (y = first layer) and radius of the wall circle. */
  center: vec3f.optional(),
  radius: z.number().positive().optional(),
  /** Stairs block (or palette key) for the slopes. A full block makes a stepped roof. */
  block: blockRef,
  /** gable: direction the ridge runs (default: the longer side). */
  axis: horizontalAxis.optional(),
  /** shed: the side the roof rises toward. */
  rise: direction.optional(),
  /** Rise per horizontal block: 0.5 shallow, 1 classic 45°, 2 steep. */
  pitch: z.number().positive().max(4).optional(),
  /** Rise per row from the eave inward, e.g. [2,2,1,1,0.5] for a curved/gambrel roof. */
  profile: z.array(z.number().positive().max(4)).min(1).optional(),
  /** Blocks the roof extends past the walls (default 1). */
  overhang: z.number().int().nonnegative().optional(),
  /** Slab used for half steps and the ridge (default: derived from the stairs). */
  slab: blockRef.optional(),
  /** Full block used to close steep steps and under the ridge (default: derived). */
  full: blockRef.optional(),
  /** Fill the triangular gable ends above the walls with this. */
  gable: blockRef.optional(),
  /** Fill the whole space under the roof with this. */
  fill: blockRef.optional(),
  /** Trim under the eaves (upside-down stairs are oriented automatically). */
  eaves: blockRef.optional(),
  /** Cap the ridge with this (slab/stairs/full). */
  ridge: blockRef.optional()
}).strict();
var archOp = z.object({
  type: z.literal("arch"),
  ...common,
  /** Bounding box of the opening; the longer horizontal side is the span, the other the depth. */
  from: vec3,
  to: vec3,
  block: blockRef,
  style: z.enum(["round", "pointed", "segmental", "flat"]).optional(),
  /** Rise of the curve above from.y (default: half the span for round). */
  rise: z.number().positive().optional(),
  /** Ring thickness. */
  width: z.number().int().positive().optional(),
  /** Carve the opening (air) under the arch. */
  cut: z.boolean().optional(),
  /** Fill above the arch ring up to to.y (spandrels). */
  fill: blockRef.optional()
}).strict();
var blocksOp = z.object({
  type: z.literal("blocks"),
  ...common,
  block: blockRef,
  at: z.array(vec3).min(1),
  /** Block entity data (chest items, sign text, …) for every placed block. */
  nbt: z.record(z.string(), z.unknown()).optional()
}).strict();
var layersOp = z.object({
  type: z.literal("layers"),
  ...common,
  origin: vec3,
  /**
   * xz: layers stack upward (rows = z, chars = x), like a floor plan.
   * xy: layers stack south (rows top->bottom = y, chars = x), like a front elevation.
   * zy: layers stack east (rows top->bottom = y, chars = z), like a side elevation.
   */
  plane: z.enum(["xz", "xy", "zy"]).optional(),
  /** Single character -> block. " " and "." are skipped unless mapped. */
  legend: z.record(z.string().length(1), blockRef),
  layers: z.array(z.array(z.string())).min(1)
}).strict();
var terrainOp = z.object({
  type: z.literal("terrain"),
  ...common,
  /** x/z extent; from.y is the base level. */
  from: vec3,
  to: vec3,
  shape: z.enum(["hills", "flat", "island", "mountain", "plateau"]).optional(),
  /** Mean surface height above from.y. */
  height: z.number().nonnegative().optional(),
  /** Noise amplitude in blocks. */
  amplitude: z.number().nonnegative().optional(),
  /** Feature size in blocks. */
  scale: z.number().positive().optional(),
  surface: blockRef.optional(),
  subsurface: blockRef.optional(),
  depth: z.number().int().nonnegative().optional(),
  core: blockRef.optional(),
  /** Fill below this y with water where the ground is lower. */
  waterLevel: z.number().int().optional(),
  water: blockRef.optional(),
  /** Fade heights to the base level near the edges. */
  edgeFalloff: z.boolean().optional(),
  seed: z.number().int().optional()
}).strict();
var treeOp = z.object({
  type: z.literal("tree"),
  ...common,
  /** Base of the trunk (the block above the ground). */
  at: vec3,
  kind: z.enum([
    "oak",
    "big_oak",
    "birch",
    "spruce",
    "pine",
    "dark_oak",
    "jungle",
    "acacia",
    "cherry",
    "willow",
    "palm",
    "dead",
    "bush",
    "fantasy"
  ]),
  height: z.number().int().positive().optional(),
  /** Canopy radius. */
  radius: z.number().positive().optional(),
  log: blockRef.optional(),
  leaves: blockRef.optional(),
  seed: z.number().int().optional()
}).strict();
var scatterOp = z.object({
  type: z.literal("scatter"),
  ...common,
  from: vec3,
  to: vec3,
  /** Place on top of these blocks (default: any solid block). */
  on: z.array(blockRef).optional(),
  /** Block to place (palette mixes work), or… */
  block: blockRef.optional(),
  /** …a component to place (randomly rotated), or a tree kind. */
  component: z.string().optional(),
  tree: treeOp.shape.kind.optional(),
  /** Probability per surface block (0–1). */
  density: z.number().min(0).max(1),
  /** Minimum distance between placements. */
  spacing: z.number().nonnegative().optional(),
  seed: z.number().int().optional()
}).strict();
var replaceOp = z.object({
  type: z.literal("replace"),
  ...common,
  /** Region (default: the whole build). */
  from: vec3.optional(),
  to: vec3.optional(),
  /** Blocks to replace; a bare name matches every state of that block. */
  target: z.union([blockRef, z.array(blockRef).min(1)]),
  block: blockRef,
  /** Probability per matching block (0–1), for weathering. */
  chance: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional()
}).strict();
var scriptOp = z.object({
  type: z.literal("script"),
  ...common,
  /** JavaScript body. API: set, get, op, box, line, sphere, …, rand, noise, args. */
  code: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional()
}).strict();
var transformFields = {
  rotate: rotation.optional(),
  mirror: horizontalAxis.optional(),
  /** Copies: count total, each shifted by offset from the previous. */
  repeat: z.object({ count: z.number().int().positive().max(512), offset: vec3 }).strict().optional(),
  /** Also emit a mirrored copy across x = value and/or z = value (may be x.5). */
  symmetry: z.object({ x: z.number().optional(), z: z.number().optional() }).strict().optional()
};
var groupOp = z.lazy(
  () => z.object({
    type: z.literal("group"),
    ...common,
    operations: z.array(operationSchema),
    offset: vec3.optional(),
    ...transformFields
  }).strict()
);
var placeOp = z.object({
  type: z.literal("place"),
  ...common,
  component: z.string().min(1),
  at: vec3,
  ...transformFields
}).strict();
var LEAF_SCHEMAS = {
  box: boxOp,
  line: lineOp,
  cylinder: cylinderOp,
  cone: coneOp,
  sphere: sphereOp,
  dome: domeOp,
  polygon: polygonOp,
  roof: roofOp,
  arch: archOp,
  blocks: blocksOp,
  layers: layersOp,
  terrain: terrainOp,
  tree: treeOp,
  scatter: scatterOp,
  replace: replaceOp,
  script: scriptOp,
  place: placeOp
};
var OPERATION_TYPES = [...Object.keys(LEAF_SCHEMAS), "group"];
var operationSchema = z.lazy(
  () => z.object({ type: z.string() }).passthrough().superRefine((value, ctx) => {
    const schema = value.type === "group" ? groupOp : LEAF_SCHEMAS[value.type];
    if (!schema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: `Unknown operation type "${value.type}". Use one of: ${OPERATION_TYPES.join(", ")}.`
      });
      return;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
    }
  })
);
var paletteEntrySchema = z.union([
  blockRef,
  z.object({
    /** Weighted random mix: { "stone_bricks": 6, "cracked_stone_bricks": 2 }. */
    mix: z.record(blockRef, z.number().positive()),
    /** Clump size in blocks (1 = per-block noise, 4 = patches). */
    scale: z.number().positive().optional(),
    seed: z.number().int().optional()
  }).strict(),
  z.object({
    gradient: z.object({
      axis,
      from: z.number(),
      to: z.number(),
      /** Blocks from the `from` end to the `to` end. */
      blocks: z.array(blockRef).min(2),
      /** 0–1: how much the bands dither into each other. */
      jitter: z.number().min(0).max(1).optional()
    }).strict()
  }).strict()
]);
var componentSchema = z.object({
  description: z.string().optional(),
  operations: z.array(operationSchema)
}).strict();
var buildSpecSchema = z.object({
  $schema: z.string().optional(),
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Target Minecraft Java version, e.g. "1.21.4", "1.20.1", "1.12.2", "26.1". */
  minecraftVersion: z.string().min(1),
  /** Optional hard bounds: blocks outside 0..size-1 are dropped (with a warning). */
  size: z.object({
    x: z.number().int().positive(),
    y: z.number().int().positive(),
    z: z.number().int().positive()
  }).strict().optional(),
  /** Point that lands at the player's feet on //paste (default: bottom center). */
  anchor: vec3.optional(),
  seed: z.number().int().optional(),
  palette: z.record(z.string().min(1), paletteEntrySchema).optional(),
  components: z.record(z.string().min(1), componentSchema).optional(),
  operations: z.array(operationSchema),
  metadata: z.object({
    prompt: z.string().optional(),
    style: z.string().optional(),
    notes: z.array(z.string()).optional(),
    author: z.string().optional()
  }).passthrough().optional()
}).strict();

// packages/build-spec/src/validateBuildSpec.ts
function formatPath(path) {
  let out = "";
  for (const p of path) out += typeof p === "number" ? `[${p}]` : out ? `.${p}` : p;
  return out;
}
function validateBuildSpec(input) {
  const parsed = buildSpecSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data, errors: [] };
  }
  const seen = /* @__PURE__ */ new Set();
  const errors = [];
  for (const issue of parsed.error.issues) {
    const path = formatPath(issue.path);
    let message = issue.message;
    if (issue.code === "unrecognized_keys") {
      message = `unknown field(s) ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
    } else if (issue.code === "invalid_type" && issue.expected === "array" && issue.received === "object") {
      message = "expected an array like [x, y, z], received an object";
    }
    const line2 = path ? `${path}: ${message}` : message;
    if (!seen.has(line2)) {
      seen.add(line2);
      errors.push(line2);
    }
  }
  return { success: false, errors: errors.slice(0, 40) };
}

// packages/build-spec/src/examples.ts
var medievalCottage = {
  name: "Medieval Cottage",
  minecraftVersion: "1.21.4",
  palette: {
    plinth: { mix: { cobblestone: 6, mossy_cobblestone: 2, andesite: 1 }, scale: 2 },
    infill: { mix: { white_terracotta: 5, calcite: 2 }, scale: 2 },
    post: "stripped_spruce_log",
    roof: { mix: { dark_oak_stairs: 4, spruce_stairs: 1 }, scale: 3 },
    flowers: {
      mix: { short_grass: 8, poppy: 1, dandelion: 1, oxeye_daisy: 1, cornflower: 1, fern: 2 }
    }
  },
  operations: [
    {
      id: "ground",
      type: "terrain",
      from: [-8, -3, -8],
      to: [18, -3, 15],
      shape: "flat",
      height: 2,
      edgeFalloff: false
    },
    { id: "path", type: "box", from: [4, -1, 7], to: [6, -1, 15], block: "dirt_path" },
    { id: "plinth", type: "box", from: [0, 0, 0], to: [10, 0, 6], block: "plinth" },
    { id: "walls", type: "box", from: [0, 1, 0], to: [10, 4, 6], block: "infill", walls: true },
    {
      id: "frame",
      type: "group",
      operations: [
        {
          type: "blocks",
          block: "post",
          at: [
            [0, 1, 0],
            [0, 2, 0],
            [0, 3, 0],
            [10, 1, 0],
            [10, 2, 0],
            [10, 3, 0],
            [0, 1, 6],
            [0, 2, 6],
            [0, 3, 6],
            [10, 1, 6],
            [10, 2, 6],
            [10, 3, 6],
            [5, 1, 0],
            [5, 2, 0],
            [5, 3, 0]
          ]
        },
        { type: "line", from: [0, 4, 0], to: [10, 4, 0], block: "post[axis=x]" },
        { type: "line", from: [0, 4, 6], to: [10, 4, 6], block: "post[axis=x]" },
        { type: "line", from: [0, 4, 0], to: [0, 4, 6], block: "post[axis=z]" },
        { type: "line", from: [10, 4, 0], to: [10, 4, 6], block: "post[axis=z]" }
      ]
    },
    {
      id: "windows",
      type: "group",
      symmetry: { z: 3 },
      operations: [
        { type: "box", from: [2, 2, 6], to: [3, 3, 6], block: "glass_pane" },
        { type: "box", from: [7, 2, 6], to: [8, 3, 6], block: "glass_pane" },
        {
          type: "blocks",
          block: "spruce_trapdoor[open=true,facing=south,half=top]",
          at: [
            [1, 2, 7],
            [1, 3, 7],
            [4, 2, 7],
            [4, 3, 7],
            [6, 2, 7],
            [6, 3, 7],
            [9, 2, 7],
            [9, 3, 7]
          ]
        },
        {
          type: "blocks",
          block: "spruce_trapdoor[facing=north,half=top]",
          at: [
            [2, 1, 7],
            [3, 1, 7],
            [7, 1, 7],
            [8, 1, 7]
          ]
        }
      ]
    },
    { id: "door", type: "blocks", block: "spruce_door[facing=north]", at: [[5, 1, 6]] },
    {
      id: "roof",
      type: "roof",
      shape: "gable",
      from: [0, 5, 0],
      to: [10, 5, 6],
      block: "roof",
      overhang: 1,
      gable: "spruce_planks",
      eaves: "spruce_stairs"
    },
    { id: "chimney", type: "box", from: [11, 0, 2], to: [12, 10, 3], block: "bricks" },
    {
      id: "chimney_cap",
      type: "blocks",
      block: "campfire[lit=true,signal_fire=false]",
      at: [[11, 11, 2]]
    },
    { id: "tree_west", type: "tree", kind: "oak", at: [-5, 0, 10], seed: 4 },
    { id: "tree_east", type: "tree", kind: "big_oak", at: [15, 0, -4], seed: 9 },
    {
      id: "flowers",
      type: "scatter",
      from: [-8, -1, -8],
      to: [18, 0, 15],
      on: ["grass_block"],
      block: "flowers",
      density: 0.18
    }
  ],
  metadata: { style: "medieval", prompt: "a cozy timber-framed cottage with a dark oak roof" }
};
var stoneWatchtower = {
  name: "Stone Watchtower",
  minecraftVersion: "1.21.4",
  palette: {
    masonry: {
      mix: { stone_bricks: 6, cracked_stone_bricks: 2, mossy_stone_bricks: 1, andesite: 1 },
      scale: 2
    },
    base: { mix: { cobblestone: 3, mossy_cobblestone: 2, cobbled_deepslate: 1 }, scale: 2 }
  },
  operations: [
    { id: "plinth", type: "cylinder", center: [0, 0, 0], radius: 5, height: 2, block: "base" },
    {
      id: "shaft",
      type: "cylinder",
      center: [0, 2, 0],
      radius: 4,
      height: 14,
      block: "masonry",
      hollow: true
    },
    {
      id: "slits",
      type: "group",
      repeat: { count: 1, offset: [0, 0, 0] },
      symmetry: { x: 0, z: 0 },
      operations: [
        { type: "box", from: [0, 6, -4], to: [0, 8, -4], block: "air" },
        { type: "box", from: [-4, 11, 0], to: [-4, 13, 0], block: "air" }
      ]
    },
    {
      id: "machicolations",
      type: "script",
      code: [
        "const r = 5;",
        "for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {",
        "  const d = Math.hypot(x, z);",
        "  if (d >= r + 0.5 || d < r - 0.5) continue;",
        '  const facing = Math.abs(x) >= Math.abs(z) ? (x > 0 ? "west" : "east") : (z > 0 ? "north" : "south");',
        "  set(x, 15, z, `stone_brick_stairs[half=top,facing=${facing}]`);",
        '  set(x, 16, z, "masonry");',
        '  if ((x + z) % 2 === 0) set(x, 17, z, "masonry");',
        "}"
      ].join("\n")
    },
    {
      id: "floor",
      type: "cylinder",
      center: [0, 16, 0],
      radius: 4,
      height: 1,
      block: "spruce_planks"
    },
    {
      id: "roof",
      type: "roof",
      shape: "cone",
      center: [0, 18, 0],
      radius: 3,
      block: "deepslate_tile_stairs",
      pitch: 2,
      overhang: 1,
      ridge: "lightning_rod"
    }
  ],
  metadata: { style: "medieval" }
};
var exampleSpecs = {
  [medievalCottage.name]: medievalCottage,
  [stoneWatchtower.name]: stoneWatchtower
};

// packages/block-compiler/src/transform.ts
var Transform = class _Transform {
  constructor(a, b, c, d, tx, ty, tz) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
    this.tz = tz;
  }
  static IDENTITY = new _Transform(1, 0, 0, 1, 0, 0, 0);
  static translate(x, y, z3) {
    return new _Transform(1, 0, 0, 1, x, y, z3);
  }
  /** Clockwise as seen from above: east -> south -> west -> north. */
  static rotate(degrees) {
    switch ((degrees % 360 + 360) % 360) {
      case 90:
        return new _Transform(0, -1, 1, 0, 0, 0, 0);
      case 180:
        return new _Transform(-1, 0, 0, -1, 0, 0, 0);
      case 270:
        return new _Transform(0, 1, -1, 0, 0, 0, 0);
      default:
        return _Transform.IDENTITY;
    }
  }
  /** Mirror across a plane: axis "x" flips x (east <-> west) around x = center. */
  static mirror(axis2, center = 0) {
    return axis2 === "x" ? new _Transform(-1, 0, 0, 1, 2 * center, 0, 0) : new _Transform(1, 0, 0, -1, 0, 0, 2 * center);
  }
  /** this ∘ other: apply `other` first, then this. */
  compose(other) {
    return new _Transform(
      this.a * other.a + this.b * other.c,
      this.a * other.b + this.b * other.d,
      this.c * other.a + this.d * other.c,
      this.c * other.b + this.d * other.d,
      this.a * other.tx + this.b * other.tz + this.tx,
      other.ty + this.ty,
      this.c * other.tx + this.d * other.tz + this.tz
    );
  }
  get isIdentityLinear() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1;
  }
  /** Index 0..7 of the linear part, used to cache transformed block states. */
  get linearKey() {
    return D4_KEYS.get(`${this.a},${this.b},${this.c},${this.d}`) ?? 0;
  }
  get mirrored() {
    return this.a * this.d - this.b * this.c < 0;
  }
  /** Transform a horizontal direction vector. */
  dir(dx, dz) {
    return [this.a * dx + this.b * dz, this.c * dx + this.d * dz];
  }
};
var D4_KEYS = /* @__PURE__ */ new Map([
  ["1,0,0,1", 0],
  ["0,-1,1,0", 1],
  ["-1,0,0,-1", 2],
  ["0,1,-1,0", 3],
  ["-1,0,0,1", 4],
  ["1,0,0,-1", 5],
  ["0,1,1,0", 6],
  ["0,-1,-1,0", 7]
]);
var DIR_VEC = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0]
};
function vecToDir(dx, dz) {
  if (dx > 0) return "east";
  if (dx < 0) return "west";
  if (dz > 0) return "south";
  return "north";
}
function mapDir(t, dir) {
  const v = DIR_VEC[dir];
  if (!v) return dir;
  const [x, z3] = t.dir(v[0], v[1]);
  return vecToDir(x, z3);
}
var SWAP_LR = {
  left: "right",
  right: "left",
  inner_left: "inner_right",
  inner_right: "inner_left",
  outer_left: "outer_right",
  outer_right: "outer_left"
};
function mapRailShape(t, shape) {
  if (shape.startsWith("ascending_")) return `ascending_${mapDir(t, shape.slice(10))}`;
  const parts = shape.split("_").map((p) => mapDir(t, p));
  const set = new Set(parts);
  if (set.has("north") && set.has("south")) return "north_south";
  if (set.has("east") && set.has("west")) return "east_west";
  const ns = set.has("north") ? "north" : "south";
  const ew = set.has("east") ? "east" : "west";
  return `${ns}_${ew}`;
}
function transformProps(t, name, props) {
  if (t.isIdentityLinear) return props;
  const out = {};
  const swapsAxes = t.a === 0;
  for (const [key, value] of Object.entries(props)) {
    const dirKey = DIR_VEC[key] ? mapDir(t, key) : null;
    if (dirKey) {
      out[dirKey] = value;
      continue;
    }
    switch (key) {
      case "facing":
      case "horizontal_facing":
        out[key] = mapDir(t, value);
        break;
      case "axis":
        out[key] = swapsAxes && value !== "y" ? value === "x" ? "z" : "x" : value;
        break;
      case "rotation": {
        const r = Number(value);
        const phi = r * Math.PI / 8;
        const [vx, vz] = t.dir(-Math.sin(phi), Math.cos(phi));
        const r2 = Math.round(Math.atan2(-vx, vz) * 8 / Math.PI);
        out[key] = String((r2 % 16 + 16) % 16);
        break;
      }
      case "shape":
        if (name.includes("rail")) out[key] = mapRailShape(t, value);
        else out[key] = t.mirrored ? SWAP_LR[value] ?? value : value;
        break;
      case "hinge":
        out[key] = t.mirrored ? SWAP_LR[value] ?? value : value;
        break;
      case "type":
        out[key] = name.includes("chest") && t.mirrored ? SWAP_LR[value] ?? value : value;
        break;
      case "orientation":
        out[key] = value.split("_").map((p) => mapDir(t, p)).join("_");
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

// packages/block-compiler/src/palette.ts
var AIR_STATE = "minecraft:air";
var FLAG_CONNECT = 1;
var FLAG_STAIR_SHAPE = 2;
var FLAG_COMPLETE = 4;
var SIDES = ["north", "east", "south", "west"];
function connectsLikeFence(cat, name) {
  const v = cat.propValues(name, "north");
  if (!v) return false;
  return name.endsWith("_fence") || name.endsWith("_wall") || name.endsWith("_pane") || name.endsWith("_bars") || name === "iron_bars" || name === "glass_pane";
}
var InternalPalette = class {
  constructor(catalog) {
    this.catalog = catalog;
  }
  entries = [{ state: AIR_STATE, name: "air", props: {}, flags: 0 }];
  index = /* @__PURE__ */ new Map([[`${AIR_STATE}|0`, 0]]);
  transformed = /* @__PURE__ */ new Map();
  /** Register a normalized state; `explicit` lists properties the author set by hand. */
  add(name, props, explicit) {
    let flags = 0;
    const ex = new Set(explicit);
    if (connectsLikeFence(this.catalog, name) && !SIDES.some((s) => ex.has(s))) {
      flags |= FLAG_CONNECT;
    }
    if (name.endsWith("_stairs") && !ex.has("shape")) flags |= FLAG_STAIR_SHAPE;
    if (props.half === "lower" && "half" in props || props.part === "foot")
      flags |= FLAG_COMPLETE;
    return this.addRaw(name, props, flags);
  }
  addRaw(name, props, flags) {
    if (name === "air") return 0;
    const state = stringifyState(name, props);
    const key = `${state}|${flags}`;
    const existing = this.index.get(key);
    if (existing !== void 0) return existing;
    const id = this.entries.length;
    if (id > 65e3) throw new Error("Too many distinct block states (over 65000).");
    this.entries.push({ state, name, props, flags });
    this.index.set(key, id);
    return id;
  }
  get(id) {
    return this.entries[id];
  }
  /** The id of `id` rotated/mirrored by `t` (cached per transform kind). */
  transform(id, t) {
    if (id === 0 || t.isIdentityLinear) return id;
    const key = id * 8 + t.linearKey;
    const hit = this.transformed.get(key);
    if (hit !== void 0) return hit;
    const e = this.get(id);
    const props = transformProps(t, e.name, e.props);
    const out = this.addRaw(e.name, props, e.flags);
    this.transformed.set(key, out);
    return out;
  }
};

// packages/block-compiler/src/autoStates.ts
var SIDES2 = ["north", "east", "south", "west"];
var OPPOSITE = {
  north: "south",
  south: "north",
  east: "west",
  west: "east"
};
var CW = {
  north: "east",
  east: "south",
  south: "west",
  west: "north"
};
var CCW = {
  north: "west",
  west: "south",
  south: "east",
  east: "north"
};
function completeMultiBlocks(volume, palette) {
  const todo = [];
  volume.forEach((x, y, z3, id, prov) => {
    if (palette.get(id).flags & FLAG_COMPLETE) todo.push([x, y, z3, id, prov]);
  });
  for (const [x, y, z3, id, prov] of todo) {
    const e = palette.get(id);
    const claims = e.name.endsWith("_door") || e.name.endsWith("_bed");
    if (e.props.half === "lower") {
      const above = volume.get(x, y + 1, z3);
      if (above !== 0 && (!claims || palette.get(above).name === e.name)) continue;
      volume.set(x, y + 1, z3, palette.addRaw(e.name, { ...e.props, half: "upper" }, 0), prov);
    } else if (e.props.part === "foot") {
      const v = DIR_VEC[e.props.facing];
      if (!v) continue;
      const head = volume.get(x + v[0], y, z3 + v[1]);
      if (head !== 0 && palette.get(head).name === e.name) continue;
      volume.set(
        x + v[0],
        y,
        z3 + v[1],
        palette.addRaw(e.name, { ...e.props, part: "head" }, 0),
        prov
      );
    }
  }
}
var CONNECT_EXCEPTIONS = /leaves$|^barrier$|pumpkin$|^jack_o_lantern$|^melon$|shulker_box$/;
var WALL_POST_OVERRIDE = /torch$|lantern$|_sign$|banner$|pressure_plate$|^end_rod$|lightning_rod$|_head$|_skull$|candle$/;
function kindOf(name) {
  if (name.endsWith("_fence_gate")) return "gate";
  if (name === "nether_brick_fence") return "nether_fence";
  if (name.endsWith("_fence")) return "fence";
  if (name.endsWith("_wall")) return "wall";
  if (name.endsWith("_pane") || name.endsWith("_bars") || name === "iron_bars") return "pane";
  return "other";
}
function applyAutoStates(vol, entries, catalog) {
  const { sizeX, sizeY, sizeZ } = vol;
  const original = vol.data.slice();
  const entryAt = (x, y, z3) => {
    if (x < 0 || y < 0 || z3 < 0 || x >= sizeX || y >= sizeY || z3 >= sizeZ) return null;
    const id = original[x + sizeX * (z3 + sizeZ * y)];
    return id === 0 ? null : entries[id] ?? null;
  };
  const kinds = entries.map((e) => kindOf(e.name));
  const full = entries.map((e) => catalog.isFullCube(e.name) && !CONNECT_EXCEPTIONS.test(e.name));
  const kindAt = (x, y, z3) => {
    if (x < 0 || y < 0 || z3 < 0 || x >= sizeX || y >= sizeY || z3 >= sizeZ) return null;
    const id = original[x + sizeX * (z3 + sizeZ * y)];
    return id === 0 ? null : kinds[id] ?? null;
  };
  const fullAt = (x, y, z3) => {
    if (x < 0 || y < 0 || z3 < 0 || x >= sizeX || y >= sizeY || z3 >= sizeZ) return false;
    return full[original[x + sizeX * (z3 + sizeZ * y)]] ?? false;
  };
  const gateConnects = (gate, toward) => {
    const f = gate.props.facing;
    if (!f) return false;
    return toward === CW[f] || toward === CCW[f];
  };
  const cache = /* @__PURE__ */ new Map();
  const write = (i2, e, props) => {
    const state = stringifyState(e.name, props);
    if (state === e.state) return;
    let id = cache.get(state);
    if (id === void 0) {
      id = vol.idFor(state);
      cache.set(state, id);
    }
    vol.data[i2] = id;
  };
  let i = 0;
  for (let y = 0; y < sizeY; y++) {
    for (let z3 = 0; z3 < sizeZ; z3++) {
      for (let x = 0; x < sizeX; x++, i++) {
        const id = original[i];
        if (id === 0) continue;
        const e = entries[id];
        const kind = kinds[id];
        if (e.flags & FLAG_CONNECT) {
          const props = { ...e.props };
          const conn = {
            north: false,
            east: false,
            south: false,
            west: false
          };
          for (const side of SIDES2) {
            const [dx, dz] = DIR_VEC[side];
            const nk = kindAt(x + dx, y, z3 + dz);
            const ne = entryAt(x + dx, y, z3 + dz);
            let c = false;
            if (nk && ne) {
              if (kind === "fence" || kind === "nether_fence") {
                c = nk === kind || nk === "gate" && gateConnects(ne, OPPOSITE[side]) || fullAt(x + dx, y, z3 + dz);
              } else if (kind === "wall") {
                c = nk === "wall" || nk === "pane" || nk === "gate" && gateConnects(ne, OPPOSITE[side]) || fullAt(x + dx, y, z3 + dz);
              } else if (kind === "pane") {
                c = nk === "pane" || nk === "wall" || fullAt(x + dx, y, z3 + dz);
              }
            }
            conn[side] = c;
          }
          if (kind === "wall") {
            const above = entryAt(x, y + 1, z3);
            const aboveFull = fullAt(x, y + 1, z3) || kindAt(x, y + 1, z3) === "wall";
            const enumSides = (catalog.propValues(e.name, "north") ?? []).includes("low");
            for (const side of SIDES2) {
              props[side] = enumSides ? conn[side] ? aboveFull ? "tall" : "low" : "none" : String(conn[side]);
            }
            const straight = conn.north && conn.south && !conn.east && !conn.west || conn.east && conn.west && !conn.north && !conn.south;
            const forced = above ? WALL_POST_OVERRIDE.test(above.name) || kindAt(x, y + 1, z3) === "wall" && above.props.up === "true" : false;
            if ("up" in props) props.up = String(!straight || forced);
          } else {
            for (const side of SIDES2) props[side] = String(conn[side]);
          }
          write(i, e, props);
          continue;
        }
        if (kind === "gate" && "in_wall" in e.props) {
          const f = e.props.facing;
          const [ax, az] = DIR_VEC[CW[f] ?? "east"];
          const inWall = kindAt(x + ax, y, z3 + az) === "wall" || kindAt(x - ax, y, z3 - az) === "wall";
          write(i, e, { ...e.props, in_wall: String(inWall) });
          continue;
        }
        if (e.flags & FLAG_STAIR_SHAPE) {
          const shape = stairShape(e, x, y, z3, entryAt);
          write(i, e, { ...e.props, shape });
          continue;
        }
        if ("snowy" in e.props) {
          const above = entryAt(x, y + 1, z3);
          const snowy = !!above && (above.name === "snow" || above.name === "snow_block" || above.name === "powder_snow");
          write(i, e, { ...e.props, snowy: String(snowy) });
        }
      }
    }
  }
}
function isStairs(e) {
  return !!e && e.name.endsWith("_stairs");
}
function stairShape(e, x, y, z3, entryAt) {
  const facing = e.props.facing;
  const half = e.props.half;
  const rel = (d) => {
    const [dx, dz] = DIR_VEC[d];
    return entryAt(x + dx, y, z3 + dz);
  };
  const axisOf = (d) => d === "east" || d === "west" ? "x" : "z";
  const canTakeShape = (face) => {
    const n = rel(face);
    return !isStairs(n) || n.props.facing !== facing || n.props.half !== half;
  };
  const behind = rel(facing);
  if (isStairs(behind) && behind.props.half === half) {
    const d1 = behind.props.facing;
    if (axisOf(d1) !== axisOf(facing) && canTakeShape(OPPOSITE[d1])) {
      return d1 === CCW[facing] ? "outer_left" : "outer_right";
    }
  }
  const front = rel(OPPOSITE[facing]);
  if (isStairs(front) && front.props.half === half) {
    const d2 = front.props.facing;
    if (axisOf(d2) !== axisOf(facing) && canTakeShape(d2)) {
      return d2 === CCW[facing] ? "inner_left" : "inner_right";
    }
  }
  return "straight";
}

// packages/block-compiler/src/noise.ts
function hash3(x, y, z3, seed) {
  let h = (seed | 0) ^ 2654435769;
  h = Math.imul(h ^ (x | 0), 2246822507);
  h = Math.imul(h ^ (y | 0), 3266489909);
  h = Math.imul(h ^ (z3 | 0), 668265263);
  h ^= h >>> 15;
  h = Math.imul(h, 739982445);
  h ^= h >>> 12;
  h = Math.imul(h, 695872825);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function makeRng(seed) {
  let a = seed >>> 0 || 1831565813;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var GRAD3 = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1]
];
var Perlin = class {
  perm = new Uint8Array(512);
  constructor(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    const rnd = makeRng(seed);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  noise(x, y, z3) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z3) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z3 -= Math.floor(z3);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z3);
    const P = this.perm;
    const A = P[X] + Y;
    const AA = P[A] + Z;
    const AB = P[A + 1] + Z;
    const B = P[X + 1] + Y;
    const BA = P[B] + Z;
    const BB = P[B + 1] + Z;
    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad(P[AA], x, y, z3), grad(P[BA], x - 1, y, z3)),
        lerp(u, grad(P[AB], x, y - 1, z3), grad(P[BB], x - 1, y - 1, z3))
      ),
      lerp(
        v,
        lerp(
          u,
          grad(P[AA + 1], x, y, z3 - 1),
          grad(P[BA + 1], x - 1, y, z3 - 1)
        ),
        lerp(
          u,
          grad(P[AB + 1], x, y - 1, z3 - 1),
          grad(P[BB + 1], x - 1, y - 1, z3 - 1)
        )
      )
    ) * 1.1;
  }
  /** Fractal sum of octaves, roughly in [-1, 1]. */
  fbm(x, y, z3, octaves = 4) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq, z3 * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
};
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(t, a, b) {
  return a + t * (b - a);
}
function grad(hash, x, y, z3) {
  const g = GRAD3[hash % 12];
  return g[0] * x + g[1] * y + g[2] * z3;
}
var UniformNoise = class {
  perlin;
  cdf;
  constructor(seed) {
    this.perlin = new Perlin(seed);
    const samples = new Float32Array(4096);
    const rnd = makeRng(seed ^ 5369127);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = this.perlin.fbm(rnd() * 256, rnd() * 256, rnd() * 256, 3);
    }
    samples.sort();
    this.cdf = samples;
  }
  at(x, y, z3, scale) {
    const v = this.perlin.fbm(x / scale, y / scale, z3 / scale, 3);
    let lo = 0;
    let hi = this.cdf.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (this.cdf[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(0.999999, lo / this.cdf.length);
  }
};

// packages/block-compiler/src/resolver.ts
var SKIP = { id: -2 };
var REF_RE = /^\s*([^[\]]+?)\s*(?:\[([^\]]*)\])?\s*$/;
function splitRef(ref) {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const props = {};
  for (const pair of (m[2] ?? "").split(",")) {
    const p = pair.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq <= 0) return null;
    props[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim().toLowerCase();
  }
  return { key: m[1].trim(), props };
}
function propsString(props) {
  const keys = Object.keys(props);
  if (keys.length === 0) return "";
  return `[${keys.map((k) => `${k}=${props[k]}`).join(",")}]`;
}
var BlockResolver = class {
  constructor(catalog, palette, specPalette, seed) {
    this.catalog = catalog;
    this.palette = palette;
    this.specPalette = specPalette;
    this.seed = seed;
  }
  cache = /* @__PURE__ */ new Map();
  noise = /* @__PURE__ */ new Map();
  errors = [];
  notes = /* @__PURE__ */ new Set();
  source(ref, where, soft) {
    const key = soft ? `${ref}|${JSON.stringify(soft)}` : ref;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const src = this.resolve(ref, {}, soft ?? {}, where, 0);
    this.cache.set(key, src);
    return src;
  }
  /** Every concrete block name a reference can produce (for masks and replace targets). */
  namesOf(ref, where, depth = 0) {
    const parts = splitRef(ref);
    if (!parts) {
      this.fail(where, `"${ref}" is not a valid block reference.`);
      return { names: [], states: [] };
    }
    const entry = this.lookup(parts.key);
    if (entry !== void 0 && depth < 8) {
      const refs = typeof entry === "string" ? [entry] : "mix" in entry ? Object.keys(entry.mix) : entry.gradient.blocks;
      const out = { names: [], states: [] };
      for (const r2 of refs) {
        const sub = this.namesOf(r2, where, depth + 1);
        out.names.push(...sub.names);
        out.states.push(...sub.states);
      }
      return out;
    }
    const name = parts.key.replace(/^minecraft:/, "").toLowerCase();
    const resolved2 = this.catalog.resolveName(name);
    if (!resolved2) {
      const r2 = this.catalog.normalize(name);
      this.fail(where, r2.ok ? `Unknown block "${name}".` : r2.error);
      return { names: [], states: [] };
    }
    if (Object.keys(parts.props).length === 0) return { names: [resolved2], states: [] };
    const r = this.catalog.normalize(`${resolved2}${propsString(parts.props)}`);
    if (!r.ok) {
      this.fail(where, r.error);
      return { names: [], states: [] };
    }
    return { names: [], states: [r.state] };
  }
  /** Palette entry for a key; "minecraft:…" always means the block itself. */
  lookup(key) {
    if (key.includes(":")) return void 0;
    return this.specPalette[key] ?? this.specPalette[key.toLowerCase()];
  }
  fail(where, message) {
    const line2 = where ? `${where}: ${message}` : message;
    if (!this.errors.includes(line2)) this.errors.push(line2);
  }
  noiseFor(seed) {
    let n = this.noise.get(seed);
    if (!n) {
      n = new UniformNoise(seed);
      this.noise.set(seed, n);
    }
    return n;
  }
  resolve(ref, strict, soft, where, depth) {
    if (depth > 8) {
      this.fail(where, `palette reference "${ref}" is circular or too deeply nested.`);
      return SKIP;
    }
    const parts = splitRef(ref);
    if (!parts) {
      this.fail(
        where,
        `"${ref}" is not a valid block reference (expected name or name[prop=value]).`
      );
      return SKIP;
    }
    const merged = { ...parts.props, ...strict };
    const entry = this.lookup(parts.key);
    if (entry !== void 0) {
      const ctx = `${where}${where ? " " : ""}(palette "${parts.key}")`;
      if (typeof entry === "string") return this.resolve(entry, merged, soft, ctx, depth + 1);
      if ("mix" in entry) return this.mix(parts.key, entry, merged, soft, ctx, depth);
      return this.gradient(parts.key, entry, merged, soft, ctx, depth);
    }
    return this.block(parts.key, merged, soft, where);
  }
  block(rawName, strict, soft, where) {
    const name = rawName.replace(/^minecraft:/, "").toLowerCase();
    if (name === "air" || name === "cave_air" || name === "void_air") return { id: 0 };
    const resolvedName = this.catalog.resolveName(name) ?? name;
    const props = { ...strict };
    for (const [k, v] of Object.entries(soft)) {
      if (k in props) continue;
      if (this.catalog.propValues(resolvedName, k)?.includes(v)) props[k] = v;
    }
    if (resolvedName.endsWith("_leaves") && !("persistent" in props)) {
      if (this.catalog.propValues(resolvedName, "persistent")) props.persistent = "true";
    }
    const r = this.catalog.normalize(`${name}${propsString(props)}`);
    if (!r.ok) {
      this.fail(where, r.error);
      return SKIP;
    }
    if (r.renamedFrom) {
      this.notes.add(
        `"${r.renamedFrom}" is called "${r.name}" in ${this.catalog.version.id}; used that.`
      );
    }
    const id = this.palette.add(r.name, r.props, Object.keys(strict));
    return { id };
  }
  mix(key, entry, strict, soft, where, depth) {
    const members = Object.entries(entry.mix).map(([r, w]) => ({
      src: this.resolve(r, strict, soft, where, depth + 1),
      w
    }));
    const total = members.reduce((s, m) => s + m.w, 0);
    const cumulative = [];
    let acc = 0;
    for (const m of members) {
      acc += m.w / total;
      cumulative.push(acc);
    }
    const sources = members.map((m) => m.src);
    const seed = (entry.seed ?? this.seed) ^ hashString(key);
    const scale = entry.scale ?? 1;
    const noise = scale > 1 ? this.noiseFor(seed) : null;
    return {
      id: -1,
      pick: (x, y, z3) => {
        const t = noise ? noise.at(x, y, z3, scale) : hash3(x, y, z3, seed);
        let i = 0;
        while (i < cumulative.length - 1 && t >= cumulative[i]) i++;
        const s = sources[i];
        return s.id >= 0 ? s.id : s.id === -1 ? s.pick(x, y, z3) : -2;
      }
    };
  }
  gradient(key, entry, strict, soft, where, depth) {
    const g = entry.gradient;
    const sources = g.blocks.map((r) => this.resolve(r, strict, soft, where, depth + 1));
    const n = sources.length;
    const span = g.to - g.from || 1;
    const jitter = g.jitter ?? 0.35;
    const seed = this.seed ^ hashString(key);
    return {
      id: -1,
      pick: (x, y, z3) => {
        const c = g.axis === "x" ? x : g.axis === "y" ? y : z3;
        let t = (c - g.from) / span;
        if (jitter > 0) t += (hash3(x, y, z3, seed) - 0.5) * 2 * jitter / n;
        const i = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
        const s = sources[i];
        return s.id >= 0 ? s.id : s.id === -1 ? s.pick(x, y, z3) : -2;
      }
    };
  }
};

// packages/block-compiler/src/SparseVolume.ts
var CHUNK_BITS = 4;
var CHUNK = 1 << CHUNK_BITS;
var MASK = CHUNK - 1;
var OFFSET = 2048;
var COORD_LIMIT = 3e4;
var MAX_CHUNKS = 25e3;
var CompileLimitError = class extends Error {
};
function chunkKey(cx, cy, cz) {
  return ((cx + OFFSET) * 4096 + (cy + OFFSET)) * 4096 + (cz + OFFSET);
}
var SparseVolume = class {
  chunks = /* @__PURE__ */ new Map();
  writes = 0;
  last = null;
  lastKey = -1;
  chunkAt(x, y, z3, create) {
    const cx = x >> CHUNK_BITS;
    const cy = y >> CHUNK_BITS;
    const cz = z3 >> CHUNK_BITS;
    const key = chunkKey(cx, cy, cz);
    if (key === this.lastKey) return this.last;
    let chunk = this.chunks.get(key) ?? null;
    if (!chunk && create) {
      if (this.chunks.size >= MAX_CHUNKS) {
        throw new CompileLimitError(
          `The build is too large (over ${MAX_CHUNKS} chunks of 16\xB3 \u2248 100 million blocks of space). Check coordinates for a typo, or split it into several builds.`
        );
      }
      chunk = {
        cx,
        cy,
        cz,
        ids: new Uint16Array(CHUNK * CHUNK * CHUNK),
        prov: new Uint16Array(CHUNK * CHUNK * CHUNK)
      };
      this.chunks.set(key, chunk);
    }
    if (chunk) {
      this.last = chunk;
      this.lastKey = key;
    }
    return chunk;
  }
  static inRange(x, y, z3) {
    return x > -COORD_LIMIT && x < COORD_LIMIT && y > -COORD_LIMIT && y < COORD_LIMIT && z3 > -COORD_LIMIT && z3 < COORD_LIMIT;
  }
  get(x, y, z3) {
    const c = this.chunkAt(x, y, z3, false);
    if (!c) return 0;
    return c.ids[(y & MASK) << 8 | (z3 & MASK) << 4 | x & MASK];
  }
  set(x, y, z3, id, prov) {
    const c = this.chunkAt(x, y, z3, id !== 0);
    if (!c) return;
    const i = (y & MASK) << 8 | (z3 & MASK) << 4 | x & MASK;
    c.ids[i] = id;
    c.prov[i] = prov;
    this.writes++;
  }
  /** Visit every non-air cell. */
  forEach(cb) {
    for (const c of this.chunks.values()) {
      const bx = c.cx << CHUNK_BITS;
      const by = c.cy << CHUNK_BITS;
      const bz = c.cz << CHUNK_BITS;
      for (let i = 0; i < c.ids.length; i++) {
        const id = c.ids[i];
        if (id === 0) continue;
        cb(bx + (i & MASK), by + (i >> 8), bz + (i >> 4 & MASK), id, c.prov[i]);
      }
    }
  }
  /** Bounds of non-air cells, or null when empty. */
  bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const c of this.chunks.values()) {
      const bx = c.cx << CHUNK_BITS;
      const by = c.cy << CHUNK_BITS;
      const bz = c.cz << CHUNK_BITS;
      if (bx >= minX && bx + MASK <= maxX && by >= minY && by + MASK <= maxY && bz >= minZ && bz + MASK <= maxZ) {
        continue;
      }
      for (let i = 0; i < c.ids.length; i++) {
        if (c.ids[i] === 0) continue;
        const x = bx + (i & MASK);
        const y = by + (i >> 8);
        const z3 = bz + (i >> 4 & MASK);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z3 < minZ) minZ = z3;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z3 > maxZ) maxZ = z3;
      }
    }
    if (minX === Infinity) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }
};

// packages/block-compiler/src/context.ts
var CompileContext = class {
  constructor(spec, catalog, volume, palette, resolver, scriptRunner, paletteDefs, components) {
    this.spec = spec;
    this.catalog = catalog;
    this.volume = volume;
    this.palette = palette;
    this.resolver = resolver;
    this.scriptRunner = scriptRunner;
    this.paletteDefs = paletteDefs;
    this.components = components;
    this.seed = spec.seed ?? hashString(spec.name) % 1e5;
  }
  transform = Transform.IDENTITY;
  mask = null;
  prov = 0;
  where = "";
  provTable = [""];
  warnings = /* @__PURE__ */ new Set();
  blockEntities = /* @__PURE__ */ new Map();
  seed;
  outOfRange = 0;
  error(message) {
    this.resolver.errors.push(this.where ? `${this.where}: ${message}` : message);
  }
  warn(message) {
    this.warnings.add(this.where ? `${this.where}: ${message}` : message);
  }
  source(ref, soft) {
    if (!ref) return SKIP;
    return this.resolver.source(ref, this.where, soft);
  }
  /** Make a provenance entry for the current operation path. */
  enterProv(label) {
    if (this.provTable.length >= 65535) return 65535;
    this.provTable.push(label);
    this.prov = this.provTable.length - 1;
    return this.prov;
  }
  toWorld(x, y, z3) {
    const t = this.transform;
    return [t.a * x + t.b * z3 + t.tx, y + t.ty, t.c * x + t.d * z3 + t.tz];
  }
  /** Read the block id at a local position. */
  get(x, y, z3) {
    const t = this.transform;
    return this.volume.get(t.a * x + t.b * z3 + t.tx, y + t.ty, t.c * x + t.d * z3 + t.tz);
  }
  put(x, y, z3, src) {
    const t = this.transform;
    const wx = t.a * x + t.b * z3 + t.tx;
    const wy = y + t.ty;
    const wz = t.c * x + t.d * z3 + t.tz;
    const id = src.id >= 0 ? src.id : src.id === -1 ? src.pick(wx, wy, wz) : -2;
    if (id < 0) return;
    this.putWorld(wx, wy, wz, id === 0 ? 0 : this.palette.transform(id, t));
  }
  /** Write an already-transformed palette id at a world position (honours the mask). */
  putWorld(wx, wy, wz, id) {
    if (!SparseVolume.inRange(wx, wy, wz)) {
      this.outOfRange++;
      return;
    }
    const mask2 = this.mask;
    if (mask2) {
      const existing = this.volume.get(wx, wy, wz);
      if (mask2.kind === "air") {
        if (existing !== 0) return;
      } else if (mask2.kind === "solid") {
        if (existing === 0) return;
      } else {
        if (existing === 0) return;
        const e = this.palette.get(existing);
        if (!mask2.names?.has(e.name) && !mask2.states?.has(e.state)) return;
      }
    }
    this.volume.set(wx, wy, wz, id, this.prov);
  }
  /** Run fn with an extra local transform (child -> current). */
  withTransform(local, fn) {
    const prev = this.transform;
    this.transform = prev.compose(local);
    try {
      fn();
    } finally {
      this.transform = prev;
    }
  }
  get outOfRangeWrites() {
    return this.outOfRange;
  }
  parseMask(mask2) {
    if (!mask2) return null;
    if (mask2 === "air" || mask2 === "solid") return { kind: mask2 };
    const names = /* @__PURE__ */ new Set();
    const states = /* @__PURE__ */ new Set();
    for (const ref of mask2) {
      const r = this.resolver.namesOf(ref, this.where);
      r.names.forEach((n) => names.add(n));
      r.states.forEach((s) => states.add(s));
    }
    return { kind: "list", names, states };
  }
};

// packages/block-compiler/src/ops/shapes.ts
function box(ctx, op) {
  const src = ctx.source(op.block);
  const inner = op.inner !== void 0 ? ctx.source(op.inner) : null;
  const t = op.thickness ?? 1;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const shell = op.hollow || op.walls;
  for (let y = y0; y <= y1; y++) {
    const capY = op.hollow && (y < y0 + t || y > y1 - t);
    for (let z3 = z0; z3 <= z1; z3++) {
      for (let x = x0; x <= x1; x++) {
        if (!shell) {
          ctx.put(x, y, z3, src);
          continue;
        }
        const side = x < x0 + t || x > x1 - t || z3 < z0 + t || z3 > z1 - t;
        if (side || capY) ctx.put(x, y, z3, src);
        else if (inner) ctx.put(x, y, z3, inner);
      }
    }
  }
}
function bresenham3(a, b, visit) {
  let [x, y, z3] = a;
  const [x1, y1, z1] = b;
  const dx = Math.abs(x1 - x);
  const dy = Math.abs(y1 - y);
  const dz = Math.abs(z1 - z3);
  const sx = x1 > x ? 1 : -1;
  const sy = y1 > y ? 1 : -1;
  const sz = z1 > z3 ? 1 : -1;
  const n = Math.max(dx, dy, dz);
  let ex = n / 2;
  let ey = n / 2;
  let ez = n / 2;
  for (let i = 0; i <= n; i++) {
    visit(x, y, z3);
    ex -= dx;
    ey -= dy;
    ez -= dz;
    if (ex < 0) {
      x += sx;
      ex += n;
    }
    if (ey < 0) {
      y += sy;
      ey += n;
    }
    if (ez < 0) {
      z3 += sz;
      ez += n;
    }
  }
}
function stampBall(ctx, cx, cy, cz, r, src) {
  if (r <= 0) {
    ctx.put(cx, cy, cz, src);
    return;
  }
  const reach = Math.ceil(r);
  const lim = (r + 0.5) * (r + 0.5);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy + dz * dz < lim) ctx.put(cx + dx, cy + dy, cz + dz, src);
      }
    }
  }
}
function line(ctx, op) {
  const pts = op.points ?? (op.from && op.to ? [op.from, op.to] : null);
  if (!pts) {
    ctx.error('line needs "from" and "to", or "points".');
    return;
  }
  const src = ctx.source(op.block);
  const r = op.radius ?? 0;
  for (let i = 0; i < pts.length - 1; i++) {
    bresenham3(
      pts[i],
      pts[i + 1],
      (x, y, z3) => stampBall(ctx, x, y, z3, r, src)
    );
  }
}
function axisIndices(axis2) {
  if (axis2 === "x") return [0, 1, 2];
  if (axis2 === "z") return [2, 0, 1];
  return [1, 0, 2];
}
function cylinderLike(ctx, center, axis2, height, radiusAt, src, hollow, thickness) {
  const [ia, iu, iv] = axisIndices(axis2);
  const ca = Math.floor(center[ia]);
  const cu = center[iu];
  const cv = center[iv];
  const p = [0, 0, 0];
  for (let h = 0; h < height; h++) {
    const [ru, rv] = radiusAt(h);
    const inside = (u, v, du, dv) => {
      if (du < 0 || dv < 0) return false;
      const a = (u - cu) / (du + 0.5);
      const b = (v - cv) / (dv + 0.5);
      return a * a + b * b < 1;
    };
    const u0 = Math.floor(cu - ru - 1);
    const u1 = Math.ceil(cu + ru + 1);
    const v0 = Math.floor(cv - rv - 1);
    const v1 = Math.ceil(cv + rv + 1);
    p[ia] = ca + h;
    for (let v = v0; v <= v1; v++) {
      for (let u = u0; u <= u1; u++) {
        if (!inside(u, v, ru, rv)) continue;
        if (hollow) {
          const edge = thickness <= 1 ? !inside(u + 1, v, ru, rv) || !inside(u - 1, v, ru, rv) || !inside(u, v + 1, ru, rv) || !inside(u, v - 1, ru, rv) : !inside(u, v, ru - thickness, rv - thickness);
          if (!edge) continue;
        }
        p[iu] = u;
        p[iv] = v;
        ctx.put(p[0], p[1], p[2], src);
      }
    }
  }
}
function cylinder(ctx, op) {
  const src = ctx.source(op.block);
  const r2 = op.radius2 ?? op.radius;
  const top = op.radiusTop;
  const n = op.height;
  cylinderLike(
    ctx,
    op.center,
    op.axis ?? "y",
    n,
    (h) => {
      if (top === void 0) return [op.radius, r2];
      const t = n <= 1 ? 0 : h / (n - 1);
      const k = (op.radius + (top - op.radius) * t) / op.radius;
      return [op.radius * k, r2 * k];
    },
    src,
    op.hollow ?? false,
    op.thickness ?? 1
  );
}
function cone(ctx, op) {
  const src = ctx.source(op.block);
  const n = op.height;
  cylinderLike(
    ctx,
    op.center,
    op.axis ?? "y",
    n,
    (h) => {
      const r = op.radius * (n - 1 - h) / Math.max(1, n - 1);
      return [r, r];
    },
    src,
    op.hollow ?? false,
    1
  );
}
function ellipsoid(ctx, center, radii, src, hollow, thickness, half) {
  const [rx, ry, rz] = radii;
  const [cx, cy, cz] = center;
  const inside = (x, y, z3, sx, sy, sz) => {
    if (sx < 0 || sy < 0 || sz < 0) return false;
    const a = (x - cx) / (sx + 0.5);
    const b = (y - cy) / (sy + 0.5);
    const c = (z3 - cz) / (sz + 0.5);
    return a * a + b * b + c * c < 1;
  };
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    if (half === "top" && y < cy) continue;
    if (half === "bottom" && y > cy) continue;
    for (let z3 = Math.floor(cz - rz - 1); z3 <= Math.ceil(cz + rz + 1); z3++) {
      if (half === "north" && z3 > cz) continue;
      if (half === "south" && z3 < cz) continue;
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (half === "west" && x > cx) continue;
        if (half === "east" && x < cx) continue;
        if (!inside(x, y, z3, rx, ry, rz)) continue;
        if (hollow) {
          const edge = thickness <= 1 ? !inside(x + 1, y, z3, rx, ry, rz) || !inside(x - 1, y, z3, rx, ry, rz) || !inside(x, y + 1, z3, rx, ry, rz) || !inside(x, y - 1, z3, rx, ry, rz) || !inside(x, y, z3 + 1, rx, ry, rz) || !inside(x, y, z3 - 1, rx, ry, rz) : !inside(x, y, z3, rx - thickness, ry - thickness, rz - thickness);
          if (!edge) continue;
        }
        ctx.put(x, y, z3, src);
      }
    }
  }
}
function sphere(ctx, op) {
  const radii = op.radii ?? (op.radius ? [op.radius, op.radius, op.radius] : null);
  if (!radii) {
    ctx.error('sphere needs "radius" or "radii".');
    return;
  }
  ellipsoid(
    ctx,
    op.center,
    radii,
    ctx.source(op.block),
    op.hollow ?? false,
    op.thickness ?? 1,
    op.half
  );
}
function dome(ctx, op) {
  const h = op.height ?? op.radius;
  ellipsoid(
    ctx,
    op.center,
    [op.radius, h, op.radius],
    ctx.source(op.block),
    op.hollow ?? false,
    op.thickness ?? 1,
    "top"
  );
}
function pointInPolygon(px, pz, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > pz !== zj > pz && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToSegment(px, pz, a, b) {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / len2));
  const dx = px - (a[0] + t * vx);
  const dz = pz - (a[1] + t * vz);
  return Math.sqrt(dx * dx + dz * dz);
}
function polygon(ctx, op) {
  const src = ctx.source(op.block);
  const pts = op.points;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const cells = /* @__PURE__ */ new Set();
  const W = maxX - minX + 1;
  const mark = (x, z3) => {
    cells.add((z3 - minZ) * W + (x - minX));
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    bresenham3([a[0], 0, a[1]], [b[0], 0, b[1]], (x, _y, z3) => mark(x, z3));
  }
  const t = op.thickness ?? 1;
  for (let z3 = minZ; z3 <= maxZ; z3++) {
    for (let x = minX; x <= maxX; x++) {
      if (!pointInPolygon(x, z3, pts)) continue;
      if (op.hollow && t > 1) {
        let d = Infinity;
        for (let i = 0; i < pts.length; i++) {
          d = Math.min(
            d,
            distToSegment(
              x,
              z3,
              pts[i],
              pts[(i + 1) % pts.length]
            )
          );
        }
        if (d < t - 0.5) mark(x, z3);
      } else if (!op.hollow) {
        mark(x, z3);
      }
    }
  }
  for (const key of cells) {
    const x = key % W + minX;
    const z3 = Math.floor(key / W) + minZ;
    for (let y = op.y; y < op.y + op.height; y++) ctx.put(x, y, z3, src);
  }
}

// packages/block-compiler/src/ops/family.ts
var REF_RE2 = /^\s*([^[\]]+?)\s*(?:\[[^\]]*\])?\s*$/;
function fullCandidates(base) {
  return [
    base,
    `${base}s`,
    // stone_brick -> stone_bricks, deepslate_tile -> deepslate_tiles
    `${base}_planks`,
    // oak -> oak_planks
    `${base}_block`,
    // quartz -> quartz_block, purpur -> purpur_block
    base.replace(/_brick$/, "_bricks")
  ];
}
function deriveName(ctx, name, kind) {
  const cat = ctx.catalog;
  const base = name.replace(/_(stairs|slab)$/, "");
  if (kind === "slab") {
    const cands = [`${base}_slab`, `${base.replace(/s$/, "")}_slab`];
    return cands.find((c) => cat.has(c));
  }
  if (kind === "stairs") {
    const cands = [
      `${base}_stairs`,
      `${base.replace(/s$/, "")}_stairs`,
      `${base.replace(/_planks$/, "")}_stairs`
    ];
    return cands.find((c) => cat.has(c));
  }
  if (base === name) return cat.has(name) ? name : void 0;
  return fullCandidates(base).find((c) => cat.has(c));
}
function deriveFamily(ctx, ref, kind, depth = 0) {
  const m = REF_RE2.exec(ref);
  if (!m || depth > 8) return void 0;
  const key = m[1].trim();
  const entry = ctx.paletteDefs[key];
  if (entry === void 0) {
    const name = key.replace(/^minecraft:/, "").toLowerCase();
    return deriveName(ctx, ctx.catalog.resolveName(name) ?? name, kind);
  }
  if (typeof entry === "string") return deriveFamily(ctx, entry, kind, depth + 1);
  const synthetic = `${key}~${kind}`;
  if (ctx.paletteDefs[synthetic]) return synthetic;
  if ("mix" in entry) {
    const mix = {};
    for (const [r, w] of Object.entries(entry.mix)) {
      const d = deriveFamily(ctx, r, kind, depth + 1);
      if (!d) return void 0;
      mix[d] = (mix[d] ?? 0) + w;
    }
    ctx.paletteDefs[synthetic] = {
      mix,
      ...entry.scale ? { scale: entry.scale } : {},
      ...entry.seed !== void 0 ? { seed: entry.seed } : {}
    };
    return synthetic;
  }
  const blocks2 = [];
  for (const r of entry.gradient.blocks) {
    const d = deriveFamily(ctx, r, kind, depth + 1);
    if (!d) return void 0;
    blocks2.push(d);
  }
  ctx.paletteDefs[synthetic] = { gradient: { ...entry.gradient, blocks: blocks2 } };
  return synthetic;
}

// packages/block-compiler/src/ops/roof.ts
var EPS = 1e-6;
function roof(ctx, op) {
  const shape = op.shape;
  const overhang = op.overhang ?? (shape === "flat" ? 0 : 1);
  if (shape === "cone") {
    coneRoof(ctx, op, overhang);
    return;
  }
  if (!op.from || !op.to) {
    ctx.error(`roof "${shape}" needs "from" and "to" (the wall footprint).`);
    return;
  }
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const y = op.from[1];
  const X0 = x0 - overhang;
  const X1 = x1 + overhang;
  const Z0 = z0 - overhang;
  const Z1 = z1 + overhang;
  if (shape === "flat") {
    const src = ctx.source(op.block, { type: "bottom" });
    for (let z3 = Z0; z3 <= Z1; z3++) for (let x = X0; x <= X1; x++) ctx.put(x, y, z3, src);
    if (op.eaves) {
      const trim = ctx.source(op.eaves);
      for (let z3 = Z0; z3 <= Z1; z3++) {
        for (let x = X0; x <= X1; x++) {
          if (x === X0 || x === X1 || z3 === Z0 || z3 === Z1) ctx.put(x, y + 1, z3, trim);
        }
      }
    }
    return;
  }
  const axis2 = op.axis ?? (x1 - x0 >= z1 - z0 ? "x" : "z");
  const columns = [];
  for (let z3 = Z0; z3 <= Z1; z3++) {
    for (let x = X0; x <= X1; x++) {
      const dx0 = x - X0;
      const dx1 = X1 - x;
      const dz0 = z3 - Z0;
      const dz1 = Z1 - z3;
      let d;
      let facing;
      if (shape === "gable") {
        if (axis2 === "x") {
          d = Math.min(dz0, dz1);
          facing = dz0 < dz1 ? "south" : dz0 > dz1 ? "north" : null;
        } else {
          d = Math.min(dx0, dx1);
          facing = dx0 < dx1 ? "east" : dx0 > dx1 ? "west" : null;
        }
      } else if (shape === "hip") {
        d = Math.min(dx0, dx1, dz0, dz1);
        if (d === dz0 && d !== dz1) facing = "south";
        else if (d === dz1 && d !== dz0) facing = "north";
        else if (d === dx0 && d !== dx1) facing = "east";
        else if (d === dx1 && d !== dx0) facing = "west";
        else facing = null;
      } else {
        const rise = op.rise ?? "north";
        d = rise === "north" ? dz1 : rise === "south" ? dz0 : rise === "west" ? dx1 : dx0;
        facing = rise;
      }
      columns.push({ x, z: z3, d, facing });
    }
  }
  const ridgeAxis = shape === "hip" ? x1 - x0 >= z1 - z0 ? "x" : "z" : shape === "gable" ? axis2 : op.rise === "east" || op.rise === "west" ? "z" : "x";
  buildSurface(ctx, op, columns, y, overhang, ridgeAxis);
  if (op.gable && (shape === "gable" || shape === "shed")) {
    const gable = ctx.source(op.gable);
    const along = shape === "gable" ? axis2 : op.rise === "east" || op.rise === "west" ? "z" : "x";
    const ends = along === "x" ? [x0, x1] : [z0, z1];
    const bottoms = surfaceBottoms(columns, op, y, overhang);
    for (const c of columns) {
      const atEnd = along === "x" ? ends.includes(c.x) : ends.includes(c.z);
      const inside = along === "x" ? c.z >= z0 && c.z <= z1 : c.x >= x0 && c.x <= x1;
      if (!atEnd || !inside) continue;
      const bottom = bottoms.get(`${c.x},${c.z}`) ?? y;
      for (let yy = y; yy < bottom; yy++) ctx.put(c.x, yy, c.z, gable);
    }
  }
}
function rowHeights(op, maxD) {
  const profile = op.profile ?? [op.pitch ?? 1];
  const t = [];
  let acc = 0;
  for (let d = 0; d <= maxD + 1; d++) {
    acc += profile[Math.min(d, profile.length - 1)];
    t.push(acc);
  }
  return t;
}
function surfaceBottoms(columns, op, y, overhang) {
  const maxD = columns.reduce((m, c) => Math.max(m, c.d), 0);
  const t = rowHeights(op, maxD);
  const yb = y - Math.ceil((t[overhang] ?? 1) - EPS) + 1;
  const out = /* @__PURE__ */ new Map();
  for (const c of columns) {
    const prevTop = c.d > 0 ? yb + Math.ceil(t[c.d - 1] - EPS) - 1 : yb - 1;
    const start = c.d > 0 ? yb + Math.floor(t[c.d - 1] + EPS) : yb;
    out.set(`${c.x},${c.z}`, c.facing === null ? prevTop : Math.min(start, prevTop + 1));
  }
  return out;
}
function buildSurface(ctx, op, columns, y, overhang, ridgeAxis = "x") {
  const maxD = columns.reduce((m, c) => Math.max(m, c.d), 0);
  const t = rowHeights(op, maxD);
  const yb = y - Math.ceil((t[overhang] ?? 1) - EPS) + 1;
  const topOf = (d) => yb + Math.ceil(t[d] - EPS) - 1;
  const stairs = /* @__PURE__ */ new Map();
  const stairsFor = (facing, half = "bottom") => {
    const key = `${facing}|${half}`;
    let s = stairs.get(key);
    if (!s) {
      s = ctx.source(op.block, { facing, half });
      stairs.set(key, s);
    }
    return s;
  };
  const slabRef = op.slab ?? deriveFamily(ctx, op.block, "slab") ?? op.block;
  const fullRef = op.full ?? deriveFamily(ctx, op.block, "full") ?? op.block;
  const slab = ctx.source(slabRef, { type: "bottom" });
  const full = ctx.source(fullRef);
  const fill = op.fill ? ctx.source(op.fill) : null;
  const eaves = op.eaves;
  const ridgeRef = op.ridge;
  const ridgeSoft = { type: "bottom", axis: ridgeAxis };
  for (const c of columns) {
    const prevTop = c.d > 0 ? topOf(c.d - 1) : yb - 1;
    const start = c.d > 0 ? yb + Math.floor(t[c.d - 1] + EPS) : yb;
    let bottom;
    let capTop;
    if (c.facing === null) {
      const prevT = c.d > 0 ? t[c.d - 1] : 0;
      const tc = prevT + (t[c.d] - prevT) / 2;
      const capHalf = Math.abs(tc - Math.floor(tc) - 0.5) < 0.01;
      const fullTo = capHalf ? yb + Math.floor(tc) - 1 : yb + Math.ceil(tc - EPS) - 1;
      bottom = prevTop;
      for (let yy = prevTop; yy <= fullTo; yy++) ctx.put(c.x, yy, c.z, full);
      if (capHalf) {
        capTop = yb + Math.floor(tc);
        if (ridgeRef) ctx.put(c.x, capTop, c.z, ctx.source(ridgeRef, ridgeSoft));
        else ctx.put(c.x, capTop, c.z, slab);
      } else {
        capTop = fullTo;
        if (ridgeRef) ctx.put(c.x, capTop + 1, c.z, ctx.source(ridgeRef, ridgeSoft));
      }
    } else {
      const tt = t[c.d];
      const half = Math.abs(tt - Math.floor(tt) - 0.5) < 0.01;
      bottom = Math.min(start, prevTop + 1);
      if (half) {
        const sy = yb + Math.floor(tt);
        for (let yy = start; yy < sy; yy++) ctx.put(c.x, yy, c.z, full);
        ctx.put(c.x, sy, c.z, slab);
        capTop = sy;
      } else {
        const top = topOf(c.d);
        for (let yy = start; yy < top; yy++) ctx.put(c.x, yy, c.z, full);
        ctx.put(c.x, top, c.z, stairsFor(c.facing));
        capTop = top;
      }
      if (ridgeRef && c.d === maxD) {
        ctx.put(c.x, capTop + 1, c.z, ctx.source(ridgeRef, ridgeSoft));
      }
    }
    if (fill) {
      for (let yy = y; yy < bottom; yy++) ctx.put(c.x, yy, c.z, fill);
    }
    if (eaves && c.d === 0 && c.facing) {
      ctx.put(
        c.x,
        bottom - 1,
        c.z,
        ctx.source(eaves, { facing: c.facing, half: "top", type: "top" })
      );
    }
  }
}
function coneRoof(ctx, op, overhang) {
  if (!op.center || !op.radius) {
    ctx.error(
      'roof "cone" needs "center" ([x, y, z], y = first layer above the wall) and "radius".'
    );
    return;
  }
  const [cx, y, cz] = op.center;
  const R = op.radius + overhang;
  const columns = [];
  let maxD = 0;
  for (let z3 = Math.floor(cz - R - 1); z3 <= Math.ceil(cz + R + 1); z3++) {
    for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) {
      const dx = x - cx;
      const dz = z3 - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= R + 0.5) continue;
      const d = Math.max(0, Math.floor(R + 0.5 - dist - EPS));
      let facing;
      if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) facing = null;
      else if (Math.abs(dx) >= Math.abs(dz)) facing = dx > 0 ? "west" : "east";
      else facing = dz > 0 ? "north" : "south";
      maxD = Math.max(maxD, d);
      columns.push({ x, z: z3, d, facing });
    }
  }
  for (const c of columns) if (c.d === maxD) c.facing = null;
  buildSurface(ctx, { ...op, ridge: void 0 }, columns, y, overhang);
  if (op.ridge) {
    const tip = columns.find((c) => c.facing === null);
    if (tip) {
      let top = y;
      for (let yy = y; yy < y + 512; yy++) if (ctx.get(tip.x, yy, tip.z) !== 0) top = yy;
      ctx.put(tip.x, top + 1, tip.z, ctx.source(op.ridge));
    }
  }
}

// packages/block-compiler/src/ops/detail.ts
function blocks(ctx, op) {
  const src = ctx.source(op.block);
  for (const [x, y, z3] of op.at) {
    ctx.put(x, y, z3, src);
    if (op.nbt) {
      const [wx, wy, wz] = ctx.toWorld(x, y, z3);
      ctx.blockEntities.set(`${wx},${wy},${wz}`, { x: wx, y: wy, z: wz, data: op.nbt });
    }
  }
}
function layers(ctx, op) {
  const plane = op.plane ?? "xz";
  const [ox, oy, oz] = op.origin;
  const sources = /* @__PURE__ */ new Map();
  const missing = /* @__PURE__ */ new Set();
  for (const [ch, ref] of Object.entries(op.legend)) sources.set(ch, ctx.source(ref));
  op.layers.forEach((rows, i) => {
    rows.forEach((row, j) => {
      for (let k = 0; k < row.length; k++) {
        const ch = row[k];
        const src = sources.get(ch);
        if (!src) {
          if (ch !== " " && ch !== ".") missing.add(ch);
          continue;
        }
        if (plane === "xz") ctx.put(ox + k, oy + i, oz + j, src);
        else if (plane === "xy") ctx.put(ox + k, oy + (rows.length - 1 - j), oz + i, src);
        else ctx.put(ox + i, oy + (rows.length - 1 - j), oz + k, src);
      }
    });
  });
  if (missing.size > 0) {
    ctx.error(
      `layers: character(s) ${[...missing].map((c) => `"${c}"`).join(", ")} not in legend (use " " or "." to skip).`
    );
  }
}
function replace(ctx, op) {
  const targets = Array.isArray(op.target) ? op.target : [op.target];
  const names = /* @__PURE__ */ new Set();
  const states = /* @__PURE__ */ new Set();
  for (const t of targets) {
    const r = ctx.resolver.namesOf(t, ctx.where);
    r.names.forEach((n) => names.add(n));
    r.states.forEach((s) => states.add(s));
  }
  const chance = op.chance ?? 1;
  const seed = (op.seed ?? ctx.seed) ^ 24301;
  const cache = /* @__PURE__ */ new Map();
  const visit = (wx, wy, wz, id) => {
    if (id === 0) return;
    const e = ctx.palette.get(id);
    if (!names.has(e.name) && !states.has(e.state)) return;
    if (chance < 1 && hash3(wx, wy, wz, seed) >= chance) return;
    let src = cache.get(id);
    if (!src) {
      src = ctx.source(op.block, e.props);
      cache.set(id, src);
    }
    const nid = src.id >= 0 ? src.id : src.id === -1 ? src.pick(wx, wy, wz) : -1;
    if (nid >= 0) ctx.putWorld(wx, wy, wz, nid);
  };
  if (op.from && op.to) {
    const [x0, x1] = sortPair(op.from[0], op.to[0]);
    const [y0, y1] = sortPair(op.from[1], op.to[1]);
    const [z0, z1] = sortPair(op.from[2], op.to[2]);
    for (let y = y0; y <= y1; y++) {
      for (let z3 = z0; z3 <= z1; z3++) {
        for (let x = x0; x <= x1; x++) {
          const [wx, wy, wz] = ctx.toWorld(x, y, z3);
          visit(wx, wy, wz, ctx.volume.get(wx, wy, wz));
        }
      }
    }
  } else {
    const hits = [];
    ctx.volume.forEach((x, y, z3, id) => hits.push([x, y, z3, id]));
    for (const [x, y, z3, id] of hits) visit(x, y, z3, id);
  }
}
function arch(ctx, op) {
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const alongX = x1 - x0 >= z1 - z0;
  const s0 = alongX ? x0 : z0;
  const s1 = alongX ? x1 : z1;
  const d0 = alongX ? z0 : x0;
  const d1 = alongX ? z1 : x1;
  const a = (s1 - s0 + 1) / 2;
  const c = (s0 + s1) / 2;
  const style = op.style ?? "round";
  const w = op.width ?? 1;
  const rise = op.rise ?? (style === "pointed" ? a * 1.6 : style === "segmental" ? a * 0.5 : style === "flat" ? 1 : a);
  const src = ctx.source(op.block);
  const fill = op.fill ? ctx.source(op.fill) : null;
  const inside = (du, dv, A, B) => {
    if (dv < 0) return Math.abs(du) < A;
    switch (style) {
      case "flat":
        return Math.abs(du) < A && dv < B;
      case "pointed": {
        const r = (B * B + A * A) / (2 * A);
        const k = A - r;
        return (du - k) ** 2 + dv * dv < r * r && (du + k) ** 2 + dv * dv < r * r;
      }
      case "segmental": {
        const r = (A * A + B * B) / (2 * B);
        return du * du + (dv - (B - r)) ** 2 < r * r;
      }
      default:
        return (du / A) ** 2 + (dv / B) ** 2 < 1;
    }
  };
  for (let s = s0 - w; s <= s1 + w; s++) {
    const du = s - c;
    for (let y = y0; y <= y1; y++) {
      const dv = y - y0 + 0.5;
      const inOpening = inside(du, dv, a, rise);
      const inOuter = inside(du, dv, a + w, rise + w);
      let block = null;
      if (inOuter && !inOpening) block = src;
      else if (inOpening && op.cut) block = { id: 0 };
      else if (!inOuter && fill && Math.abs(du) <= a + w) block = fill;
      if (!block) continue;
      for (let d = d0; d <= d1; d++) {
        if (alongX) ctx.put(s, y, d, block);
        else ctx.put(d, y, s, block);
      }
    }
  }
}

// packages/block-compiler/src/ops/nature.ts
function terrain(ctx, op) {
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const y0 = op.from[1];
  const shape = op.shape ?? "hills";
  const H = op.height ?? (shape === "island" ? 3 : 4);
  const A = op.amplitude ?? (shape === "flat" ? 0 : shape === "mountain" ? 18 : 4);
  const S = op.scale ?? Math.max(12, Math.min(48, (x1 - x0 + z1 - z0) / 4));
  const seed = op.seed ?? ctx.seed;
  const perlin = new Perlin(seed);
  const surface = ctx.source(op.surface ?? "grass_block");
  const sub = ctx.source(op.subsurface ?? "dirt");
  const core = ctx.source(op.core ?? "stone");
  const depth = op.depth ?? 3;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const rx = Math.max(1, (x1 - x0) / 2);
  const rz = Math.max(1, (z1 - z0) / 2);
  const W = x1 - x0 + 1;
  const L = z1 - z0 + 1;
  const heights = new Float32Array(W * L).fill(-Infinity);
  const bottoms = new Float32Array(W * L);
  for (let z3 = z0; z3 <= z1; z3++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx;
      const nz = (z3 - cz) / rz;
      const r = Math.sqrt(nx * nx + nz * nz);
      const n = perlin.fbm(x / S, 0.5, z3 / S, 4);
      let h;
      let bottom = y0;
      if (shape === "island") {
        const edge = 1 - 0.18 * perlin.fbm(x / (S * 0.6), 7.3, z3 / (S * 0.6), 2);
        if (r > edge) continue;
        const k = 1 - r / edge;
        h = H + A * n * k + 1.5 * k;
        const depthBelow = Math.pow(k, 0.65) * Math.min(rx, rz) * 0.9 * (0.75 + 0.35 * perlin.fbm(x / 6, 3.1, z3 / 6, 2));
        bottom = y0 - depthBelow;
      } else if (shape === "mountain") {
        const ridge = 1 - Math.abs(perlin.fbm(x / (S * 0.7), 1.7, z3 / (S * 0.7), 4));
        h = H + A * Math.max(0, 1 - r) ** 1.4 * (0.55 + 0.6 * ridge) + 2 * n;
      } else if (shape === "plateau") {
        const raw = H + A * (0.5 + n);
        h = Math.round(raw / 3) * 3 + (raw % 3 > 2.5 ? 1 : 0);
      } else if (shape === "flat") {
        h = H;
      } else {
        h = H + A * n;
      }
      if (op.edgeFalloff && shape !== "island") {
        const ex = Math.min(x - x0, x1 - x) / Math.max(1, W * 0.2);
        const ez = Math.min(z3 - z0, z1 - z3) / Math.max(1, L * 0.2);
        const f = Math.min(1, ex, ez);
        h *= f * f * (3 - 2 * f);
      }
      heights[(z3 - z0) * W + (x - x0)] = h;
      bottoms[(z3 - z0) * W + (x - x0)] = bottom;
    }
  }
  const water = op.waterLevel !== void 0 ? ctx.source(op.water ?? "water") : null;
  const at = (x, z3) => {
    if (x < x0 || x > x1 || z3 < z0 || z3 > z1) return -Infinity;
    return heights[(z3 - z0) * W + (x - x0)];
  };
  for (let z3 = z0; z3 <= z1; z3++) {
    for (let x = x0; x <= x1; x++) {
      const h = at(x, z3);
      if (h === -Infinity) continue;
      const top = y0 + Math.round(h);
      const bottom = Math.round(bottoms[(z3 - z0) * W + (x - x0)]);
      let steep = 0;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const nh = at(x + dx, z3 + dz);
        if (nh !== -Infinity) steep = Math.max(steep, Math.abs(nh - h));
      }
      const exposed = steep > 2.2;
      for (let y = bottom; y <= top; y++) {
        const src = y === top ? exposed ? core : surface : y > top - depth ? exposed ? core : sub : core;
        ctx.put(x, y, z3, src);
      }
      if (water && op.waterLevel !== void 0) {
        for (let y = top + 1; y <= op.waterLevel; y++) ctx.put(x, y, z3, water);
      }
    }
  }
}
var TREE_DEFAULTS = {
  oak: { log: "oak_log", leaves: "oak_leaves" },
  big_oak: { log: "oak_log", leaves: "oak_leaves" },
  birch: { log: "birch_log", leaves: "birch_leaves" },
  spruce: { log: "spruce_log", leaves: "spruce_leaves" },
  pine: { log: "spruce_log", leaves: "spruce_leaves" },
  dark_oak: { log: "dark_oak_log", leaves: "dark_oak_leaves" },
  jungle: { log: "jungle_log", leaves: "jungle_leaves" },
  acacia: { log: "acacia_log", leaves: "acacia_leaves" },
  cherry: { log: "cherry_log", leaves: "cherry_leaves" },
  willow: { log: "oak_log", leaves: "oak_leaves" },
  palm: { log: "jungle_log", leaves: "jungle_leaves" },
  dead: { log: "oak_log", leaves: "" },
  bush: { log: "oak_log", leaves: "oak_leaves" },
  fantasy: { log: "dark_oak_log", leaves: "oak_leaves" }
};
var TreeBuilder = class {
  constructor(ctx, base, logRef, leavesRef, seed) {
    this.ctx = ctx;
    this.base = base;
    this.logs = {
      x: ctx.source(logRef, { axis: "x" }),
      y: ctx.source(logRef, { axis: "y" }),
      z: ctx.source(logRef, { axis: "z" })
    };
    this.leaves = leavesRef ? ctx.source(leavesRef, { persistent: "true" }) : null;
    this.rnd = makeRng(seed);
  }
  logs;
  leaves;
  rnd;
  range(a, b) {
    return a + this.rnd() * (b - a);
  }
  log(x, y, z3, axis2 = "y") {
    const [bx, by, bz] = this.base;
    this.ctx.put(bx + x, by + y, bz + z3, this.logs[axis2]);
  }
  leaf(x, y, z3) {
    if (!this.leaves) return;
    const [bx, by, bz] = this.base;
    if (this.ctx.get(bx + x, by + y, bz + z3) !== 0) return;
    this.ctx.put(bx + x, by + y, bz + z3, this.leaves);
  }
  /** Straight trunk, optionally 2×2 / 3×3. */
  trunk(height, width = 1, fromY = 0) {
    for (let y = fromY; y < height; y++) {
      for (let dz = 0; dz < width; dz++)
        for (let dx = 0; dx < width; dx++)
          this.log(dx - (width > 2 ? 1 : 0), y, dz - (width > 2 ? 1 : 0));
    }
  }
  /** Log line from a to b with the axis following the dominant direction of each step. */
  branch(a, b) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
    let prev = [Math.round(a[0]), Math.round(a[1]), Math.round(a[2])];
    for (let i = 0; i <= n; i++) {
      const p = [
        Math.round(a[0] + (b[0] - a[0]) * i / n),
        Math.round(a[1] + (b[1] - a[1]) * i / n),
        Math.round(a[2] + (b[2] - a[2]) * i / n)
      ];
      const dx = Math.abs(p[0] - prev[0]);
      const dy = Math.abs(p[1] - prev[1]);
      const dz = Math.abs(p[2] - prev[2]);
      const axis2 = dy >= dx && dy >= dz ? "y" : dx >= dz ? "x" : "z";
      this.log(p[0], p[1], p[2], i === 0 ? "y" : axis2);
      prev = p;
    }
  }
  /** Leaf blob (ellipsoid) with a ragged, hand-placed looking edge. */
  blob(c, rx, ry, rz, ragged = 0.35) {
    const [bx, by, bz] = this.base;
    for (let y = Math.floor(-ry - 1); y <= Math.ceil(ry + 1); y++) {
      for (let z3 = Math.floor(-rz - 1); z3 <= Math.ceil(rz + 1); z3++) {
        for (let x = Math.floor(-rx - 1); x <= Math.ceil(rx + 1); x++) {
          const d = (x / (rx + 0.5)) ** 2 + (y / (ry + 0.5)) ** 2 + (z3 / (rz + 0.5)) ** 2;
          if (d >= 1) continue;
          if (d > 1 - ragged) {
            const h = hash3(bx + c[0] + x, by + c[1] + y, bz + c[2] + z3, 77);
            if (h < (d - (1 - ragged)) / ragged) continue;
          }
          this.leaf(Math.round(c[0]) + x, Math.round(c[1]) + y, Math.round(c[2]) + z3);
        }
      }
    }
  }
  /** Strand of leaves hanging down (willows). */
  hang(x, y, z3, length) {
    for (let i = 0; i < length; i++) this.leaf(x, y - i, z3);
  }
};
function tree(ctx, op) {
  const def = TREE_DEFAULTS[op.kind];
  const [ax, ay, az] = ctx.toWorld(op.at[0], op.at[1], op.at[2]);
  const seed = (op.seed ?? ctx.seed) ^ Math.imul(ax, 73856093) ^ Math.imul(az, 19349663) ^ ay;
  let leaves = op.leaves ?? def.leaves;
  if (op.kind === "fantasy" && !op.leaves && ctx.catalog.has("flowering_azalea_leaves")) {
    ctx.paletteDefs["~fantasy_leaves"] ??= {
      mix: { azalea_leaves: 3, flowering_azalea_leaves: 1, oak_leaves: 2 },
      scale: 3
    };
    leaves = "~fantasy_leaves";
  }
  const t = new TreeBuilder(ctx, op.at, op.log ?? def.log, leaves, seed);
  const r = (a, b) => t.range(a, b);
  const ri = (a, b) => Math.floor(t.range(a, b + 1));
  const H = op.height;
  const R = op.radius;
  switch (op.kind) {
    case "oak": {
      const h = H ?? ri(5, 7);
      t.trunk(h);
      const rad = R ?? r(2.2, 3);
      t.blob([0, h - 1, 0], rad, rad * 0.7, rad);
      for (let i = 0; i < 3; i++) {
        const a = r(0, Math.PI * 2);
        t.blob(
          [Math.cos(a) * rad * 0.7, h - 2 + r(-0.5, 1), Math.sin(a) * rad * 0.7],
          rad * 0.6,
          rad * 0.5,
          rad * 0.6
        );
      }
      break;
    }
    case "big_oak":
    case "fantasy": {
      const fantasy = op.kind === "fantasy";
      const h = H ?? (fantasy ? ri(14, 22) : ri(10, 15));
      const width = h >= 16 ? 2 : 1;
      t.trunk(Math.round(h * 0.75), width);
      const lo = width > 2 ? -1 : 0;
      const hi = lo + width - 1;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const len = ri(1, fantasy ? 3 : 2);
        const sx = dx > 0 ? hi + 1 : dx < 0 ? lo - 1 : lo + ri(0, width - 1);
        const sz = dz > 0 ? hi + 1 : dz < 0 ? lo - 1 : lo + ri(0, width - 1);
        for (let i = 0; i < len; i++) t.log(sx + dx * i, 0, sz + dz * i, dx !== 0 ? "x" : "z");
      }
      const branches = fantasy ? ri(6, 9) : ri(4, 6);
      const rad = R ?? (fantasy ? r(3.5, 4.5) : r(2.5, 3.2));
      for (let i = 0; i < branches; i++) {
        const a = i / branches * Math.PI * 2 + r(-0.4, 0.4);
        const startY = Math.round(h * r(0.4, 0.7));
        const len = r(h * 0.25, h * 0.45);
        const end = [Math.cos(a) * len, startY + len * r(0.4, 0.8), Math.sin(a) * len];
        t.branch([0, startY, 0], end);
        t.blob(end, rad * r(0.8, 1.1), rad * 0.6, rad * r(0.8, 1.1));
      }
      t.branch([0, Math.round(h * 0.7), 0], [r(-1, 1), h, r(-1, 1)]);
      t.blob([0, h, 0], rad * 1.1, rad * 0.75, rad * 1.1);
      break;
    }
    case "birch": {
      const h = H ?? ri(6, 9);
      t.trunk(h);
      const rad = R ?? 2;
      t.blob([0, h - 2, 0], rad, 2.2, rad, 0.25);
      t.leaf(0, h, 0);
      break;
    }
    case "spruce":
    case "pine": {
      const pine = op.kind === "pine";
      const h = H ?? (pine ? ri(14, 20) : ri(10, 16));
      t.trunk(h - 1);
      const start = pine ? Math.round(h * 0.55) : 2;
      const maxR = R ?? (pine ? 2.6 : r(3, 4));
      for (let y = start; y <= h; y++) {
        const k = (h - y) / Math.max(1, h - start);
        const wobble = (y - start) % 2 === 0 ? 1 : 0.6;
        const rad = Math.max(0, maxR * k * wobble);
        if (rad < 0.6) {
          t.leaf(0, y, 0);
          continue;
        }
        t.blob([0, y, 0], rad, 0.01, rad, 0.3);
      }
      t.leaf(0, h + 1, 0);
      break;
    }
    case "dark_oak": {
      const h = H ?? ri(6, 9);
      t.trunk(h, 2);
      const rad = R ?? r(4, 5);
      t.blob([0.5, h, 0.5], rad, 2, rad);
      for (let i = 0; i < 3; i++) {
        const a = r(0, Math.PI * 2);
        const end = [Math.cos(a) * 3, h - r(1, 3), Math.sin(a) * 3];
        t.branch([0, h - 3, 0], end);
        t.blob(end, 2.2, 1.4, 2.2);
      }
      break;
    }
    case "jungle": {
      const h = H ?? ri(16, 24);
      t.trunk(h, 2);
      const rad = R ?? 4;
      t.blob([0.5, h, 0.5], rad, 2, rad);
      for (let y = Math.round(h * 0.5); y < h - 3; y += ri(3, 5)) {
        const a = r(0, Math.PI * 2);
        const end = [Math.cos(a) * 3, y + 1, Math.sin(a) * 3];
        t.branch([0, y, 0], end);
        t.blob(end, 2, 1, 2);
      }
      break;
    }
    case "acacia": {
      const h = H ?? ri(6, 8);
      const lean = r(0, Math.PI * 2);
      const mid = [
        Math.round(Math.cos(lean) * 2),
        Math.round(h * 0.55),
        Math.round(Math.sin(lean) * 2)
      ];
      t.branch([0, 0, 0], mid);
      for (const s of [1, -1]) {
        const a = lean + s * r(0.6, 1.3);
        const end = [mid[0] + Math.cos(a) * 3, h, mid[2] + Math.sin(a) * 3];
        t.branch(mid, end);
        t.blob([end[0], end[1] + 1, end[2]], R ?? 3.2, 0.6, R ?? 3.2, 0.25);
      }
      break;
    }
    case "cherry": {
      const h = H ?? ri(6, 9);
      t.trunk(Math.round(h * 0.5));
      const rad = R ?? r(3.5, 4.5);
      for (const s of [0, 1, 2]) {
        const a = s / 3 * Math.PI * 2 + r(-0.5, 0.5);
        const end = [Math.cos(a) * 3, h - r(0, 2), Math.sin(a) * 3];
        t.branch([0, Math.round(h * 0.45), 0], end);
        t.blob([end[0], end[1] + 1, end[2]], rad, rad * 0.55, rad);
        for (let k = 0; k < 6; k++) {
          t.hang(
            Math.round(end[0] + r(-rad, rad) * 0.8),
            Math.round(end[1]) - 1,
            Math.round(end[2] + r(-rad, rad) * 0.8),
            ri(1, 2)
          );
        }
      }
      break;
    }
    case "willow": {
      const h = H ?? ri(7, 10);
      t.trunk(h, h > 9 ? 2 : 1);
      const rad = R ?? r(4, 5.5);
      t.blob([0, h, 0], rad, rad * 0.5, rad);
      for (let i = 0; i < 4; i++) {
        const a = r(0, Math.PI * 2);
        const end = [Math.cos(a) * rad * 0.6, h - 1, Math.sin(a) * rad * 0.6];
        t.branch([0, h - 3, 0], end);
      }
      for (let z3 = -Math.ceil(rad); z3 <= Math.ceil(rad); z3++) {
        for (let x = -Math.ceil(rad); x <= Math.ceil(rad); x++) {
          const d = Math.sqrt(x * x + z3 * z3) / rad;
          if (d < 0.55 || d > 1.02 || t.rnd() > 0.55) continue;
          t.hang(
            x,
            Math.round(h - rad * 0.3 * Math.sqrt(Math.max(0, 1 - d * d))),
            z3,
            ri(3, Math.max(4, Math.round(h * 0.6)))
          );
        }
      }
      break;
    }
    case "palm": {
      const h = H ?? ri(7, 11);
      const a = r(0, Math.PI * 2);
      const bend = r(2, 4);
      let top = [0, 0, 0];
      for (let y = 0; y < h; y++) {
        const k = (y / h) ** 2 * bend;
        const p = [Math.round(Math.cos(a) * k), y, Math.round(Math.sin(a) * k)];
        t.log(p[0], p[1], p[2]);
        top = p;
      }
      for (let i = 0; i < 8; i++) {
        const fa = i / 8 * Math.PI * 2;
        const len = R ?? r(3.5, 5);
        for (let s = 1; s <= len; s++) {
          const droop = s > len * 0.5 ? Math.round((s - len * 0.5) * 0.8) : 0;
          t.leaf(
            Math.round(top[0] + Math.cos(fa) * s),
            top[1] + 1 - droop,
            Math.round(top[2] + Math.sin(fa) * s)
          );
        }
      }
      t.leaf(top[0], top[1] + 1, top[2]);
      break;
    }
    case "dead": {
      const h = H ?? ri(5, 9);
      t.trunk(h);
      for (let i = 0; i < ri(2, 4); i++) {
        const a = r(0, Math.PI * 2);
        const y = ri(Math.round(h * 0.4), h - 1);
        t.branch([0, y, 0], [Math.cos(a) * r(2, 3.5), y + r(1, 3), Math.sin(a) * r(2, 3.5)]);
      }
      break;
    }
    case "bush": {
      const rad = R ?? r(1.2, 2);
      t.log(0, 0, 0);
      t.blob([0, 0.3, 0], rad, rad * 0.75, rad, 0.4);
      break;
    }
  }
}
function scatter(ctx, op, placeComponent) {
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  const on = op.on ? (() => {
    const names = /* @__PURE__ */ new Set();
    for (const ref of op.on ?? [])
      ctx.resolver.namesOf(ref, ctx.where).names.forEach((n) => names.add(n));
    return names;
  })() : null;
  const src = op.block ? ctx.source(op.block) : null;
  if (!src && !op.component && !op.tree) {
    ctx.error('scatter needs "block", "component" or "tree".');
    return;
  }
  if (op.component && !ctx.components[op.component]) {
    ctx.error(`scatter: unknown component "${op.component}".`);
    return;
  }
  const seed = (op.seed ?? ctx.seed) ^ 23719;
  const spacing = op.spacing ?? 0;
  const cell = Math.max(1, spacing);
  const placed = /* @__PURE__ */ new Map();
  const farEnough = (x, z3) => {
    if (spacing <= 0) return true;
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z3 / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const [px, pz] of placed.get(`${gx + dx},${gz + dz}`) ?? []) {
          if ((px - x) ** 2 + (pz - z3) ** 2 < spacing * spacing) return false;
        }
      }
    }
    return true;
  };
  const targets = [];
  for (let z3 = z0; z3 <= z1; z3++) {
    for (let x = x0; x <= x1; x++) {
      const [wx, , wz] = ctx.toWorld(x, 0, z3);
      if (hash3(wx, 0, wz, seed) >= op.density) continue;
      for (let y = y1; y >= y0; y--) {
        const id = ctx.get(x, y, z3);
        if (id === 0) continue;
        if (ctx.get(x, y + 1, z3) !== 0) break;
        const name = ctx.palette.get(id).name;
        if (on ? on.has(name) : !/leaves|water|lava|glass/.test(name)) targets.push([x, y + 1, z3]);
        break;
      }
    }
  }
  for (const [x, y, z3] of targets) {
    if (!farEnough(x, z3)) continue;
    const key = `${Math.floor(x / cell)},${Math.floor(z3 / cell)}`;
    placed.set(key, [...placed.get(key) ?? [], [x, z3]]);
    const h = hash3(x, y, z3, seed ^ 4660);
    if (src) ctx.put(x, y, z3, src);
    else if (op.component) placeComponent(op.component, [x, y, z3], Math.floor(h * 4) * 90);
    else if (op.tree)
      tree(ctx, { type: "tree", kind: op.tree, at: [x, y, z3], seed: Math.floor(h * 1e6) });
  }
}

// packages/block-compiler/src/compileBuildSpec.ts
var BuildSpecError = class extends Error {
  errors;
  constructor(errors) {
    super(`Invalid build spec: ${errors.join("; ")}`);
    this.name = "BuildSpecError";
    this.errors = errors;
  }
};
var MAX_ERRORS = 40;
function versionHint() {
  const majors = [...new Set(listVersions().map((v) => v.major))];
  return `Supported: ${majors[majors.length - 1]} \u2026 ${majors[0]} (e.g. "1.21.4", "1.20.1", "1.16.5", "1.12.2", "${listVersions()[0]?.id}").`;
}
function compileBuildSpec(input, options = {}) {
  const started = performance.now();
  const validation = validateBuildSpec(input);
  if (!validation.success) throw new BuildSpecError(validation.errors);
  const spec = validation.data;
  const version = resolveVersion(spec.minecraftVersion);
  if (!version) {
    throw new BuildSpecError([
      `minecraftVersion: "${spec.minecraftVersion}" is not a known Minecraft Java release. ${versionHint()}`
    ]);
  }
  const catalog = getCatalog(version);
  const sparse = new SparseVolume();
  const palette = new InternalPalette(catalog);
  const paletteDefs = { ...spec.palette ?? {} };
  const seed = spec.seed ?? hashString(spec.name) % 1e5;
  const resolver = new BlockResolver(catalog, palette, paletteDefs, seed);
  const ctx = new CompileContext(
    spec,
    catalog,
    sparse,
    palette,
    resolver,
    options.scriptRunner,
    paletteDefs,
    spec.components ?? {}
  );
  const runner = new OperationRunner(ctx, options.scriptTimeoutMs ?? 2e4);
  try {
    spec.operations.forEach((op, i) => runner.run(op, `operations[${i}]`, []));
  } catch (error) {
    if (error instanceof CompileLimitError) throw new BuildSpecError([error.message]);
    throw error;
  }
  if (resolver.errors.length > 0) {
    const errors = resolver.errors.slice(0, MAX_ERRORS);
    if (resolver.errors.length > MAX_ERRORS)
      errors.push(`\u2026and ${resolver.errors.length - MAX_ERRORS} more errors.`);
    throw new BuildSpecError(errors);
  }
  completeMultiBlocks(sparse, palette);
  const { volume, clipped } = finalize(sparse, palette, spec, ctx);
  applyAutoStates(volume, palette.entries, catalog);
  const compact = volume.compact();
  const warnings = [...resolver.notes, ...ctx.warnings];
  for (const key of Object.keys(spec.palette ?? {})) {
    if (catalog.has(key)) {
      warnings.push(
        `Palette key "${key}" is also a block name: everywhere you wrote "${key}" the palette entry was used. Write "minecraft:${key}" for the plain block, or rename the key.`
      );
    }
  }
  if (clipped > 0) {
    warnings.push(
      `${clipped} block(s) fell outside the declared size ${spec.size?.x}\xD7${spec.size?.y}\xD7${spec.size?.z} and were dropped.`
    );
  }
  if (ctx.outOfRangeWrites > 0)
    warnings.push(`${ctx.outOfRangeWrites} block(s) were beyond \xB130000 and were skipped.`);
  const counts = compact.counts();
  if (counts.size === 0) warnings.push("The build is empty: no operation placed any block.");
  const anchor = spec.anchor ? [
    spec.anchor[0] - compact.origin[0],
    spec.anchor[1] - compact.origin[1],
    spec.anchor[2] - compact.origin[2]
  ] : (
    // Default: horizontal centre, at spec y=0 (ground level by convention) when the build has it.
    [
      Math.floor(compact.sizeX / 2),
      Math.min(compact.sizeY - 1, Math.max(0, -compact.origin[1])),
      Math.floor(compact.sizeZ / 2)
    ]
  );
  return {
    spec,
    version,
    volume: compact,
    warnings: dedupeWarnings(warnings),
    provTable: ctx.provTable,
    blockCount: [...counts.values()].reduce((a, b) => a + b, 0),
    palette: [...counts.keys()].sort(),
    anchor,
    compileMs: Math.round(performance.now() - started)
  };
}
function dedupeWarnings(list2) {
  const out = [...new Set(list2)];
  if (out.length > 25) return [...out.slice(0, 25), `\u2026and ${out.length - 25} more warnings.`];
  return out;
}
function finalize(sparse, palette, spec, ctx) {
  const states = palette.entries.map((e) => e.state);
  let min;
  let max;
  if (spec.size) {
    min = [0, 0, 0];
    max = [spec.size.x - 1, spec.size.y - 1, spec.size.z - 1];
  } else {
    const b = sparse.bounds();
    if (!b) return { volume: new BlockVolume(1, 1, 1, [0, 0, 0], states), clipped: 0 };
    min = b.min;
    max = b.max;
  }
  const sx = max[0] - min[0] + 1;
  const sy = max[1] - min[1] + 1;
  const sz = max[2] - min[2] + 1;
  if (sx * sy * sz > 12e7) {
    throw new BuildSpecError([
      `The build's bounding box ${sx}\xD7${sy}\xD7${sz} is too large (max ~120 million cells). Check coordinates for a typo or split it into parts.`
    ]);
  }
  const data = new Uint16Array(sx * sy * sz);
  const prov = new Uint16Array(sx * sy * sz);
  let clipped = 0;
  sparse.forEach((x, y, z3, id, p) => {
    const lx = x - min[0];
    const ly = y - min[1];
    const lz = z3 - min[2];
    if (lx < 0 || ly < 0 || lz < 0 || lx >= sx || ly >= sy || lz >= sz) {
      clipped++;
      return;
    }
    const i = lx + sx * (lz + sz * ly);
    data[i] = id;
    prov[i] = p;
  });
  const blockEntities = [];
  for (const be of ctx.blockEntities.values()) {
    const lx = be.x - min[0];
    const ly = be.y - min[1];
    const lz = be.z - min[2];
    if (lx < 0 || ly < 0 || lz < 0 || lx >= sx || ly >= sy || lz >= sz) continue;
    const id = data[lx + sx * (lz + sz * ly)];
    if (id === 0) continue;
    blockEntities.push({
      id: `minecraft:${palette.get(id).name}`,
      pos: [lx, ly, lz],
      data: be.data
    });
  }
  return { volume: new BlockVolume(sx, sy, sz, min, states, data, prov, blockEntities), clipped };
}
var OperationRunner = class {
  constructor(ctx, scriptTimeoutMs) {
    this.ctx = ctx;
    this.scriptTimeoutMs = scriptTimeoutMs;
  }
  depth = 0;
  run(op, path, trail) {
    const ctx = this.ctx;
    const label = op.id ? `${path} (${op.id})` : path;
    const prevWhere = ctx.where;
    const prevMask = ctx.mask;
    ctx.where = op.id ? `${path} "${op.id}"` : path;
    if (op.mask) ctx.mask = ctx.parseMask(op.mask);
    try {
      if (op.type === "group") {
        this.transformed(op, Transform.translate(...op.offset ?? [0, 0, 0]), () => {
          op.operations.forEach(
            (child, i) => this.run(child, `${path}.operations[${i}]`, [...trail, label])
          );
        });
        return;
      }
      if (op.type === "place") {
        const comp = ctx.components[op.component];
        if (!comp) {
          ctx.error(
            `unknown component "${op.component}". Defined: ${Object.keys(ctx.components).join(", ") || "none"}.`
          );
          return;
        }
        this.placeComponent(op.component, comp, op, trail, label);
        return;
      }
      ctx.enterProv([...trail, label].join(" > "));
      this.leaf(op);
    } finally {
      ctx.where = prevWhere;
      ctx.mask = prevMask;
    }
  }
  placeComponent(name, comp, op, trail, label) {
    if (this.depth > 16) {
      this.ctx.error(`component "${name}" nests too deeply (recursive components?).`);
      return;
    }
    this.depth++;
    try {
      this.transformed(op, Transform.translate(...op.at), () => {
        comp.operations.forEach(
          (child, i) => this.run(child, `components.${name}.operations[${i}]`, [
            ...trail,
            `${label} place ${name}`
          ])
        );
      });
    } finally {
      this.depth--;
    }
  }
  /** Apply mirror -> rotate -> translate, then repeat copies and symmetric copies. */
  transformed(op, translate, body) {
    let local = translate.compose(Transform.rotate(op.rotate ?? 0));
    if (op.mirror) local = local.compose(Transform.mirror(op.mirror));
    const variants = [Transform.IDENTITY];
    if (op.symmetry?.x !== void 0) variants.push(Transform.mirror("x", op.symmetry.x));
    if (op.symmetry?.z !== void 0) variants.push(Transform.mirror("z", op.symmetry.z));
    if (op.symmetry?.x !== void 0 && op.symmetry?.z !== void 0) {
      variants.push(
        Transform.mirror("x", op.symmetry.x).compose(Transform.mirror("z", op.symmetry.z))
      );
    }
    const count = op.repeat?.count ?? 1;
    const step = op.repeat?.offset ?? [0, 0, 0];
    for (const sym of variants) {
      for (let i = 0; i < count; i++) {
        const copy = sym.compose(Transform.translate(step[0] * i, step[1] * i, step[2] * i)).compose(local);
        this.ctx.withTransform(copy, body);
      }
    }
  }
  leaf(op) {
    const ctx = this.ctx;
    switch (op.type) {
      case "box":
        return box(ctx, op);
      case "line":
        return line(ctx, op);
      case "cylinder":
        return cylinder(ctx, op);
      case "cone":
        return cone(ctx, op);
      case "sphere":
        return sphere(ctx, op);
      case "dome":
        return dome(ctx, op);
      case "polygon":
        return polygon(ctx, op);
      case "roof":
        return roof(ctx, op);
      case "arch":
        return arch(ctx, op);
      case "blocks":
        return blocks(ctx, op);
      case "layers":
        return layers(ctx, op);
      case "terrain":
        return terrain(ctx, op);
      case "tree":
        return tree(ctx, op);
      case "scatter":
        return scatter(ctx, op, (name, at, rotate) => {
          const comp = ctx.components[name];
          if (comp) this.placeComponent(name, comp, { at, rotate }, [], ctx.where);
        });
      case "replace":
        return replace(ctx, op);
      case "script":
        return this.script(op.code, op.args ?? {});
    }
  }
  script(code, args) {
    const ctx = this.ctx;
    if (!ctx.scriptRunner) {
      ctx.error("script operations are not available in this environment.");
      return;
    }
    const rnd = makeRng(ctx.seed ^ hashString(code));
    const perlin = new Perlin(ctx.seed);
    const where = ctx.where;
    let logs = 0;
    const runOp = (raw) => {
      const parsed = operationSchema.safeParse(raw);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "op"}: ${i.message}`).join("; ");
        throw new Error(`invalid operation ${JSON.stringify(raw).slice(0, 120)}: ${msg}`);
      }
      const prevWhere = ctx.where;
      this.run(parsed.data, `${where} script`, []);
      ctx.where = prevWhere;
    };
    const shape = (type) => (params) => runOp({ ...params, type });
    const api = {
      args,
      set: (x, y, z3, block) => {
        ctx.put(Math.round(x), Math.round(y), Math.round(z3), ctx.source(String(block)));
      },
      get: (x, y, z3) => {
        const id = ctx.get(Math.round(x), Math.round(y), Math.round(z3));
        return id === 0 ? null : ctx.palette.get(id).state;
      },
      op: runOp,
      box: (from, to, block, opts = {}) => runOp({ type: "box", from, to, block, ...opts }),
      line: (from, to, block, opts = {}) => runOp({ type: "line", from, to, block, ...opts }),
      cylinder: shape("cylinder"),
      cone: shape("cone"),
      sphere: shape("sphere"),
      dome: shape("dome"),
      polygon: shape("polygon"),
      roof: shape("roof"),
      arch: shape("arch"),
      tree: shape("tree"),
      layers: shape("layers"),
      terrain: shape("terrain"),
      scatter: shape("scatter"),
      replace: shape("replace"),
      place: (component, at, opts = {}) => runOp({ type: "place", component, at, ...opts }),
      rand: () => rnd(),
      randInt: (a, b) => a + Math.floor(rnd() * (b - a + 1)),
      pick: (list2) => list2[Math.floor(rnd() * list2.length)],
      chance: (p) => rnd() < p,
      noise: (x, y = 0, z3 = 0) => perlin.noise(x, y, z3),
      fbm: (x, y = 0, z3 = 0, octaves = 4) => perlin.fbm(x, y, z3, octaves),
      log: (...parts) => {
        if (logs++ < 20) ctx.warnings.add(`${where} log: ${parts.map(String).join(" ")}`);
      }
    };
    try {
      ctx.scriptRunner(code, api, this.scriptTimeoutMs);
    } catch (error) {
      if (error instanceof CompileLimitError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      ctx.error(`script failed: ${message}`);
    }
  }
};

// packages/block-compiler/src/nodeScriptRunner.ts
import vm from "node:vm";
var nodeScriptRunner = (code, api, timeoutMs) => {
  const sandbox = vm.createContext({
    __api: api,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Set,
    Map
  });
  const names = Object.keys(api).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  const wrapped = `(function () {
"use strict";
const { ${names.join(", ")} } = __api;
${code}
})();`;
  vm.runInContext(wrapped, sandbox, { timeout: timeoutMs, filename: "build-script.js" });
};

// packages/formats/src/materials.ts
var NOT_ITEMS = /^(air|cave_air|void_air|piston_head|moving_piston|fire|soul_fire|nether_portal|end_portal|end_gateway|bubble_column|frosted_ice)$/;
function itemFor(state) {
  const name = blockNameOf(state);
  if (NOT_ITEMS.test(name)) return null;
  const p = propsOf(state);
  if (p.half === "upper" && !name.endsWith("_stairs") && !name.endsWith("_trapdoor")) return null;
  if (p.part === "head") return null;
  if (name === "water")
    return p.level === "0" || p.level === void 0 ? ["water_bucket", 1] : null;
  if (name === "lava") return p.level === "0" || p.level === void 0 ? ["lava_bucket", 1] : null;
  if (name === "redstone_wire") return ["redstone", 1];
  if (name === "tripwire") return ["string", 1];
  if (name.startsWith("potted_")) return [name.slice(7), 1];
  let item = name.replace(/_wall_hanging_sign$/, "_hanging_sign").replace(/_wall_(sign|banner|torch|head|skull|fan)$/, "_$1").replace(/^wall_torch$/, "torch");
  if (item === "tall_seagrass") item = "seagrass";
  let count = 1;
  if (p.type === "double" && name.endsWith("_slab")) count = 2;
  if (p.candles) count = Number(p.candles);
  if (p.pickles) count = Number(p.pickles);
  if (p.eggs) count = Number(p.eggs);
  if (name === "snow" && p.layers) count = Number(p.layers);
  return [item, count];
}
function stackSizeOf(item) {
  if (/(_bed|^cake)$/.test(item) || item.endsWith("_bucket")) return 1;
  if (/(_sign|_hanging_sign|_banner)$/.test(item) || item === "egg" || item === "snowball")
    return 16;
  return 64;
}
function materialList(volume) {
  const totals = /* @__PURE__ */ new Map();
  for (const [state, n] of volume.counts()) {
    const it = itemFor(state);
    if (!it) continue;
    totals.set(it[0], (totals.get(it[0]) ?? 0) + it[1] * n);
  }
  return [...totals.entries()].map(([item, count]) => {
    const stackSize = stackSizeOf(item);
    return {
      item,
      count,
      stackSize,
      stacks: Math.floor(count / stackSize),
      remainder: count % stackSize,
      shulkers: Math.ceil(count / (stackSize * 27))
    };
  }).sort((a, b) => b.count - a.count);
}
function materialListCsv(items, displayName) {
  const lines = ["Item,Id,Count,Stacks,Remainder,Shulker boxes"];
  for (const m of items) {
    lines.push(
      `"${displayName(m.item)}",minecraft:${m.item},${m.count},${m.stacks},${m.remainder},${m.shulkers}`
    );
  }
  return `${lines.join("\n")}
`;
}

// packages/formats/src/writers.ts
import { gzipSync } from "node:zlib";

// packages/formats/src/nbt.ts
var IDS = {
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12
};
var byte = (v) => ({ t: "byte", v });
var short = (v) => ({ t: "short", v });
var int = (v) => ({ t: "int", v });
var long = (v) => ({ t: "long", v: BigInt(v) });
var double = (v) => ({ t: "double", v });
var str = (v) => ({ t: "string", v });
var compound = (v) => ({ t: "compound", v });
var list = (elem, v) => ({ t: "list", elem, v });
var intArray = (v) => ({ t: "intArray", v });
var byteArray = (v) => ({ t: "byteArray", v });
var Writer = class {
  buf = Buffer.allocUnsafe(1 << 16);
  pos = 0;
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = Buffer.allocUnsafe(size);
    this.buf.copy(next, 0, 0, this.pos);
    this.buf = next;
  }
  u8(v) {
    this.ensure(1);
    this.buf.writeUInt8(v & 255, this.pos++);
  }
  i8(v) {
    this.ensure(1);
    this.buf.writeInt8(v, this.pos++);
  }
  i16(v) {
    this.ensure(2);
    this.buf.writeInt16BE(v, this.pos);
    this.pos += 2;
  }
  u16(v) {
    this.ensure(2);
    this.buf.writeUInt16BE(v, this.pos);
    this.pos += 2;
  }
  i32(v) {
    this.ensure(4);
    this.buf.writeInt32BE(v | 0, this.pos);
    this.pos += 4;
  }
  u32(v) {
    this.ensure(4);
    this.buf.writeUInt32BE(v >>> 0, this.pos);
    this.pos += 4;
  }
  i64(v) {
    this.ensure(8);
    this.buf.writeBigInt64BE(BigInt.asIntN(64, v), this.pos);
    this.pos += 8;
  }
  f32(v) {
    this.ensure(4);
    this.buf.writeFloatBE(v, this.pos);
    this.pos += 4;
  }
  f64(v) {
    this.ensure(8);
    this.buf.writeDoubleBE(v, this.pos);
    this.pos += 8;
  }
  bytes(v) {
    this.ensure(v.length);
    this.buf.set(new Uint8Array(v.buffer, v.byteOffset, v.length), this.pos);
    this.pos += v.length;
  }
  string(s) {
    const b = Buffer.from(s, "utf8");
    this.u16(b.length);
    this.bytes(b);
  }
  result() {
    return this.buf.subarray(0, this.pos);
  }
};
function payload(w, tag) {
  switch (tag.t) {
    case "byte":
      return w.i8(tag.v);
    case "short":
      return w.i16(tag.v);
    case "int":
      return w.i32(tag.v);
    case "long":
      return w.i64(tag.v);
    case "float":
      return w.f32(tag.v);
    case "double":
      return w.f64(tag.v);
    case "string":
      return w.string(tag.v);
    case "byteArray":
      w.i32(tag.v.length);
      return w.bytes(tag.v);
    case "intArray":
      w.i32(tag.v.length);
      for (let i = 0; i < tag.v.length; i++) w.i32(tag.v[i]);
      return;
    case "longArray": {
      const n = tag.words.length >> 1;
      w.i32(n);
      for (let i = 0; i < n; i++) {
        w.u32(tag.words[2 * i + 1]);
        w.u32(tag.words[2 * i]);
      }
      return;
    }
    case "list":
      w.u8(IDS[tag.elem]);
      w.i32(tag.v.length);
      for (const item of tag.v) payload(w, item);
      return;
    case "compound":
      for (const [name, child] of Object.entries(tag.v)) {
        w.u8(IDS[child.t]);
        w.string(name);
        payload(w, child);
      }
      w.u8(0);
      return;
  }
}
function writeNbt(rootName, root) {
  const w = new Writer();
  w.u8(IDS.compound);
  w.string(rootName);
  payload(w, compound(root));
  return w.result();
}
var TYPED_NUMBER = /^(-?\d+(?:\.\d+)?)([bslfdBSLFD])$/;
function jsonToTag(value) {
  if (typeof value === "boolean") return byte(value ? 1 : 0);
  if (typeof value === "number") return Number.isInteger(value) ? int(value) : double(value);
  if (typeof value === "string") {
    const m = TYPED_NUMBER.exec(value);
    if (m) {
      const n = Number(m[1]);
      switch (m[2].toLowerCase()) {
        case "b":
          return byte(n);
        case "s":
          return short(n);
        case "l":
          return long(BigInt(Math.trunc(n)));
        case "f":
          return { t: "float", v: n };
        default:
          return double(n);
      }
    }
    return str(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(jsonToTag);
    return list(items[0]?.t ?? "compound", items);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonToTag(v);
    return compound(out);
  }
  return str("");
}

// packages/formats/src/writers.ts
var AUTHOR = "VibeSchem";
function dataVersionOf(v) {
  return v.dataVersion ?? 1343;
}
function varintBlockData(data) {
  let size = 0;
  for (let i = 0; i < data.length; i++)
    size += data[i] < 128 ? 1 : data[i] < 16384 ? 2 : 3;
  const out = new Uint8Array(size);
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    let v = data[i];
    while (v >= 128) {
      out[p++] = v & 127 | 128;
      v >>>= 7;
    }
    out[p++] = v;
  }
  return out;
}
function spongePalette(volume) {
  const out = {};
  volume.palette.forEach((state, i) => {
    out[state] = int(i);
  });
  return out;
}
function checkSize(volume) {
  if (volume.sizeX > 65535 || volume.sizeY > 65535 || volume.sizeZ > 65535) {
    throw new Error("Schematic dimensions must be at most 65535 per axis.");
  }
}
function writeSpongeV2(input) {
  const { volume, anchor } = input;
  checkSize(volume);
  const blockEntities = volume.blockEntities.map((be) => {
    const data = jsonToTag(be.data);
    return compound({
      Id: str(be.id),
      Pos: intArray(be.pos),
      ...data.t === "compound" ? data.v : {}
    });
  });
  const root = {
    Version: int(2),
    DataVersion: int(dataVersionOf(input.version)),
    Metadata: compound({
      Name: str(input.name),
      Author: str(input.author ?? AUTHOR),
      Date: long(Date.now()),
      WEOffsetX: int(-anchor[0]),
      WEOffsetY: int(-anchor[1]),
      WEOffsetZ: int(-anchor[2])
    }),
    Width: short(volume.sizeX << 16 >> 16),
    Height: short(volume.sizeY << 16 >> 16),
    Length: short(volume.sizeZ << 16 >> 16),
    Offset: intArray([0, 0, 0]),
    PaletteMax: int(volume.palette.length),
    Palette: compound(spongePalette(volume)),
    BlockData: byteArray(varintBlockData(volume.data)),
    BlockEntities: list("compound", blockEntities)
  };
  return { buffer: gzipSync(writeNbt("Schematic", root)), warnings: [] };
}
function writeSpongeV3(input) {
  const { volume, anchor } = input;
  checkSize(volume);
  const blockEntities = volume.blockEntities.map(
    (be) => compound({ Id: str(be.id), Pos: intArray(be.pos), Data: jsonToTag(be.data) })
  );
  const schematic = {
    Version: int(3),
    DataVersion: int(dataVersionOf(input.version)),
    Metadata: compound({
      Name: str(input.name),
      Author: str(input.author ?? AUTHOR),
      Date: long(Date.now()),
      WorldEdit: compound({ Origin: intArray([0, 0, 0]) })
    }),
    Width: short(volume.sizeX << 16 >> 16),
    Height: short(volume.sizeY << 16 >> 16),
    Length: short(volume.sizeZ << 16 >> 16),
    Offset: intArray([-anchor[0], -anchor[1], -anchor[2]]),
    Blocks: compound({
      Palette: compound(spongePalette(volume)),
      Data: byteArray(varintBlockData(volume.data)),
      BlockEntities: list("compound", blockEntities)
    })
  };
  return { buffer: gzipSync(writeNbt("", { Schematic: compound(schematic) })), warnings: [] };
}
function legacyTileId(name, version) {
  if (version.dataVersion !== null && version.dataVersion >= 819) return `minecraft:${name}`;
  const map = {
    chest: "Chest",
    trapped_chest: "Chest",
    furnace: "Furnace",
    sign: "Sign",
    wall_sign: "Sign",
    hopper: "Hopper",
    dispenser: "Trap",
    dropper: "Dropper",
    beacon: "Beacon",
    skull: "Skull",
    flower_pot: "FlowerPot",
    banner: "Banner"
  };
  return map[name] ?? name;
}
function writeMcEdit(input) {
  const { volume, anchor } = input;
  if (volume.sizeX > 32767 || volume.sizeY > 32767 || volume.sizeZ > 32767) {
    throw new Error("Legacy .schematic dimensions must be at most 32767 per axis.");
  }
  const ids = new Int32Array(volume.palette.length);
  const metas = new Int32Array(volume.palette.length);
  const unmapped = /* @__PURE__ */ new Set();
  volume.palette.forEach((state, i) => {
    if (i === 0) return;
    const legacy = toLegacyIdMeta(state);
    if (!legacy) {
      unmapped.add(blockNameOf(state));
      return;
    }
    ids[i] = legacy.id;
    metas[i] = legacy.meta;
  });
  const n = volume.data.length;
  const blocks2 = new Uint8Array(n);
  const data = new Uint8Array(n);
  let add = null;
  for (let i = 0; i < n; i++) {
    const p = volume.data[i];
    const id = ids[p];
    blocks2[i] = id & 255;
    data[i] = metas[p] & 15;
    if (id > 255) {
      add ??= new Uint8Array((n >> 1) + 1);
      const hi = id >> 8 & 15;
      const j = i >> 1;
      add[j] = (i & 1) === 0 ? add[j] & 240 | hi : add[j] & 15 | hi << 4;
    }
  }
  const tiles = volume.blockEntities.map((be) => {
    const d = jsonToTag(be.data);
    return compound({
      ...d.t === "compound" ? d.v : {},
      id: str(legacyTileId(blockNameOf(be.id), input.version)),
      x: int(be.pos[0]),
      y: int(be.pos[1]),
      z: int(be.pos[2])
    });
  });
  const root = {
    Width: short(volume.sizeX),
    Height: short(volume.sizeY),
    Length: short(volume.sizeZ),
    Materials: str("Alpha"),
    Blocks: byteArray(blocks2),
    Data: byteArray(data),
    ...add ? { AddBlocks: byteArray(add) } : {},
    TileEntities: list("compound", tiles),
    Entities: list("compound", []),
    WEOriginX: int(0),
    WEOriginY: int(0),
    WEOriginZ: int(0),
    WEOffsetX: int(-anchor[0]),
    WEOffsetY: int(-anchor[1]),
    WEOffsetZ: int(-anchor[2])
  };
  const warnings = unmapped.size ? [`No pre-1.13 equivalent for: ${[...unmapped].join(", ")} (left as air).`] : [];
  return { buffer: gzipSync(writeNbt("Schematic", root)), warnings };
}
function stateCompound(state) {
  const props = propsOf(state);
  const name = state.includes("[") ? state.slice(0, state.indexOf("[")) : state;
  const p = {};
  for (const [k, v] of Object.entries(props)) p[k] = str(v);
  return compound(
    Object.keys(p).length ? { Name: str(name), Properties: compound(p) } : { Name: str(name) }
  );
}
function litematicVersion(dataVersion) {
  if (dataVersion >= 3837) return 7;
  if (dataVersion >= 2860) return 6;
  return 5;
}
function writeLitematic(input) {
  const { volume } = input;
  const dv = dataVersionOf(input.version);
  const paletteSize = volume.palette.length;
  const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, paletteSize))));
  const total = volume.data.length;
  const longs = Math.ceil(total * bits / 64);
  const words = new Uint32Array(longs * 2);
  for (let i = 0; i < total; i++) {
    const v = volume.data[i];
    const bit = i * bits;
    const w = bit >>> 5;
    const off = bit & 31;
    words[w] = (words[w] | v << off) >>> 0;
    if (off + bits > 32) words[w + 1] = (words[w + 1] | v >>> 32 - off) >>> 0;
  }
  let nonAir = 0;
  for (let i = 0; i < total; i++) if (volume.data[i] !== 0) nonAir++;
  const xyz = (x, y, z3) => compound({ x: int(x), y: int(y), z: int(z3) });
  const now = Date.now();
  const tiles = volume.blockEntities.map((be) => {
    const d = jsonToTag(be.data);
    return compound({
      ...d.t === "compound" ? d.v : {},
      id: str(be.id),
      x: int(be.pos[0]),
      y: int(be.pos[1]),
      z: int(be.pos[2])
    });
  });
  const region = compound({
    Position: xyz(0, 0, 0),
    Size: xyz(volume.sizeX, volume.sizeY, volume.sizeZ),
    BlockStatePalette: list("compound", volume.palette.map(stateCompound)),
    BlockStates: { t: "longArray", words },
    TileEntities: list("compound", tiles),
    Entities: list("compound", []),
    PendingBlockTicks: list("compound", []),
    PendingFluidTicks: list("compound", [])
  });
  const root = {
    MinecraftDataVersion: int(dv),
    Version: int(litematicVersion(dv)),
    SubVersion: int(1),
    Metadata: compound({
      Name: str(input.name),
      Author: str(input.author ?? AUTHOR),
      Description: str(input.description ?? ""),
      RegionCount: int(1),
      TotalVolume: int(total),
      TotalBlocks: int(nonAir),
      TimeCreated: long(now),
      TimeModified: long(now),
      EnclosingSize: xyz(volume.sizeX, volume.sizeY, volume.sizeZ)
    }),
    Regions: compound({ [input.name || "Build"]: region })
  };
  return { buffer: gzipSync(writeNbt("", root)), warnings: [] };
}
var STRUCTURE_BLOCK_LIMIT = 48;
function writeStructure(input) {
  const { volume } = input;
  const blocks2 = [];
  const beByIndex = new Map(volume.blockEntities.map((be) => [volume.index(...be.pos), be]));
  let i = 0;
  for (let y = 0; y < volume.sizeY; y++) {
    for (let z3 = 0; z3 < volume.sizeZ; z3++) {
      for (let x = 0; x < volume.sizeX; x++, i++) {
        const be = beByIndex.get(i);
        const entry = {
          state: int(volume.data[i]),
          pos: list("int", [int(x), int(y), int(z3)])
        };
        if (be) {
          const d = jsonToTag(be.data);
          entry.nbt = compound({ ...d.t === "compound" ? d.v : {}, id: str(be.id) });
        }
        blocks2.push(compound(entry));
      }
    }
  }
  const root = {
    DataVersion: int(dataVersionOf(input.version)),
    size: list("int", [int(volume.sizeX), int(volume.sizeY), int(volume.sizeZ)]),
    palette: list("compound", volume.palette.map(stateCompound)),
    blocks: list("compound", blocks2),
    entities: list("compound", [])
  };
  const warnings = [];
  if (Math.max(volume.sizeX, volume.sizeY, volume.sizeZ) > STRUCTURE_BLOCK_LIMIT) {
    warnings.push(
      `Larger than ${STRUCTURE_BLOCK_LIMIT} blocks on a side: a structure block can't load it; use /place template (1.19+).`
    );
  }
  return { buffer: gzipSync(writeNbt("", root)), warnings };
}

// packages/formats/src/index.ts
var FORMAT_EXTENSIONS = {
  schem: ".schem",
  schem3: ".schem",
  schematic: ".schematic",
  litematic: ".litematic",
  nbt: ".nbt",
  materials: ".csv"
};
function formatsFor(version) {
  const legacy = version.legacy;
  const dv = version.dataVersion ?? 0;
  const info = (id, available, recommended, reason) => ({
    id,
    extension: FORMAT_EXTENSIONS[id],
    available,
    recommended: available && recommended,
    ...available ? {} : { reason }
  });
  return [
    info("schem", !legacy, !legacy, "Sponge .schem needs Minecraft 1.13+; use .schematic."),
    info(
      "schem3",
      !legacy && dv >= 3700,
      false,
      "Sponge v3 needs WorldEdit 7.3+ (Minecraft 1.20.4+)."
    ),
    info(
      "schematic",
      legacy,
      legacy,
      "The legacy .schematic format is only for Minecraft 1.8\u20131.12."
    ),
    info("litematic", !legacy, false, "Litematica exports here target 1.13+."),
    info("nbt", !legacy, false, "Structure files with modern block states need 1.13+."),
    info("materials", true, false)
  ];
}
function safeFilename(name) {
  const cleaned = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().replace(/[^A-Za-z0-9-_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return cleaned || "build";
}
function exportBuild(format, input) {
  const fmt = formatsFor(input.version).find((f) => f.id === format);
  if (!fmt) throw new Error(`Unknown export format "${format}".`);
  if (!fmt.available) throw new Error(fmt.reason ?? `Format ${format} is not available.`);
  const base = safeFilename(input.name);
  const filename = `${base}${fmt.extension}`;
  switch (format) {
    case "schem":
      return { ...writeSpongeV2(input), filename, mime: "application/octet-stream" };
    case "schem3":
      return { ...writeSpongeV3(input), filename, mime: "application/octet-stream" };
    case "schematic":
      return { ...writeMcEdit(input), filename, mime: "application/octet-stream" };
    case "litematic":
      return { ...writeLitematic(input), filename, mime: "application/octet-stream" };
    case "nbt":
      return { ...writeStructure(input), filename, mime: "application/octet-stream" };
    case "materials": {
      const cat = getCatalog(input.version);
      const csv = materialListCsv(materialList(input.volume), (item) => cat.displayName(item));
      return {
        buffer: Buffer.from(csv, "utf8"),
        filename: `${base}_materials.csv`,
        mime: "text/csv",
        warnings: []
      };
    }
  }
}

// apps/server/src/assets/augment.ts
var FAMILY_SUFFIXES = [
  "_wall_hanging_sign",
  "_hanging_sign",
  "_wall_sign",
  "_sign",
  "_fence_gate",
  "_pressure_plate",
  "_trapdoor",
  "_stairs",
  "_slab",
  "_wall",
  "_fence",
  "_door",
  "_button",
  "_bars",
  "_chain",
  "_lantern",
  "_wall_torch",
  "_torch",
  "_log",
  "_wood",
  "_leaves",
  "_sapling",
  "_pane",
  "_candle",
  "_bulb",
  "_shelf"
];
function propsFromBlockstate(bs) {
  const values = /* @__PURE__ */ new Map();
  const add = (k, v) => {
    const list2 = values.get(k) ?? [];
    for (const part of v.split("|")) if (!list2.includes(part)) list2.push(part);
    values.set(k, list2);
  };
  const walk = (cond) => {
    for (const [k, v] of Object.entries(cond)) {
      if (k === "OR" || k === "AND") v.forEach(walk);
      else add(k, String(v));
    }
  };
  const b = bs;
  for (const key of Object.keys(b.variants ?? {})) {
    if (!key || key === "normal") continue;
    for (const pair of key.split(",")) {
      const [k, v] = pair.split("=");
      if (k && v !== void 0) add(k, v);
    }
  }
  for (const part of b.multipart ?? []) if (part.when) walk(part.when);
  return [...values.entries()].sort((a, c) => a[0].localeCompare(c[0])).map(([k, v]) => [k, v, 0]);
}
function augmentCatalog(catalog, pack) {
  const added = [];
  const known = catalog.names();
  for (const [name, bs] of Object.entries(pack.blockstates)) {
    if (catalog.has(name)) continue;
    const suffix = FAMILY_SUFFIXES.find((s) => name.endsWith(s));
    const sibling = suffix ? known.find(
      (n) => n.endsWith(suffix) && !FAMILY_SUFFIXES.some((s) => s !== suffix && s.endsWith(suffix) && n.endsWith(s))
    ) : void 0;
    const props = sibling && catalog.propSpec(sibling) || propsFromBlockstate(bs);
    if (catalog.augment(name, props)) added.push(name);
  }
  return added;
}

// apps/server/src/openBrowser.ts
import { spawn } from "node:child_process";
var lastOpened = 0;
function openViewer(url) {
  if (process.env.MSL_NO_BROWSER === "1") return;
  const now = Date.now();
  if (now - lastOpened < 2e4) return;
  lastOpened = now;
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
  }
}

// apps/server/src/render/renderIsometric.ts
import { createCanvas as createCanvas2 } from "@napi-rs/canvas";
function fillPolygon(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++)
    ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}
function shadeHex(hex, k) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round((n >> 16 & 255) * k);
  const g = Math.round((n >> 8 & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}
var defaultColors = (state) => {
  const c = colorFor(state);
  const hex = c.startsWith("#") ? c : "#888888";
  return { top: hex, side: hex };
};
function renderIsometric(volume, colors = defaultColors, maxSize = 1100) {
  const { sizeX: X, sizeY: Y, sizeZ: Z } = volume;
  const span = X + Z;
  let tile = Math.min(
    Math.floor(2 * maxSize / Math.max(1, span)),
    Math.floor(maxSize / Math.max(1, span / 4 + Y / 2)),
    28
  );
  tile = Math.max(2, tile);
  const hw = tile / 2;
  const hh = tile / 4;
  const vh = tile / 2;
  const width = Math.ceil(span * hw) + tile * 2;
  const height = Math.ceil(span * hh + Y * vh) + tile * 2;
  const offsetX = Z * hw + tile;
  const offsetY = Y * vh + tile;
  const canvas = createCanvas2(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#20242c";
  ctx.fillRect(0, 0, width, height);
  const solid = (x, y, z3) => {
    if (x >= X || y >= Y || z3 >= Z) return false;
    const s = volume.palette[volume.getId(x, y, z3)] ?? "";
    return s !== "minecraft:air" && blockShape(s) === "full";
  };
  const colorCache = /* @__PURE__ */ new Map();
  for (let d = 0; d < X + Z - 1; d++) {
    for (let y = 0; y < Y; y++) {
      for (let x = Math.max(0, d - Z + 1); x <= Math.min(X - 1, d); x++) {
        const z3 = d - x;
        const id = volume.getId(x, y, z3);
        if (id === 0) continue;
        if (solid(x + 1, y, z3) && solid(x, y, z3 + 1) && solid(x, y + 1, z3)) continue;
        let c = colorCache.get(id);
        if (!c) {
          const base = colors(volume.palette[id]);
          c = { top: base.top, left: shadeHex(base.side, 0.8), right: shadeHex(base.side, 0.62) };
          colorCache.set(id, c);
        }
        const sx = (x - z3) * hw + offsetX;
        const sy = (x + z3) * hh - y * vh + offsetY;
        if (!solid(x, y + 1, z3))
          fillPolygon(
            ctx,
            [
              [sx, sy - hh],
              [sx + hw, sy],
              [sx, sy + hh],
              [sx - hw, sy]
            ],
            c.top
          );
        if (!solid(x, y, z3 + 1))
          fillPolygon(
            ctx,
            [
              [sx - hw, sy],
              [sx, sy + hh],
              [sx, sy + hh + vh],
              [sx - hw, sy + vh]
            ],
            c.left
          );
        if (!solid(x + 1, y, z3))
          fillPolygon(
            ctx,
            [
              [sx + hw, sy],
              [sx, sy + hh],
              [sx, sy + hh + vh],
              [sx + hw, sy + vh]
            ],
            c.right
          );
      }
    }
  }
  return canvas.toBuffer("image/png");
}

// apps/server/src/core/edits.ts
var EditError = class extends Error {
};
function locate(spec, id) {
  const search = (list2) => {
    for (let i = 0; i < list2.length; i++) {
      const op = list2[i];
      if (op.id === id) return { list: list2, index: i };
      if (op.type === "group") {
        const hit = search(op.operations);
        if (hit) return hit;
      }
    }
    return null;
  };
  const top = search(spec.operations);
  if (top) return top;
  for (const comp of Object.values(spec.components ?? {})) {
    const hit = search(comp.operations);
    if (hit) return hit;
  }
  return null;
}
function allIds(spec) {
  const ids = [];
  const walk = (list2) => {
    for (const op of list2) {
      if (op.id) ids.push(op.id);
      if (op.type === "group") walk(op.operations);
    }
  };
  walk(spec.operations);
  for (const c of Object.values(spec.components ?? {})) walk(c.operations);
  return ids;
}
function need(spec, id) {
  const loc = locate(spec, id);
  if (!loc) {
    const ids = allIds(spec);
    throw new EditError(
      `No operation with id "${id}".${ids.length ? ` Known ids: ${ids.slice(0, 60).join(", ")}` : " Operations have no ids; use patch or add ids."}`
    );
  }
  return loc;
}
function applyEdits(input, edits) {
  const spec = structuredClone(input);
  for (const edit of edits) {
    switch (edit.op) {
      case "add": {
        if (edit.after || edit.before) {
          const loc = need(spec, edit.after ?? edit.before);
          loc.list.splice(loc.index + (edit.after ? 1 : 0), 0, ...edit.operations);
        } else if (edit.into) {
          const loc = need(spec, edit.into);
          const target = loc.list[loc.index];
          if (target.type !== "group") throw new EditError(`"${edit.into}" is not a group.`);
          target.operations.push(...edit.operations);
        } else {
          spec.operations.push(...edit.operations);
        }
        break;
      }
      case "replace": {
        const loc = need(spec, edit.id);
        loc.list[loc.index] = edit.with;
        break;
      }
      case "update": {
        const loc = need(spec, edit.id);
        const merged = { ...loc.list[loc.index] };
        for (const [k, v] of Object.entries(edit.set)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        loc.list[loc.index] = merged;
        break;
      }
      case "remove": {
        for (const id of edit.ids) {
          const loc = need(spec, id);
          loc.list.splice(loc.index, 1);
        }
        break;
      }
      case "palette": {
        spec.palette ??= {};
        for (const [k, v] of Object.entries(edit.set)) {
          if (v === null) delete spec.palette[k];
          else spec.palette[k] = v;
        }
        break;
      }
      case "component": {
        spec.components ??= {};
        if (edit.set === null) delete spec.components[edit.name];
        else spec.components[edit.name] = edit.set;
        break;
      }
      case "meta": {
        Object.assign(spec, edit.set);
        break;
      }
      default:
        throw new EditError(`Unknown edit op "${edit.op}".`);
    }
  }
  return spec;
}

// apps/server/src/core/BuildService.ts
var UserError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var augmented = /* @__PURE__ */ new Set();
var BuildService = class {
  constructor(store, assets, hub, capture, config) {
    this.store = store;
    this.assets = assets;
    this.hub = hub;
    this.capture = capture;
    this.config = config;
  }
  current = null;
  volumeCache = null;
  feedbackSeq = 0;
  /** Reopen the last project so the viewer shows it right away. */
  async init() {
    const id = this.store.currentId ?? this.store.list()[0]?.id;
    if (!id) return;
    try {
      await this.open(id, false);
    } catch {
    }
  }
  async compile(spec) {
    const version = resolveVersion(spec.minecraftVersion);
    if (version && blockDataIsOlder(version) && !augmented.has(version.id)) {
      try {
        const pack = await this.assets.ensure(assetVersionFor(version));
        augmentCatalog(getCatalog(version), pack.data);
        augmented.add(version.id);
      } catch {
      }
    }
    try {
      return { ok: true, result: compileBuildSpec(spec, { scriptRunner: nodeScriptRunner }) };
    } catch (error) {
      if (error instanceof BuildSpecError) return { ok: false, errors: error.errors };
      throw error;
    }
  }
  activate(project, record, result) {
    const build = {
      project,
      record,
      result,
      buildId: `${project.id}@${record.n}`,
      assetVersion: assetVersionFor(result.version)
    };
    this.current = build;
    this.volumeCache = null;
    this.store.currentId = project.id;
    this.hub.broadcast({
      type: "build",
      buildId: build.buildId,
      projectId: project.id,
      n: record.n
    });
    void this.assets.ensure(build.assetVersion).catch(() => void 0);
    return build;
  }
  async commit(spec, label, newProject) {
    this.hub.broadcast({ type: "compiling", label });
    const compiled = await this.compile(spec);
    if (!compiled.ok) {
      this.hub.broadcast({ type: "build-error", errors: compiled.errors });
      return compiled;
    }
    const result = compiled.result;
    const project = newProject || !this.current ? this.store.create(spec.name, spec.minecraftVersion) : this.current.project;
    const record = this.store.addVersion(project.id, {
      label,
      createdAt: Date.now(),
      spec: result.spec,
      blockCount: result.blockCount,
      size: [result.volume.sizeX, result.volume.sizeY, result.volume.sizeZ]
    });
    const build = this.activate(this.store.get(project.id), record, result);
    if (newProject) this.hub.broadcast({ type: "projects" });
    return { ok: true, build };
  }
  create(spec, opts = {}) {
    const s = spec;
    return this.commit(s, opts.label ?? "Initial build", opts.newProject ?? true);
  }
  async edit(opts) {
    const cur = this.requireCurrent();
    let spec = cur.record.spec;
    try {
      if (opts.edits?.length) spec = applyEdits(spec, opts.edits);
      if (opts.patch?.length)
        spec = jsonpatch.applyPatch(structuredClone(spec), opts.patch, true, false).newDocument;
    } catch (error) {
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
    return this.commit(spec, opts.label ?? "Edit", false);
  }
  async restore(n) {
    const cur = this.requireCurrent();
    const record = this.store.getVersion(cur.project.id, n);
    return this.commit(record.spec, `Restored v${n}`, false);
  }
  /** Try the build in another Minecraft version; applied only when every block exists there. */
  async changeVersion(version, apply) {
    const cur = this.requireCurrent();
    const spec = { ...cur.record.spec, minecraftVersion: version };
    if (!apply) {
      const compiled = await this.compile(spec);
      return compiled.ok ? { ok: true, build: cur } : compiled;
    }
    return this.commit(spec, `Minecraft ${version}`, false);
  }
  async open(projectId, broadcastProjects = true) {
    const latest = this.store.latestVersion(projectId);
    if (!latest) throw new UserError(`Project ${projectId} has no builds yet.`, 404);
    const compiled = await this.compile(latest.spec);
    if (!compiled.ok)
      throw new UserError(
        `The latest version no longer compiles: ${compiled.errors.join("; ")}`,
        422
      );
    const build = this.activate(this.store.get(projectId), latest, compiled.result);
    if (broadcastProjects) this.hub.broadcast({ type: "projects" });
    return build;
  }
  requireCurrent() {
    if (!this.current) throw new UserError("There is no build yet. Create one first.", 409);
    return this.current;
  }
  header() {
    const b = this.current;
    if (!b) return null;
    const v = b.result.volume;
    return {
      buildId: b.buildId,
      projectId: b.project.id,
      n: b.record.n,
      name: b.record.spec.name,
      ...b.record.spec.description ? { description: b.record.spec.description } : {},
      minecraftVersion: b.result.version.id,
      assetVersion: b.assetVersion,
      size: [v.sizeX, v.sizeY, v.sizeZ],
      origin: v.origin,
      anchor: b.result.anchor,
      palette: v.palette,
      blockCount: b.result.blockCount,
      warnings: b.result.warnings,
      compileMs: b.result.compileMs,
      createdAt: b.record.createdAt
    };
  }
  /** Gzipped Uint16 palette indices (YZX), cached per build. */
  volumeGz() {
    const b = this.requireCurrent();
    if (this.volumeCache?.buildId !== b.buildId) {
      const data = b.result.volume.data;
      this.volumeCache = {
        buildId: b.buildId,
        gz: gzipSync2(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { level: 4 })
      };
    }
    return this.volumeCache.gz;
  }
  /** What is at a spec position, and which operation put it there. */
  inspectAt(pos) {
    const b = this.requireCurrent();
    const v = b.result.volume;
    const lx = pos[0] - v.origin[0];
    const ly = pos[1] - v.origin[1];
    const lz = pos[2] - v.origin[2];
    if (!v.inBounds(lx, ly, lz)) return { pos, state: "minecraft:air", source: null };
    const i = v.index(lx, ly, lz);
    const state = v.palette[v.data[i]] ?? "minecraft:air";
    const prov = v.prov[i];
    return { pos, state, source: prov ? b.result.provTable[prov] ?? null : null };
  }
  /**
   * Text slices of a region (spec coordinates), one character per block with a legend — a precise
   * way for Claude to read what is where.
   */
  inspectRegion(from, to, axis2 = "y", maxChars = 12e3) {
    const b = this.requireCurrent();
    const v = b.result.volume;
    const lo = [
      Math.min(from[0], to[0]),
      Math.min(from[1], to[1]),
      Math.min(from[2], to[2])
    ];
    const hi = [
      Math.max(from[0], to[0]),
      Math.max(from[1], to[1]),
      Math.max(from[2], to[2])
    ];
    const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@^~<>/|";
    const legend = /* @__PURE__ */ new Map();
    const sources = /* @__PURE__ */ new Map();
    const glyph = (state) => {
      if (state === "minecraft:air") return ".";
      let g = legend.get(state);
      if (!g) {
        g = glyphs[legend.size] ?? "!";
        legend.set(state, g);
      }
      return g;
    };
    const lines = [];
    const get = (x, y, z3) => {
      const lx = x - v.origin[0];
      const ly = y - v.origin[1];
      const lz = z3 - v.origin[2];
      if (!v.inBounds(lx, ly, lz)) return ".";
      const i = v.index(lx, ly, lz);
      const state = v.palette[v.data[i]] ?? "minecraft:air";
      const p = v.prov[i];
      if (p && state !== "minecraft:air") {
        const src = b.result.provTable[p] ?? "";
        const set = sources.get(src) ?? /* @__PURE__ */ new Set();
        set.add(blockNameOf(state));
        sources.set(src, set);
      }
      return glyph(state);
    };
    if (axis2 === "y") {
      for (let y = hi[1]; y >= lo[1]; y--) {
        lines.push(`y=${y}  (rows z=${lo[2]}..${hi[2]}, columns x=${lo[0]}..${hi[0]})`);
        for (let z3 = lo[2]; z3 <= hi[2]; z3++) {
          let row = "";
          for (let x = lo[0]; x <= hi[0]; x++) row += get(x, y, z3);
          lines.push(`${String(z3).padStart(5)} ${row}`);
        }
      }
    } else if (axis2 === "z") {
      for (let z3 = lo[2]; z3 <= hi[2]; z3++) {
        lines.push(`z=${z3}  (rows y=${hi[1]}..${lo[1]} top-down, columns x=${lo[0]}..${hi[0]})`);
        for (let y = hi[1]; y >= lo[1]; y--) {
          let row = "";
          for (let x = lo[0]; x <= hi[0]; x++) row += get(x, y, z3);
          lines.push(`${String(y).padStart(5)} ${row}`);
        }
      }
    } else {
      for (let x = lo[0]; x <= hi[0]; x++) {
        lines.push(`x=${x}  (rows y=${hi[1]}..${lo[1]} top-down, columns z=${lo[2]}..${hi[2]})`);
        for (let y = hi[1]; y >= lo[1]; y--) {
          let row = "";
          for (let z3 = lo[2]; z3 <= hi[2]; z3++) row += get(x, y, z3);
          lines.push(`${String(y).padStart(5)} ${row}`);
        }
      }
    }
    let body = lines.join("\n");
    if (body.length > maxChars)
      body = `${body.slice(0, maxChars)}
\u2026 (truncated: inspect a smaller region)`;
    const legendText = [...legend.entries()].map(([s, g]) => `${g} = ${s.replace("minecraft:", "")}`).join("\n");
    const srcText = [...sources.entries()].slice(0, 30).map(([src, names]) => `${src}: ${[...names].slice(0, 6).join(", ")}`).join("\n");
    return `Legend (. = air):
${legendText}

Placed by:
${srcText}

${body}`;
  }
  // ---------------------------------------------------------------- feedback
  feedback() {
    const b = this.current;
    return b ? this.store.feedback(b.project.id) : [];
  }
  saveFeedback(items) {
    const b = this.requireCurrent();
    this.store.saveFeedback(b.project.id, items);
    this.hub.broadcast({ type: "feedback", items });
  }
  addFeedback(input) {
    const b = this.requireCurrent();
    let source;
    let block;
    if (input.pos) {
      const hit = this.inspectAt(input.pos);
      source = hit.source ?? void 0;
      block = hit.state;
    }
    const item = {
      id: `fb${Date.now().toString(36)}${(++this.feedbackSeq).toString(36)}`,
      createdAt: Date.now(),
      status: "open",
      kind: input.kind ?? "note",
      text: input.text.slice(0, 2e3),
      n: b.record.n,
      ...input.pos ? { pos: input.pos } : {},
      ...input.region ? { region: input.region } : {},
      ...block ? { block } : {},
      ...source ? { source } : {},
      ...input.targetVersion ? { targetVersion: input.targetVersion } : {}
    };
    this.saveFeedback([...this.feedback(), item]);
    return item;
  }
  resolveFeedback(ids, reply) {
    const items = this.feedback().map(
      (f) => ids.includes(f.id) ? { ...f, status: "resolved", resolvedAt: Date.now(), ...reply ? { reply } : {} } : f
    );
    this.saveFeedback(items);
    return items.filter((f) => ids.includes(f.id));
  }
  deleteFeedback(id) {
    this.saveFeedback(this.feedback().filter((f) => f.id !== id));
  }
  // ---------------------------------------------------------------- export
  formats() {
    const b = this.requireCurrent();
    return formatsFor(b.result.version);
  }
  export(format) {
    const b = this.requireCurrent();
    return exportBuild(format, {
      name: b.record.spec.name,
      volume: b.result.volume,
      version: b.result.version,
      anchor: b.result.anchor,
      ...b.record.spec.description ? { description: b.record.spec.description } : {}
    });
  }
  exportTargets() {
    const mc = minecraftDir();
    return [
      {
        id: "worldedit",
        label: "WorldEdit (single player)",
        path: join4(mc, "config", "worldedit", "schematics"),
        exists: existsSync4(join4(mc, "config", "worldedit"))
      },
      {
        id: "litematica",
        label: "Litematica",
        path: join4(mc, "schematics"),
        exists: existsSync4(join4(mc, "schematics")) || existsSync4(join4(mc, "config", "litematica"))
      },
      {
        id: "downloads",
        label: "Downloads",
        path: join4(homedir2(), "Downloads"),
        exists: existsSync4(join4(homedir2(), "Downloads"))
      }
    ];
  }
  saveExport(format, targetId) {
    const target = this.exportTargets().find((t) => t.id === targetId);
    if (!target) throw new UserError(`Unknown destination "${targetId}".`);
    const out = this.export(format);
    mkdirSync2(target.path, { recursive: true });
    const path = join4(target.path, out.filename);
    writeFileSync3(path, out.buffer);
    return { path, warnings: out.warnings };
  }
  // ---------------------------------------------------------------- rendering
  colorSource() {
    const b = this.current;
    const pack = b ? this.assets.peek(b.assetVersion) : void 0;
    if (!pack) return defaultColors;
    const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;
    return (state) => {
      const c = pack.baker.colors(state);
      return c ? { top: hex(c.top), side: hex(c.side) } : defaultColors(state);
    };
  }
  /** Real textured views from the open viewer; flat-colour fallback when there is none. */
  async render(opts) {
    const b = this.requireCurrent();
    if (this.hub.count === 0) {
      openViewer(`${this.config.baseUrl}/`);
      await this.hub.waitForClient(15e3);
    }
    if (this.hub.count > 0) {
      try {
        const images = await this.capture.request({
          buildId: b.buildId,
          views: opts.views,
          ...opts.focus ? { focus: opts.focus } : {},
          ...opts.cutY !== void 0 ? { cutY: opts.cutY } : {},
          size: opts.size ?? 720,
          pins: opts.pins ?? true
        });
        return { images, fallback: false };
      } catch (error) {
        const png = renderIsometric(b.result.volume, this.colorSource());
        return {
          images: [{ view: "iso", png }],
          fallback: true,
          note: `Viewer render failed (${error instanceof Error ? error.message : String(error)}); flat-colour isometric fallback.`
        };
      }
    }
    return {
      images: [{ view: "iso", png: renderIsometric(b.result.volume, this.colorSource()) }],
      fallback: true,
      note: "No browser viewer connected; flat-colour isometric fallback."
    };
  }
  focus(from, to, message) {
    this.hub.broadcast({ type: "focus", from, to, ...message ? { message } : {} });
  }
  // ---------------------------------------------------------------- projects
  projects() {
    return this.store.list();
  }
  history() {
    const b = this.requireCurrent();
    return this.store.history(b.project.id);
  }
  rename(id, name) {
    const p = this.store.rename(id, name);
    this.hub.broadcast({ type: "projects" });
    return p;
  }
  remove(id) {
    this.store.remove(id);
    if (this.current?.project.id === id) {
      this.current = null;
      this.store.currentId = null;
      this.hub.broadcast({ type: "build", buildId: "", projectId: "", n: 0 });
    }
    this.hub.broadcast({ type: "projects" });
  }
  /** Compact text summary used in tool results. */
  summary(build) {
    const v = build.result.volume;
    const counts = [...v.counts().entries()];
    const byName = /* @__PURE__ */ new Map();
    for (const [s, n] of counts) byName.set(blockNameOf(s), (byName.get(blockNameOf(s)) ?? 0) + n);
    const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => `${name} \xD7${n.toLocaleString("en-US")}`).join(", ");
    const lines = [
      `Build "${build.record.spec.name}" v${build.record.n} (project ${build.project.id}) \xB7 Minecraft ${build.result.version.id} \xB7 ${v.sizeX}\xD7${v.sizeY}\xD7${v.sizeZ} (origin ${v.origin.join(",")}) \xB7 ${build.result.blockCount.toLocaleString("en-US")} blocks \xB7 ${byName.size} block types \xB7 compiled in ${build.result.compileMs} ms`,
      `Top materials: ${top || "\u2014"}`
    ];
    if (build.result.warnings.length)
      lines.push(`Warnings:
- ${build.result.warnings.join("\n- ")}`);
    const open = this.feedback().filter((f) => f.status === "open").length;
    if (open)
      lines.push(`${open} open feedback note(s) from the user in the viewer: call get_feedback.`);
    lines.push(`Viewer: ${this.config.baseUrl}/ (${this.hub.count} open)`);
    return lines.join("\n");
  }
};

// apps/server/src/core/CaptureBroker.ts
var CaptureBroker = class {
  constructor(hub) {
    this.hub = hub;
  }
  pending = /* @__PURE__ */ new Map();
  seq = 0;
  async request(req, timeoutMs = 25e3) {
    const client = this.hub.best();
    if (!client) throw new Error("No viewer is open.");
    const requestId = `cap${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The viewer did not answer in time."));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.hub.send(client, { type: "capture", request: { ...req, requestId } });
    });
  }
  fulfill(requestId, images, error) {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    if (images) p.resolve(images);
    else p.reject(new Error(error ?? "Capture failed."));
    return true;
  }
};

// apps/server/src/core/EventHub.ts
var EventHub = class {
  clients = /* @__PURE__ */ new Map();
  seq = 0;
  waiters = [];
  add(res) {
    const id = `v${++this.seq}`;
    const client = {
      id,
      res,
      connectedAt: Date.now(),
      lastActive: Date.now(),
      visible: true,
      camera: null
    };
    this.clients.set(id, client);
    res.on("close", () => this.clients.delete(id));
    for (const w of this.waiters.splice(0)) w();
    return client;
  }
  send(client, event) {
    client.res.write(`data: ${JSON.stringify(event)}

`);
  }
  broadcast(event) {
    for (const c of this.clients.values()) this.send(c, event);
  }
  update(id, patch) {
    const c = this.clients.get(id);
    if (!c) return;
    Object.assign(c, patch);
    c.lastActive = Date.now();
  }
  get count() {
    return this.clients.size;
  }
  /** The tab the user is most likely looking at. */
  best() {
    let best = null;
    for (const c of this.clients.values()) {
      if (!best) best = c;
      else if (c.visible !== best.visible) best = c.visible ? c : best;
      else if (c.lastActive > best.lastActive) best = c;
    }
    return best;
  }
  /** Resolve when a viewer connects (or after timeoutMs). */
  waitForClient(timeoutMs) {
    if (this.clients.size > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.clients.size > 0), timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
  heartbeat() {
    for (const c of this.clients.values()) c.res.write(": ping\n\n");
  }
};

// apps/server/src/core/ProjectStore.ts
import {
  existsSync as existsSync5,
  mkdirSync as mkdirSync3,
  readdirSync,
  readFileSync as readFileSync3,
  renameSync as renameSync2,
  writeFileSync as writeFileSync4
} from "node:fs";
import { join as join5 } from "node:path";
function slug(name) {
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return s || "build";
}
function writeJson(path, value) {
  writeFileSync4(`${path}.tmp`, JSON.stringify(value, null, 1));
  renameSync2(`${path}.tmp`, path);
}
var ProjectStore = class {
  root = appDir("projects");
  dir(id) {
    return join5(this.root, id);
  }
  read(id) {
    const file = join5(this.dir(id), "project.json");
    if (!existsSync5(file)) throw new Error(`Project not found: ${id}`);
    return JSON.parse(readFileSync3(file, "utf8"));
  }
  write(p) {
    writeJson(join5(this.dir(p.id), "project.json"), p);
  }
  list() {
    if (!existsSync5(this.root)) return [];
    const out = [];
    for (const id of readdirSync(this.root)) {
      try {
        const { history: _history, ...info } = this.read(id);
        out.push(info);
      } catch {
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  get(id) {
    const { history: _history, ...info } = this.read(id);
    return info;
  }
  exists(id) {
    return existsSync5(join5(this.dir(id), "project.json"));
  }
  create(name, minecraftVersion) {
    const base = slug(name);
    let id = base;
    for (let i = 2; existsSync5(this.dir(id)); i++) id = `${base}-${i}`;
    mkdirSync3(join5(this.dir(id), "versions"), { recursive: true });
    const now = Date.now();
    const p = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      minecraftVersion,
      versions: 0,
      blockCount: 0,
      history: []
    };
    this.write(p);
    return this.get(id);
  }
  history(id) {
    return this.read(id).history;
  }
  getVersion(id, n) {
    const file = join5(this.dir(id), "versions", `${String(n).padStart(4, "0")}.json`);
    if (!existsSync5(file)) throw new Error(`Version ${n} of ${id} not found.`);
    return JSON.parse(readFileSync3(file, "utf8"));
  }
  latestVersion(id) {
    const p = this.read(id);
    const last = p.history[p.history.length - 1];
    return last ? this.getVersion(id, last.n) : null;
  }
  addVersion(id, record) {
    const p = this.read(id);
    const n = (p.history[p.history.length - 1]?.n ?? 0) + 1;
    const full = { ...record, n };
    writeJson(join5(this.dir(id), "versions", `${String(n).padStart(4, "0")}.json`), full);
    const { spec: _spec, ...summary } = full;
    p.history.push(summary);
    p.versions = p.history.length;
    p.updatedAt = full.createdAt;
    p.name = record.spec.name;
    p.minecraftVersion = record.spec.minecraftVersion;
    p.blockCount = record.blockCount;
    this.write(p);
    return full;
  }
  rename(id, name) {
    const p = this.read(id);
    p.name = name;
    this.write(p);
    return this.get(id);
  }
  /** Moves the project to <home>/trash (recoverable by hand). */
  remove(id) {
    const trash = appDir("trash");
    renameSync2(this.dir(id), join5(trash, `${id}-${Date.now()}`));
  }
  feedback(id) {
    const file = join5(this.dir(id), "feedback.json");
    if (!existsSync5(file)) return [];
    return JSON.parse(readFileSync3(file, "utf8"));
  }
  saveFeedback(id, items) {
    writeJson(join5(this.dir(id), "feedback.json"), items);
  }
  get currentId() {
    const file = join5(appHome(), "state.json");
    if (!existsSync5(file)) return null;
    try {
      const id = JSON.parse(readFileSync3(file, "utf8")).current ?? null;
      return id && this.exists(id) ? id : null;
    } catch {
      return null;
    }
  }
  set currentId(id) {
    writeJson(join5(appHome(), "state.json"), { current: id });
  }
};

// apps/server/src/http/server.ts
import { existsSync as existsSync6 } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
var FORMATS = /* @__PURE__ */ new Set(["schem", "schem3", "schematic", "litematic", "nbt", "materials"]);
function vec(q, ...keys) {
  const v = keys.map((k) => Number.parseInt(q[k] ?? "", 10));
  if (v.some((n) => Number.isNaN(n))) throw new UserError(`Query needs ${keys.join(", ")}.`);
  return v;
}
async function createHttpServer({
  builds,
  assets,
  hub,
  capture,
  config
}) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
  app.setErrorHandler((error, _req, reply) => {
    const status = error instanceof UserError ? error.status : error.statusCode ?? 500;
    reply.status(status).send({ error: error instanceof Error ? error.message : String(error) });
  });
  app.get("/api/health", async () => ({
    ok: true,
    name: "vibeschem",
    version: APP_VERSION
  }));
  app.get("/api/events", (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    const client = hub.add(res);
    hub.send(client, {
      type: "hello",
      clientId: client.id,
      buildId: builds.current?.buildId ?? null
    });
    req.raw.on("close", () => res.end());
  });
  app.post("/api/client/:id/state", async (req) => {
    const { id } = req.params;
    const body = req.body ?? {};
    hub.update(id, {
      ...body.visible !== void 0 ? { visible: body.visible } : {},
      ...body.camera ? { camera: body.camera } : {}
    });
    return { ok: true };
  });
  app.get("/api/build", async () => ({ build: builds.header() }));
  app.post("/api/build", async (req, reply) => {
    const { spec, newProject, label } = req.body ?? {};
    const out = await builds.create(spec ?? req.body, {
      newProject: newProject ?? true,
      ...label ? { label } : {}
    });
    if (!out.ok) return reply.status(422).send({ ok: false, errors: out.errors });
    return { ok: true, summary: builds.summary(out.build), build: builds.header() };
  });
  app.post("/api/build/edit", async (req, reply) => {
    const { edits, patch, label } = req.body ?? {};
    const out = await builds.edit({
      ...edits ? { edits } : {},
      ...patch ? { patch } : {},
      ...label ? { label } : {}
    });
    if (!out.ok) return reply.status(422).send({ ok: false, errors: out.errors });
    return { ok: true, summary: builds.summary(out.build), build: builds.header() };
  });
  app.get("/api/render.png", async (req, reply) => {
    const q = req.query;
    const parse = (v) => v.split(",").map(Number);
    const r = await builds.render({
      views: q.views?.split(",") ?? ["iso"],
      size: Number(q.size ?? 640),
      ...q.cutY ? { cutY: Number(q.cutY) } : {},
      ...q.from && q.to ? { focus: { from: parse(q.from), to: parse(q.to) } } : {}
    });
    return reply.header("content-type", "image/png").send(r.images[0]?.png);
  });
  app.get("/api/build/volume", async (req, reply) => {
    const { buildId } = req.query;
    const cur = builds.requireCurrent();
    if (buildId && buildId !== cur.buildId)
      throw new UserError("That build is no longer current.", 409);
    return reply.header("content-type", "application/octet-stream").header("content-encoding", "gzip").header("cache-control", "no-store").send(builds.volumeGz());
  });
  app.get(
    "/api/build/inspect",
    async (req) => builds.inspectAt(vec(req.query, "x", "y", "z"))
  );
  app.get("/api/build/spec", async () => builds.requireCurrent().record.spec);
  app.post("/api/build/version", async (req, reply) => {
    const { version, apply } = req.body ?? {};
    if (!version) throw new UserError('Missing "version".');
    const out = await builds.changeVersion(version, Boolean(apply));
    if (!out.ok) return reply.status(422).send({ ok: false, errors: out.errors });
    return { ok: true, build: builds.header() };
  });
  app.get(
    "/api/versions",
    async () => listVersions().map((v) => ({
      id: v.id,
      major: v.major,
      legacy: v.legacy,
      dataVersion: v.dataVersion
    }))
  );
  app.get("/api/history", async () => builds.current ? builds.history() : []);
  app.post("/api/history/restore", async (req, reply) => {
    const { n } = req.body ?? {};
    const out = await builds.restore(Number(n));
    if (!out.ok) return reply.status(422).send({ ok: false, errors: out.errors });
    return { ok: true };
  });
  app.get("/api/projects", async () => ({
    current: builds.current?.project.id ?? null,
    projects: builds.projects()
  }));
  app.post("/api/projects/:id/open", async (req) => {
    const { id } = req.params;
    await builds.open(id);
    return { ok: true };
  });
  app.post("/api/projects/:id/rename", async (req) => {
    const { id } = req.params;
    const { name } = req.body ?? {};
    if (!name?.trim()) throw new UserError('Missing "name".');
    return builds.rename(id, name.trim());
  });
  app.delete("/api/projects/:id", async (req) => {
    const { id } = req.params;
    builds.remove(id);
    return { ok: true };
  });
  app.get("/api/feedback", async () => builds.feedback());
  app.post("/api/feedback", async (req) => {
    const body = req.body ?? {};
    if (!body.text?.trim()) throw new UserError("Write what you would like to change.");
    return builds.addFeedback({ ...body, text: body.text.trim() });
  });
  app.post("/api/feedback/:id/resolve", async (req) => {
    const { id } = req.params;
    return builds.resolveFeedback([id]);
  });
  app.delete("/api/feedback/:id", async (req) => {
    const { id } = req.params;
    builds.deleteFeedback(id);
    return { ok: true };
  });
  app.get("/api/export", async () => ({
    formats: builds.formats(),
    targets: builds.exportTargets()
  }));
  app.get("/api/export/:format", async (req, reply) => {
    const { format } = req.params;
    if (!FORMATS.has(format)) throw new UserError(`Unknown format "${format}".`);
    const out = builds.export(format);
    return reply.header("content-type", out.mime).header("content-disposition", `attachment; filename="${out.filename}"`).header("x-export-warnings", encodeURIComponent(out.warnings.join(" | "))).send(out.buffer);
  });
  app.post("/api/export/:format/save", async (req) => {
    const { format } = req.params;
    const { target } = req.body ?? {};
    if (!FORMATS.has(format)) throw new UserError(`Unknown format "${format}".`);
    return builds.saveExport(format, target ?? "downloads");
  });
  app.get("/api/assets/:version/status", async (req) => {
    const { version } = req.params;
    return assets.getStatus(version);
  });
  app.get("/api/assets/:version/manifest", async (req) => {
    const { version } = req.params;
    const pack = await assets.ensure(version);
    return pack.data.manifest;
  });
  app.get("/api/assets/:version/atlas.png", async (req, reply) => {
    const { version } = req.params;
    const pack = await assets.ensure(version);
    return reply.header("content-type", "image/png").header("cache-control", "public, max-age=86400").send(pack.atlas);
  });
  app.post("/api/assets/:version/models", async (req) => {
    const { version } = req.params;
    const { states } = req.body ?? {};
    if (!Array.isArray(states)) throw new UserError('Missing "states".');
    return assets.bake(version, states.slice(0, 2e4));
  });
  app.post("/api/capture/:requestId", async (req) => {
    const { requestId } = req.params;
    const body = req.body ?? {};
    const images = body.images?.map((i) => ({
      view: i.view,
      png: Buffer.from(i.png.replace(/^data:image\/png;base64,/, ""), "base64")
    }));
    return { ok: capture.fulfill(requestId, images ?? null, body.error) };
  });
  if (existsSync6(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) return reply.sendFile("index.html");
      return reply.status(404).send({ error: `Not found: ${req.method} ${req.url}` });
    });
  }
  setInterval(() => hub.heartbeat(), 2e4).unref();
  return app;
}

// apps/server/src/mcp/server.ts
import { existsSync as existsSync7, readdirSync as readdirSync2, readFileSync as readFileSync4 } from "node:fs";
import { join as join6 } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z as z2 } from "zod";
var INSTRUCTIONS = `VibeSchem builds Minecraft structures from a BuildSpec (JSON) and shows them in a live 3D viewer in the user's browser, textured with the real game's blocks. The user looks at the viewer; you look at renders returned by the tools.

New build:
1. Once per session, before your first build, call read_guide("workflow") \u2014 it is short and sets the bar for quality. Read read_guide("spec") for the BuildSpec language, and the topic guides you need (roofs, styles, palettes, details, landscape, scripts).
2. Plan like an expert builder (massing, palette, proportions, depth), then call create_build with the complete spec. Prefer components + repeat/symmetry, palette mixes and scripts over long lists of single blocks.
3. create_build returns a rendered preview: critique it like a builder (silhouette, depth, texture, roof, grounding, scale) and fix weak spots with edit_build before you present it. render_views gives more angles, close-ups and sections.
4. Then tell the user in a few sentences what you built and that it's in the viewer, where they can export it.

Changes: when the user asks to change something, call get_feedback first \u2014 they can pin notes on blocks in the viewer, and each note says which operation placed that block. Edit with edit_build by operation id, then resolve_feedback with a one-line reply.

Rules: minecraftVersion is strict \u2014 only blocks that exist in that version are accepted; errors suggest alternatives and list_blocks checks availability. Coordinates: +X east, +Y up, +Z south (north = -Z); y=0 is ground level. Give every operation a short "id".`;
var GUIDE_TOPICS = [
  "workflow",
  "spec",
  "principles",
  "roofs",
  "styles",
  "palettes",
  "details",
  "landscape",
  "scripts",
  "versions",
  "examples"
];
var vec32 = z2.tuple([z2.number().int(), z2.number().int(), z2.number().int()]);
var VIEW_NAMES = [
  "iso",
  "iso_nw",
  "iso_ne",
  "iso_sw",
  "front",
  "back",
  "left",
  "right",
  "top",
  "user"
];
function text(t) {
  return { type: "text", text: t };
}
function errorResult(message) {
  return { content: [text(message)], isError: true };
}
async function guarded(fn) {
  try {
    return await fn();
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
function buildMcpServer({ builds, config }) {
  const server = new McpServer(
    { name: "vibeschem", version: APP_VERSION },
    { instructions: INSTRUCTIONS }
  );
  const outcome = async (out, preview) => {
    if (!out.ok) {
      return errorResult(
        `The spec was not applied \u2014 fix these and call again:
- ${out.errors.join("\n- ")}`
      );
    }
    const content = [text(builds.summary(out.build))];
    if (preview) {
      const r = await builds.render({ views: ["iso"], size: 760 });
      for (const img of r.images)
        content.push({ type: "image", data: img.png.toString("base64"), mimeType: "image/png" });
      if (r.note) content.push(text(r.note));
    } else {
      openViewerIfClosed();
    }
    return { content };
  };
  const openViewerIfClosed = () => openViewer(`${config.baseUrl}/`);
  server.registerTool(
    "read_guide",
    {
      title: "Read building guide",
      description: `Expert building guides and the full BuildSpec reference. Topics: ${GUIDE_TOPICS.join(", ")}. Start with "workflow"; read "spec" before writing your first BuildSpec.`,
      inputSchema: { topic: z2.enum(GUIDE_TOPICS) },
      annotations: { readOnlyHint: true }
    },
    async ({ topic }) => guarded(async () => {
      const file = join6(config.guidesDir, `${topic}.md`);
      if (!existsSync7(file)) {
        const have = existsSync7(config.guidesDir) ? readdirSync2(config.guidesDir).join(", ") : "none";
        return errorResult(`Guide "${topic}" not found (available: ${have}).`);
      }
      return { content: [text(readFileSync4(file, "utf8"))] };
    })
  );
  server.registerTool(
    "create_build",
    {
      title: "Create build",
      description: 'Compile a BuildSpec and show it in the live viewer (opens the browser if needed). Returns a summary and a rendered preview image. Starts a new project (with its own version history) unless newProject is false, which replaces the current build as a new version. Errors (unknown blocks for the version, bad fields) come back as a list to fix. BuildSpec: {name, minecraftVersion, palette?, components?, operations:[{type, id, \u2026}]}; operation types: box, line, cylinder, cone, sphere, dome, polygon, roof, arch, blocks, layers, terrain, tree, scatter, replace, group, place, script \u2014 see read_guide("spec").',
      inputSchema: {
        spec: z2.record(z2.string(), z2.unknown()).describe("The BuildSpec object."),
        newProject: z2.boolean().optional().describe("Default true. false = new version of the current project."),
        label: z2.string().optional().describe("Short name for this version in the history."),
        preview: z2.boolean().optional().describe("Return a rendered image (default true).")
      }
    },
    async ({ spec, newProject, label, preview }) => guarded(
      async () => outcome(
        await builds.create(spec, {
          newProject: newProject ?? true,
          ...label ? { label } : {}
        }),
        preview ?? true
      )
    )
  );
  server.registerTool(
    "edit_build",
    {
      title: "Edit build",
      description: 'Change the current build without resending it; saved as a new version. "edits" (preferred) target operations by id: {op:"add", operations, after?|before?|into?: id} \xB7 {op:"replace", id, with} \xB7 {op:"update", id, set:{field: value|null}} \xB7 {op:"remove", ids} \xB7 {op:"palette", set:{key: entry|null}} \xB7 {op:"component", name, set} \xB7 {op:"meta", set:{name?, minecraftVersion?, anchor?, \u2026}}. "patch" accepts RFC 6902 JSON Patch on the spec for anything else.',
      inputSchema: {
        edits: z2.array(z2.object({ op: z2.string() }).passthrough()).optional(),
        patch: z2.array(z2.object({ op: z2.string(), path: z2.string() }).passthrough()).optional(),
        label: z2.string().optional(),
        preview: z2.boolean().optional().describe("Return a rendered image (default true).")
      }
    },
    async ({ edits, patch, label, preview }) => guarded(
      async () => outcome(
        await builds.edit({
          ...edits ? { edits } : {},
          ...patch ? { patch } : {},
          ...label ? { label } : {}
        }),
        preview ?? true
      )
    )
  );
  server.registerTool(
    "get_build",
    {
      title: "Get current build",
      description: "Summary of the current build (size, materials, warnings, open feedback) and, with spec: true, the full BuildSpec \u2014 use it to continue work started in another session.",
      inputSchema: { spec: z2.boolean().optional() },
      annotations: { readOnlyHint: true }
    },
    async ({ spec }) => guarded(async () => {
      const cur = builds.requireCurrent();
      const content = [text(builds.summary(cur))];
      if (spec) content.push(text(JSON.stringify(cur.record.spec)));
      return { content };
    })
  );
  server.registerTool(
    "render_views",
    {
      title: "Render views",
      description: "Render the current build with real textures, in one image. views: iso (front-right, default), iso_nw, iso_ne, iso_sw, front (south), back, left (west), right (east), top, user (what the user is looking at right now). focus: frame a region {from, to} for a close-up. cutY: hide everything above this y to see inside (section).",
      inputSchema: {
        views: z2.array(z2.enum(VIEW_NAMES)).max(4).optional(),
        focus: z2.object({ from: vec32, to: vec32 }).optional(),
        cutY: z2.number().int().optional(),
        size: z2.number().int().min(256).max(1400).optional().describe("Pixel size of each view (default 640).")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ views, focus, cutY, size }) => guarded(async () => {
      const r = await builds.render({
        views: views ?? ["iso", "iso_nw"],
        ...focus ? { focus: { from: focus.from, to: focus.to } } : {},
        ...cutY !== void 0 ? { cutY } : {},
        size: size ?? 640
      });
      const content = r.images.map((img) => ({
        type: "image",
        data: img.png.toString("base64"),
        mimeType: "image/png"
      }));
      if (r.note) content.push(text(r.note));
      return { content };
    })
  );
  server.registerTool(
    "get_feedback",
    {
      title: "Get user feedback",
      description: "The notes the user pinned in the viewer (on a block or a region), with the block there and the id/path of the operation that placed it, plus requests like switching Minecraft version. Call this whenever the user asks for changes. By default also returns an image with the pins drawn.",
      inputSchema: {
        all: z2.boolean().optional().describe("Include resolved notes."),
        image: z2.boolean().optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ all, image }) => guarded(async () => {
      const open = builds.feedback().filter((f) => f.status === "open").sort((a, b) => a.createdAt - b.createdAt);
      const items = all ? builds.feedback() : open;
      if (items.length === 0)
        return {
          content: [
            text("No open feedback notes. The user may describe changes in chat instead.")
          ]
        };
      const lines = items.map((f) => {
        const where = f.region ? `region ${f.region.from.join(",")} \u2192 ${f.region.to.join(",")}` : f.pos ? `at ${f.pos.join(",")}` : "whole build";
        const num = open.indexOf(f) + 1;
        const parts = [
          `${num ? `#${num} ` : ""}[${f.id}] (${f.status}, v${f.n ?? "?"}) ${where}: "${f.text}"`
        ];
        if (f.block) parts.push(`   block: ${f.block.replace("minecraft:", "")}`);
        if (f.source) parts.push(`   placed by: ${f.source}`);
        if (f.targetVersion) parts.push(`   wants Minecraft ${f.targetVersion}`);
        if (f.reply) parts.push(`   your reply: ${f.reply}`);
        return parts.join("\n");
      });
      const content = [text(lines.join("\n"))];
      const pinned = open.filter((f) => f.pos || f.region);
      if ((image ?? true) && pinned.length > 0) {
        const pts = pinned.flatMap(
          (f) => f.region ? [f.region.from, f.region.to] : [f.pos]
        );
        const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])) - 6);
        const hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) + 6);
        const r = await builds.render({
          views: ["user", "iso"],
          size: 640,
          pins: true,
          focus: { from: lo, to: hi }
        });
        for (const img of r.images)
          content.push({
            type: "image",
            data: img.png.toString("base64"),
            mimeType: "image/png"
          });
      }
      return { content };
    })
  );
  server.registerTool(
    "resolve_feedback",
    {
      title: "Resolve feedback",
      description: "Mark feedback notes as done after addressing them; the reply is shown to the user next to the note.",
      inputSchema: { ids: z2.array(z2.string()).min(1), reply: z2.string().optional() }
    },
    async ({ ids, reply }) => guarded(async () => {
      const done = builds.resolveFeedback(ids, reply);
      return { content: [text(`Resolved ${done.length} note(s).`)] };
    })
  );
  server.registerTool(
    "inspect",
    {
      title: "Inspect blocks",
      description: 'Read exactly what is in the build. With only "from": the block at that spot and the operation that placed it. With "from" and "to": text slices of the region (one character per block + legend + which operations placed what), along axis y (floor plans, default), z (front elevations) or x (side elevations). Keep regions small (\u2264 ~40\xD740 per slice).',
      inputSchema: { from: vec32, to: vec32.optional(), axis: z2.enum(["y", "z", "x"]).optional() },
      annotations: { readOnlyHint: true }
    },
    async ({ from, to, axis: axis2 }) => guarded(async () => {
      if (!to) {
        const hit = builds.inspectAt(from);
        return {
          content: [
            text(
              `${from.join(",")}: ${hit.state}${hit.source ? `
placed by: ${hit.source}` : ""}`
            )
          ]
        };
      }
      return { content: [text(builds.inspectRegion(from, to, axis2 ?? "y"))] };
    })
  );
  server.registerTool(
    "list_blocks",
    {
      title: "List blocks",
      description: `Check blocks against a Minecraft version (default: the current build's). "query" searches names (e.g. "deepslate stairs"); "names" checks exact blocks and shows their properties, or when they were added if missing. Also lists the supported versions when called with versions: true.`,
      inputSchema: {
        query: z2.string().optional(),
        names: z2.array(z2.string()).max(60).optional(),
        version: z2.string().optional(),
        versions: z2.boolean().optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ query, names, version, versions }) => guarded(async () => {
      if (versions) {
        const majors = /* @__PURE__ */ new Map();
        for (const v of listVersions())
          majors.set(v.major, [...majors.get(v.major) ?? [], v.id]);
        return {
          content: [
            text([...majors.entries()].map(([m, ids]) => `${m}: ${ids.join(", ")}`).join("\n"))
          ]
        };
      }
      const vid = version ?? builds.current?.result.version.id ?? LATEST_VERSION.id;
      const info = resolveVersion(vid);
      if (!info) return errorResult(`Unknown version "${vid}".`);
      const cat = getCatalog(info);
      const lines = [`Minecraft ${info.id} (${cat.size} blocks)`];
      if (query) {
        const hits = cat.search(query, 80);
        lines.push(hits.length ? hits.join(", ") : `No block matches "${query}".`);
      }
      for (const raw of names ?? []) {
        const name = raw.replace(/^minecraft:/, "").replace(/\[.*$/, "");
        const real = cat.resolveName(name);
        if (real) {
          const props = cat.props(real) ?? [];
          lines.push(
            `\u2713 ${real}${real !== name ? ` (named ${real} in this version)` : ""}${props.length ? ` [${props.map((p) => `${p.name}=${p.values.join("|")}`).join(", ")}]` : ""}`
          );
        } else {
          const since = blockAddedIn(name);
          lines.push(
            `\u2717 ${name}: ${since ? `added in ${since}` : "unknown"}${cat.suggest(name, 3).length ? ` \u2014 try ${cat.suggest(name, 3).join(", ")}` : ""}`
          );
        }
      }
      return { content: [text(lines.join("\n"))] };
    })
  );
  server.registerTool(
    "export_build",
    {
      title: "Export build",
      description: "Export the current build. Formats: schem (Sponge v2, WorldEdit 7+/FAWE, 1.13+, default), schem3 (Sponge v3, WorldEdit 7.3+), schematic (MCEdit, WorldEdit 6 for 1.8\u20131.12), litematic (Litematica), nbt (vanilla structure block / /place template), materials (CSV shopping list). saveTo writes the file straight into the player's Minecraft folder: worldedit (config/worldedit/schematics, single player), litematica (schematics/) or downloads. Without saveTo returns a download link. The viewer has an Export button too.",
      inputSchema: {
        format: z2.enum(["schem", "schem3", "schematic", "litematic", "nbt", "materials"]).optional(),
        saveTo: z2.enum(["worldedit", "litematica", "downloads"]).optional()
      }
    },
    async ({ format, saveTo }) => guarded(async () => {
      const formats = builds.formats();
      const fmt = format ?? formats.find((f) => f.recommended)?.id ?? "schem";
      if (saveTo) {
        const saved = builds.saveExport(fmt, saveTo);
        return {
          content: [
            text(
              `Saved ${saved.path}${saved.warnings.length ? `
Warnings: ${saved.warnings.join("; ")}` : ""}`
            )
          ]
        };
      }
      const out = builds.export(fmt);
      const targets = builds.exportTargets().filter((t) => t.exists).map((t) => `${t.id} (${t.path})`);
      return {
        content: [
          text(
            `${out.filename} (${(out.buffer.length / 1024).toFixed(1)} KB): ${config.baseUrl}/api/export/${fmt}` + (out.warnings.length ? `
Warnings: ${out.warnings.join("; ")}` : "") + (targets.length ? `
Can also save directly to: ${targets.join(", ")}` : "")
          )
        ]
      };
    })
  );
  server.registerTool(
    "history",
    {
      title: "Version history",
      description: "List the saved versions of the current project, or restore one (restoring adds a new version, nothing is lost).",
      inputSchema: {
        action: z2.enum(["list", "restore"]),
        n: z2.number().int().positive().optional()
      }
    },
    async ({ action, n }) => guarded(async () => {
      if (action === "restore") {
        if (!n) return errorResult("Pass n, the version to restore.");
        return outcome(await builds.restore(n), true);
      }
      const rows = builds.history().map(
        (v) => `v${v.n} ${new Date(v.createdAt).toISOString().slice(0, 16).replace("T", " ")} \xB7 ${v.label} \xB7 ${v.size.join("\xD7")} \xB7 ${v.blockCount} blocks`
      );
      return { content: [text(rows.join("\n") || "No versions yet.")] };
    })
  );
  server.registerTool(
    "projects",
    {
      title: "Projects",
      description: "List saved projects, open one in the viewer (it becomes the current build), or rename one.",
      inputSchema: {
        action: z2.enum(["list", "open", "rename"]),
        id: z2.string().optional(),
        name: z2.string().optional()
      }
    },
    async ({ action, id, name }) => guarded(async () => {
      if (action === "open") {
        if (!id) return errorResult("Pass the project id.");
        const b = await builds.open(id);
        return { content: [text(builds.summary(b))] };
      }
      if (action === "rename") {
        if (!id || !name) return errorResult("Pass id and name.");
        builds.rename(id, name);
        return { content: [text(`Renamed to "${name}".`)] };
      }
      const cur = builds.current?.project.id;
      const rows = builds.projects().map(
        (p) => `${p.id === cur ? "\u25B6 " : "  "}${p.id} \xB7 "${p.name}" \xB7 ${p.minecraftVersion} \xB7 ${p.versions} versions \xB7 ${p.blockCount} blocks \xB7 ${new Date(p.updatedAt).toISOString().slice(0, 10)}`
      );
      return { content: [text(rows.join("\n") || "No projects yet.")] };
    })
  );
  server.registerTool(
    "focus_view",
    {
      title: "Point the viewer",
      description: "Move the user's viewer camera to a region and highlight it, optionally with a short message \u2014 to show them what you mean or changed.",
      inputSchema: { from: vec32, to: vec32.optional(), message: z2.string().max(200).optional() }
    },
    async ({ from, to, message }) => guarded(async () => {
      builds.focus(from, to ?? from, message);
      return { content: [text("Done.")] };
    })
  );
  return server;
}
async function startMcpServer(deps) {
  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());
  return server;
}

// apps/server/src/index.ts
function isPortFree(host, port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}
async function findOpenPort(host, start, attempts = 20) {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(host, port)) return port;
  }
  return start;
}
async function listen(app, config) {
  for (let attempt = 0; ; attempt++) {
    config.port = await findOpenPort(config.host, config.port);
    config.baseUrl = `http://${config.host}:${config.port}`;
    try {
      await app.listen({ host: config.host, port: config.port });
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt >= 20) throw error;
      config.port += 1;
    }
  }
}
async function main() {
  const config = loadConfig();
  const hub = new EventHub();
  const assets = new AssetStore(
    (s) => hub.broadcast({
      type: "assets",
      version: s.version,
      state: s.state,
      ...s.message ? { message: s.message } : {},
      ...s.progress !== void 0 ? { progress: s.progress } : {}
    })
  );
  const capture = new CaptureBroker(hub);
  const builds = new BuildService(new ProjectStore(), assets, hub, capture, config);
  await builds.init();
  const app = await createHttpServer({ builds, assets, hub, capture, config });
  await listen(app, config);
  if (config.mcpMode) {
    await startMcpServer({ builds, config });
    const note = existsSync8(config.webDist) ? "" : ' (run "pnpm build" once to enable the browser viewer)';
    process.stderr.write(
      `vibeschem: MCP ready; viewer on ${config.baseUrl}${note}
`
    );
  } else {
    process.stdout.write(`vibeschem listening on ${config.baseUrl}
`);
  }
}
main().catch((error) => {
  process.stderr.write(
    `Fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}
`
  );
  process.exit(1);
});
