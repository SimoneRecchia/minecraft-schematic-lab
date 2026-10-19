import { blockNameOf, propsOf } from '@minecraft-schematic-lab/catalog';
import { QUAD_STRIDE, type BakedBlock, type BakedVariant } from '@minecraft-schematic-lab/shared';
import type { PackData } from './buildPack';

type V3 = [number, number, number];
type FaceName = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';

interface ModelFace {
  uv?: [number, number, number, number];
  texture: string;
  cullface?: string;
  rotation?: number;
  tintindex?: number;
}

interface ModelElement {
  from: V3;
  to: V3;
  rotation?: { origin: V3; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean };
  shade?: boolean;
  faces: Partial<Record<FaceName, ModelFace>>;
}

interface RawModel {
  parent?: string;
  textures?: Record<string, string>;
  elements?: ModelElement[];
  ambientocclusion?: boolean;
}

interface ResolvedModel {
  textures: Record<string, string>;
  elements: ModelElement[];
  ao: boolean;
}

interface ModelRef {
  model: string;
  x?: number;
  y?: number;
  uvlock?: boolean;
  weight?: number;
}

const DIRS: FaceName[] = ['down', 'up', 'north', 'south', 'west', 'east'];
const DIR_INDEX: Record<string, number> = {
  down: 0,
  up: 1,
  north: 2,
  south: 3,
  west: 4,
  east: 5,
  bottom: 0,
  top: 1,
};
const NORMALS: V3[] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];

// Plains biome colours (what you see in most screenshots).
const GRASS = 0x91bd59;
const FOLIAGE = 0x77ab2f;
const TINTS: [RegExp, number][] = [
  [
    /^(grass_block|short_grass|grass|tall_grass|fern|large_fern|potted_fern|sugar_cane|bush)$/,
    GRASS,
  ],
  [/^spruce_leaves$/, 0x619961],
  [/^birch_leaves$/, 0x80a755],
  [/^(oak_leaves|jungle_leaves|acacia_leaves|dark_oak_leaves|mangrove_leaves|vine)$/, FOLIAGE],
  [/^lily_pad$/, 0x208030],
  [/^(water|water_cauldron|bubble_column)$/, 0x3f76e4],
  [/^leaf_litter$/, 0xa58a4a],
  [/^(attached_)?(melon|pumpkin)_stem$/, 0xe0c71c],
  [/^redstone_wire$/, 0xb40000],
];

/** RedStoneWireBlock.COLORS: dark red unpowered, bright red-orange at 15. */
function wireColor(power: number): number {
  const f = Math.max(0, Math.min(15, power)) / 15;
  const r = f * 0.6 + (f > 0 ? 0.4 : 0.3);
  const g = Math.min(1, Math.max(0, f * f * 0.7 - 0.5));
  const b = Math.min(1, Math.max(0, f * f * 0.6 - 0.7));
  const c = (v: number) => Math.round(v * 255);
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

const SELF_CULL =
  /(^|_)glass$|^ice$|^packed_ice$|^blue_ice$|^slime_block$|^honey_block$|^water$|^lava$|^tinted_glass$/;
const INVISIBLE = /^(air|cave_air|void_air|barrier|light|structure_void|moving_piston)$/;

/** Corners of each face in block space (0..16), order TL, BL, BR, TR as seen from outside. */
function faceCorners(face: FaceName, f: V3, t: V3): V3[] {
  switch (face) {
    case 'north':
      return [
        [t[0], t[1], f[2]],
        [t[0], f[1], f[2]],
        [f[0], f[1], f[2]],
        [f[0], t[1], f[2]],
      ];
    case 'south':
      return [
        [f[0], t[1], t[2]],
        [f[0], f[1], t[2]],
        [t[0], f[1], t[2]],
        [t[0], t[1], t[2]],
      ];
    case 'west':
      return [
        [f[0], t[1], f[2]],
        [f[0], f[1], f[2]],
        [f[0], f[1], t[2]],
        [f[0], t[1], t[2]],
      ];
    case 'east':
      return [
        [t[0], t[1], t[2]],
        [t[0], f[1], t[2]],
        [t[0], f[1], f[2]],
        [t[0], t[1], f[2]],
      ];
    case 'up':
      return [
        [f[0], t[1], f[2]],
        [f[0], t[1], t[2]],
        [t[0], t[1], t[2]],
        [t[0], t[1], f[2]],
      ];
    case 'down':
      return [
        [f[0], f[1], t[2]],
        [f[0], f[1], f[2]],
        [t[0], f[1], f[2]],
        [t[0], f[1], t[2]],
      ];
  }
}

/** Minecraft's default UVs when a face has none: the element's projection onto the face. */
function defaultUv(face: FaceName, f: V3, t: V3): [number, number, number, number] {
  switch (face) {
    case 'down':
      return [f[0], 16 - t[2], t[0], 16 - f[2]];
    case 'up':
      return [f[0], f[2], t[0], t[2]];
    case 'north':
      return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
    case 'south':
      return [f[0], 16 - t[1], t[0], 16 - f[1]];
    case 'west':
      return [f[2], 16 - t[1], t[2], 16 - f[1]];
    case 'east':
      return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
  }
}

/** World-locked UV of a point on a face pointing in direction dir (uvlock). */
function lockedUv(dir: number, p: V3): [number, number] {
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

function rotateAround(p: V3, axis: 'x' | 'y' | 'z', rad: number, o: V3): V3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const x = p[0] - o[0];
  const y = p[1] - o[1];
  const z = p[2] - o[2];
  let r: V3;
  if (axis === 'x') r = [x, y * c - z * s, y * s + z * c];
  else if (axis === 'y') r = [x * c + z * s, y, -x * s + z * c];
  else r = [x * c - y * s, x * s + y * c, z];
  return [r[0] + o[0], r[1] + o[1], r[2] + o[2]];
}

function nearestDir(n: V3): number {
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

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function matches(cond: Record<string, unknown>, props: Record<string, string>): boolean {
  if ('OR' in cond) return (cond.OR as Record<string, unknown>[]).some((c) => matches(c, props));
  if ('AND' in cond) return (cond.AND as Record<string, unknown>[]).every((c) => matches(c, props));
  return Object.entries(cond).every(([k, v]) => {
    const allowed = String(v).split('|');
    return allowed.includes(props[k] ?? '');
  });
}

function variantKeyMatches(key: string, props: Record<string, string>): boolean {
  if (key === '' || key === 'normal') return true;
  return key.split(',').every((pair) => {
    const [k, v] = pair.split('=');
    return props[k as string] === v;
  });
}

const DYES = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
];

/**
 * Turns block states into ready-to-mesh quads using the game's own blockstate + model JSON:
 * parent inheritance, texture variables, element rotation, variant x/y rotation, uvlock,
 * cullfaces, tint indices and weighted random variants. Block-entity blocks the game draws in
 * code (chests, beds, signs, banners, heads) get simple stand-in shapes.
 */
export class ModelBaker {
  private readonly layerOf = new Map<string, number>();
  private readonly resolved = new Map<string, ResolvedModel | null>();
  private readonly cache = new Map<string, BakedBlock>();

  constructor(private readonly pack: PackData) {
    pack.manifest.textures.forEach((n, i) => this.layerOf.set(n, i));
  }

  bake(state: string): BakedBlock {
    const hit = this.cache.get(state);
    if (hit) return hit;
    const baked = this.bakeUncached(state);
    this.cache.set(state, baked);
    return baked;
  }

  private texLayer(ref: string | undefined, textures: Record<string, string>): number {
    let r = ref;
    for (let i = 0; i < 10 && r?.startsWith('#'); i++) r = textures[r.slice(1)];
    if (!r) return 0;
    const name = r
      .replace(/^minecraft:/, '')
      .replace(/^block\//, '')
      .replace(/^blocks\//, '');
    return this.layerOf.get(name) ?? 0;
  }

  private resolve(ref: string): ResolvedModel | null {
    const key = ref.replace(/^minecraft:/, '');
    const hit = this.resolved.get(key);
    if (hit !== undefined) return hit;
    let out: ResolvedModel | null = null;
    const chain: RawModel[] = [];
    let cur: string | undefined = key;
    for (let depth = 0; cur && depth < 16; depth++) {
      const m = this.pack.models[cur] as RawModel | undefined;
      if (!m) break;
      chain.push(m);
      cur = m.parent?.replace(/^minecraft:/, '');
      if (cur && !cur.includes('/')) cur = `block/${cur}`;
    }
    if (chain.length > 0) {
      const textures: Record<string, string> = {};
      let elements: ModelElement[] = [];
      let ao = true;
      for (let i = chain.length - 1; i >= 0; i--) {
        const m = chain[i] as RawModel;
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
  private tintFor(name: string, props?: Record<string, string>): number {
    if (name === 'redstone_wire' && props?.power !== undefined)
      return wireColor(Number(props.power));
    for (const [re, color] of TINTS) if (re.test(name)) return color;
    return -1;
  }

  /** Quads of one model placed with a variant rotation. */
  private bakeModel(
    model: ResolvedModel,
    name: string,
    rx: number,
    ry: number,
    uvlock: boolean,
    out: number[],
    props?: Record<string, string>,
  ): void {
    const center: V3 = [8, 8, 8];
    const tint = this.tintFor(name, props);
    for (const el of model.elements) {
      for (const face of DIRS) {
        const fd = el.faces[face];
        if (!fd) continue;
        let pts = faceCorners(face, el.from, el.to);
        const uv = fd.uv ?? defaultUv(face, el.from, el.to);
        let uvs: [number, number][] = [
          [uv[0], uv[1]],
          [uv[0], uv[3]],
          [uv[2], uv[3]],
          [uv[2], uv[1]],
        ];
        if (fd.rotation) {
          // Texture rotation (clockwise): corners in clockwise order TL, TR, BR, BL.
          const steps = (((fd.rotation / 90) % 4) + 4) % 4;
          const cw = [uvs[0], uvs[3], uvs[2], uvs[1]] as [number, number][];
          const rot = cw.map((_, i) => cw[(i - steps + 4) % 4] as [number, number]);
          uvs = [rot[0], rot[3], rot[2], rot[1]] as [number, number][];
        }
        let normal: V3 = NORMALS[DIR_INDEX[face] as number] as V3;
        if (el.rotation && el.rotation.angle) {
          const r = el.rotation;
          const rad = (r.angle * Math.PI) / 180;
          pts = pts.map((p) => rotateAround(p, r.axis, rad, r.origin));
          if (r.rescale) {
            const k = 1 / Math.cos(rad);
            pts = pts.map((p) => {
              const q = [...p] as V3;
              for (const a of [0, 1, 2] as const) {
                if (
                  (r.axis === 'x' && a === 0) ||
                  (r.axis === 'y' && a === 1) ||
                  (r.axis === 'z' && a === 2)
                )
                  continue;
                q[a] = (p[a] - r.origin[a]) * k + r.origin[a];
              }
              return q;
            });
          }
          normal = rotateAround(normal, r.axis, rad, [0, 0, 0]);
        }
        let cull = fd.cullface !== undefined ? (DIR_INDEX[fd.cullface] ?? -1) : -1;
        if (rx || ry) {
          const radX = (-rx * Math.PI) / 180;
          const radY = (-ry * Math.PI) / 180;
          pts = pts.map((p) => rotateAround(rotateAround(p, 'x', radX, center), 'y', radY, center));
          normal = rotateAround(rotateAround(normal, 'x', radX, [0, 0, 0]), 'y', radY, [0, 0, 0]);
          if (cull >= 0) {
            const cn = rotateAround(
              rotateAround(NORMALS[cull] as V3, 'x', radX, [0, 0, 0]),
              'y',
              radY,
              [0, 0, 0],
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
          fd.tintindex !== undefined && fd.tintindex >= 0 ? tint : -1,
          alpha,
          model.ao ? 1 : 0,
        );
      }
    }
  }

  private isFullOpaque(model: ResolvedModel): boolean {
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

  private bakeUncached(state: string): BakedBlock {
    const name = blockNameOf(state);
    const props = propsOf(state);
    const empty: BakedBlock = { v: [{ w: 1, q: [] }], full: false, self: false };
    if (INVISIBLE.test(name)) return empty;

    if (name === 'water' || name === 'lava' || name === 'bubble_column') {
      const fluid = name === 'lava' ? 'lava' : 'water';
      return {
        ...empty,
        self: true,
        fluid,
        fluidTex: [this.layerOf.get(`${fluid}_still`) ?? 0, this.layerOf.get(`${fluid}_flow`) ?? 0],
        fluidTint: fluid === 'water' ? 0x3f76e4 : -1,
      };
    }

    const bs = this.pack.blockstates[name] as
      | {
          variants?: Record<string, ModelRef | ModelRef[]>;
          multipart?: { when?: Record<string, unknown>; apply: ModelRef | ModelRef[] }[];
        }
      | undefined;
    const variants: { w: number; refs: ModelRef[] }[] = [];
    if (bs?.variants) {
      const key = Object.keys(bs.variants).find((k) => variantKeyMatches(k, props));
      const value = key !== undefined ? bs.variants[key] : undefined;
      if (value) {
        const list = Array.isArray(value) ? value : [value];
        for (const ref of list) variants.push({ w: ref.weight ?? 1, refs: [ref] });
      }
    } else if (bs?.multipart) {
      const refs: ModelRef[] = [];
      for (const part of bs.multipart) {
        if (part.when && !matches(part.when, props)) continue;
        const apply = Array.isArray(part.apply) ? part.apply[0] : part.apply;
        if (apply) refs.push(apply);
      }
      variants.push({ w: 1, refs });
    }

    let full = false;
    const out: BakedVariant[] = [];
    for (const v of variants) {
      const q: number[] = [];
      for (const ref of v.refs) {
        const model = this.resolve(ref.model);
        if (!model) continue;
        if (model.elements.length === 0) continue;
        if (variants.length && out.length === 0 && this.isFullOpaque(model)) full = true;
        this.bakeModel(model, name, ref.x ?? 0, ref.y ?? 0, ref.uvlock ?? false, q, props);
      }
      out.push({ w: v.w, q });
    }

    if (out.every((v) => v.q.length === 0)) {
      const stand = this.standIn(name, props, variants[0]?.refs[0]?.model);
      if (stand) return stand;
    }
    if (props.waterlogged === 'true') {
      for (const v of out) this.waterOverlay(v.q);
    }
    return { v: out.length ? out : [{ w: 1, q: [] }], full, self: SELF_CULL.test(name) };
  }

  private waterOverlay(q: number[]): void {
    const still = this.layerOf.get('water_still') ?? 0;
    const model: ResolvedModel = {
      textures: { w: `block/${this.pack.manifest.textures[still]}` },
      ao: false,
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 14, 16],
          faces: Object.fromEntries(
            DIRS.map((d) => [d, { texture: '#w', cullface: d, tintindex: 0 }]),
          ) as ModelElement['faces'],
        },
      ],
    };
    this.bakeModel(model, 'water', 0, 0, false, q);
  }

  /** Simple shapes for blocks the game renders in code (block entities). */
  private standIn(
    name: string,
    props: Record<string, string>,
    modelRef: string | undefined,
  ): BakedBlock | null {
    const model = modelRef ? this.resolve(modelRef) : null;
    let particle = model?.textures.particle ?? 'block/oak_planks';
    for (let i = 0; i < 5 && particle.startsWith('#'); i++)
      particle = model?.textures[particle.slice(1)] ?? 'block/oak_planks';
    const dye = DYES.find((d) => name.startsWith(`${d}_`));
    const box = (from: V3, to: V3, tex = '#p'): ModelElement => ({
      from,
      to,
      faces: Object.fromEntries(DIRS.map((d) => [d, { texture: tex }])) as ModelElement['faces'],
    });
    const textures: Record<string, string> = {
      p: particle,
      wool: `block/${dye ?? 'white'}_wool`,
      white: 'block/white_wool',
    };
    const facingY: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
    let elements: ModelElement[] = [];
    let ry = facingY[props.facing ?? 'north'] ?? 0;
    if (/chest$/.test(name)) {
      elements = [box([1, 0, 1], [15, 14, 15]), box([7, 7, 0], [9, 11, 1], '#p')];
    } else if (name.endsWith('_bed')) {
      elements = [
        box([0, 3, 0], [16, 9, 16], '#wool'),
        box([0, 0, 0], [3, 3, 3]),
        box([13, 0, 0], [16, 3, 3]),
      ];
      if (props.part === 'head') elements.push(box([2, 9, 1], [14, 11, 7], '#white'));
      ry = (ry + 180) % 360;
    } else if (name.endsWith('_wall_hanging_sign')) {
      elements = [box([1, 0, 7], [15, 10, 9]), box([0, 14, 6], [16, 16, 10])];
    } else if (name.endsWith('_hanging_sign')) {
      elements = [box([1, 0, 7], [15, 10, 9])];
      ry = Number(props.rotation ?? 0) * 22.5;
    } else if (name.endsWith('_wall_sign')) {
      elements = [box([0, 4.5, 14], [16, 12.5, 16])];
    } else if (name.endsWith('_sign')) {
      elements = [box([7.25, 0, 7.25], [8.75, 9.3, 8.75]), box([0, 9.3, 7.25], [16, 17.3, 8.75])];
      ry = Number(props.rotation ?? 0) * 22.5 + 180;
    } else if (name.endsWith('_wall_banner')) {
      elements = [box([1, -14, 14], [15, 14, 15], '#wool'), box([0, 14, 13], [16, 15.5, 16])];
    } else if (name.endsWith('_banner')) {
      elements = [
        box([7.25, 0, 7.25], [8.75, 28, 8.75]),
        box([1, 0, 8.75], [15, 28, 9.75], '#wool'),
        box([0, 28, 7.25], [16, 29.5, 9.25]),
      ];
      ry = Number(props.rotation ?? 0) * 22.5 + 180;
    } else if (/_wall_(head|skull)$/.test(name)) {
      elements = [box([4, 4, 8], [12, 12, 16])];
    } else if (/_(head|skull)$/.test(name)) {
      elements = [box([4, 0, 4], [12, 8, 12])];
      ry = Number(props.rotation ?? 0) * 22.5;
    } else if (name === 'decorated_pot') {
      elements = [box([1, 0, 1], [15, 16, 15])];
    } else if (name === 'conduit') {
      elements = [box([5, 5, 5], [11, 11, 11])];
    } else if (model) {
      elements = [box([0, 0, 0], [16, 16, 16])];
    } else {
      return null;
    }
    const q: number[] = [];
    this.bakeModel({ textures, elements, ao: true }, name, 0, ry, false, q);
    return { v: [{ w: 1, q }], full: false, self: false };
  }

  /** Average top and side colors of a state (for the flat fallback renderer). */
  colors(state: string): { top: number; side: number } | null {
    const baked = this.bake(state);
    const q = baked.v[0]?.q ?? [];
    let top = -1;
    let side = -1;
    for (let i = 0; i < q.length; i += QUAD_STRIDE) {
      const layer = q[i + 20] as number;
      const dir = q[i + 22] as number;
      let color = this.pack.manifest.avg[layer] ?? 0x808080;
      const tint = q[i + 23] as number;
      if (tint >= 0) color = multiply(color, tint);
      if (dir === 1 && top < 0) top = color;
      if (dir >= 2 && side < 0) side = color;
    }
    if (baked.fluid) {
      const c = baked.fluid === 'water' ? 0x3f76e4 : 0xd86a1e;
      return { top: c, side: c };
    }
    if (top < 0 && side < 0) return null;
    return { top: top < 0 ? side : top, side: side < 0 ? top : side };
  }
}

function multiply(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
