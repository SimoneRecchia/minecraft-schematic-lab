// Approximate display colors for Minecraft block states. Shared by the web 3D preview and the
// server-side isometric PNG renderer so both look consistent. Pure / browser-safe.

interface KeywordColor {
  re: RegExp;
  hex: string;
}

// Order matters: more specific keywords first.
const KEYWORD_COLORS: KeywordColor[] = [
  { re: /glass|pane/, hex: '#a9e0f5' },
  { re: /water/, hex: '#3b6feb' },
  { re: /lava|magma/, hex: '#d8662a' },
  { re: /glowstone|sea_lantern|shroomlight|light|lantern|torch|lamp/, hex: '#f4d27a' },
  { re: /mossy/, hex: '#6f7f53' },
  { re: /cobble/, hex: '#7c7c7c' },
  { re: /stone_brick|brick_stone/, hex: '#8a8a8a' },
  { re: /deepslate/, hex: '#3b3b40' },
  { re: /blackstone|basalt|obsidian/, hex: '#2b2b33' },
  { re: /andesite|gravel/, hex: '#9a9a9a' },
  { re: /diorite|quartz|calcite/, hex: '#e7e5dd' },
  { re: /granite/, hex: '#9a6a5a' },
  { re: /stone|smooth_stone/, hex: '#8f8f8f' },
  { re: /dark_oak|stripped_spruce/, hex: '#4b3621' },
  { re: /spruce/, hex: '#6f4f2a' },
  { re: /birch/, hex: '#d8c896' },
  { re: /acacia/, hex: '#b5642e' },
  { re: /jungle/, hex: '#9b6b3f' },
  { re: /crimson/, hex: '#7b3a4b' },
  { re: /warped/, hex: '#2c8374' },
  { re: /oak|plank|log|wood|fence|stripped/, hex: '#9c7a48' },
  { re: /brick/, hex: '#9b5b4a' },
  { re: /netherrack|nether/, hex: '#6e3334' },
  { re: /dirt|coarse|podzol|mud|clay/, hex: '#7a5a3a' },
  { re: /grass|moss|leaves|vine|fern/, hex: '#5d8a3a' },
  { re: /sand|sandstone/, hex: '#dcd0a0' },
  { re: /red_sand/, hex: '#bd6b3a' },
  { re: /snow|powder_snow/, hex: '#eef3f6' },
  { re: /ice/, hex: '#9fd0ff' },
  { re: /wool|concrete|terracotta|glazed/, hex: '#b0795a' },
  { re: /iron/, hex: '#d8d8d8' },
  { re: /gold/, hex: '#f4d35e' },
  { re: /diamond/, hex: '#5fded0' },
  { re: /emerald/, hex: '#37c87a' },
  { re: /redstone/, hex: '#b32d2d' },
  { re: /coal/, hex: '#2a2a2a' },
  { re: /copper/, hex: '#c1714b' },
];

// Minecraft dye colors, for colored variants (concrete, wool, terracotta, stained glass, …),
// where the color is a prefix of the id, e.g. "red_concrete", "light_blue_wool".
const DYE_COLORS: Record<string, string> = {
  white: '#e3e6e6',
  light_gray: '#8e8e86',
  gray: '#3f4448',
  black: '#1a1c20',
  brown: '#7a4d2b',
  red: '#a52722',
  orange: '#f07613',
  yellow: '#f8c627',
  lime: '#64ab18',
  green: '#5a7d1d',
  cyan: '#158a8f',
  light_blue: '#3ab3da',
  blue: '#3a3cc1',
  purple: '#8a2db5',
  magenta: '#c14cc4',
  pink: '#ed9ab4',
};

// Longest names first so "light_blue"/"light_gray" win over "blue"/"gray".
const DYE_NAMES = Object.keys(DYE_COLORS).sort((a, b) => b.length - a.length);

const COLORED_BLOCK = /concrete|wool|terracotta|stained_glass|carpet|candle|shulker_box|glazed|bed|banner/;

function dyeColorFor(name: string): string | null {
  for (const dye of DYE_NAMES) {
    if (name.startsWith(`${dye}_`)) return DYE_COLORS[dye] ?? null;
  }
  return null;
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return ((h % 360) + 360) % 360;
}

export function isTransparent(state: string): boolean {
  return /glass|pane|ice|slime|honey/.test(state);
}

export function colorFor(state: string): string {
  const s = state.toLowerCase();
  const name = (s.includes(':') ? s.slice(s.indexOf(':') + 1) : s).replace(/\[.*$/, '');
  // Colored variants carry the dye as a prefix — map those first so red/green/blue/… differ.
  if (COLORED_BLOCK.test(name)) {
    const dye = dyeColorFor(name);
    if (dye) return dye;
  }
  for (const { re, hex } of KEYWORD_COLORS) {
    if (re.test(s)) return hex;
  }
  return `hsl(${hashHue(s)}, 42%, 55%)`;
}
