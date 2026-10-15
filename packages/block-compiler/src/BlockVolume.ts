export const AIR = 'minecraft:air';

/** Return [min, max] of a pair. */
export function sortPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

export interface BlockEntityData {
  /** Block entity id, e.g. "minecraft:chest". */
  id: string;
  /** Local position inside the volume. */
  pos: [number, number, number];
  data: Record<string, unknown>;
}

/**
 * The compiled build: a dense grid of palette indices in YZX order (x fastest, then z, then y),
 * matching the Sponge/Litematica layouts. Palette index 0 is always air.
 */
export class BlockVolume {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** Spec coordinates of local cell (0,0,0). */
  readonly origin: [number, number, number];
  readonly palette: string[];
  readonly data: Uint16Array;
  /** Which operation wrote each cell (index into provenance table), 0 = none. */
  readonly prov: Uint16Array;
  readonly blockEntities: BlockEntityData[];
  private readonly paletteIndex: Map<string, number>;

  constructor(
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    origin: [number, number, number] = [0, 0, 0],
    palette: string[] = [AIR],
    data?: Uint16Array,
    prov?: Uint16Array,
    blockEntities: BlockEntityData[] = [],
  ) {
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

  get volume(): number {
    return this.sizeX * this.sizeY * this.sizeZ;
  }

  index(x: number, y: number, z: number): number {
    return x + this.sizeX * (z + this.sizeZ * y);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  idFor(state: string): number {
    const hit = this.paletteIndex.get(state);
    if (hit !== undefined) return hit;
    const id = this.palette.length;
    this.palette.push(state);
    this.paletteIndex.set(state, id);
    return id;
  }

  getId(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    return this.data[this.index(x, y, z)] as number;
  }

  getState(x: number, y: number, z: number): string {
    return this.palette[this.getId(x, y, z)] ?? AIR;
  }

  setState(x: number, y: number, z: number, state: string): void {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = this.idFor(state);
  }

  /** Non-air block count per state. */
  counts(): Map<string, number> {
    const byId = new Uint32Array(this.palette.length);
    for (let i = 0; i < this.data.length; i++) (byId[this.data[i] as number] as number)++;
    const out = new Map<string, number>();
    for (let id = 1; id < byId.length; id++) {
      const n = byId[id] as number;
      if (n > 0) out.set(this.palette[id] as string, n);
    }
    return out;
  }

  countBlocks(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== 0) n++;
    return n;
  }

  /** Drop unused palette entries and renumber (air stays 0). Returns a new volume. */
  compact(): BlockVolume {
    const used = new Uint8Array(this.palette.length);
    for (let i = 0; i < this.data.length; i++) used[this.data[i] as number] = 1;
    const remap = new Uint16Array(this.palette.length);
    const palette = [AIR];
    for (let id = 1; id < this.palette.length; id++) {
      if (!used[id]) continue;
      remap[id] = palette.length;
      palette.push(this.palette[id] as string);
    }
    const data = new Uint16Array(this.data.length);
    for (let i = 0; i < data.length; i++) data[i] = remap[this.data[i] as number] as number;
    return new BlockVolume(
      this.sizeX,
      this.sizeY,
      this.sizeZ,
      this.origin,
      palette,
      data,
      this.prov,
      this.blockEntities,
    );
  }

  /** state -> positions, iterating in YZX order. */
  toInstanceGroups(): Record<string, [number, number, number][]> {
    const groups: Record<string, [number, number, number][]> = {};
    let i = 0;
    for (let y = 0; y < this.sizeY; y++) {
      for (let z = 0; z < this.sizeZ; z++) {
        for (let x = 0; x < this.sizeX; x++, i++) {
          const id = this.data[i] as number;
          if (id === 0) continue;
          (groups[this.palette[id] as string] ??= []).push([x, y, z]);
        }
      }
    }
    return groups;
  }
}
