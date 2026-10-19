import { deflateSync, gunzipSync, inflateSync } from 'node:zlib';
import { lz4BlockStreamDecode } from './lz4';

export const SECTOR = 4096;
const EXTERNAL = 128;

export interface RawChunk {
  /** Compression: 1 gzip, 2 zlib, 3 none, 4 LZ4 (plus 128 when the payload lives in a .mcc). */
  type: number;
  /** Compressed payload, read from the .mcc file when external. */
  payload: Buffer;
  /** Seconds since the epoch, from the region header. */
  timestamp: number;
}

export function decompressChunk(type: number, payload: Buffer): Buffer {
  switch (type & 0x7f) {
    case 1:
      return gunzipSync(payload);
    case 2:
      return inflateSync(payload);
    case 3:
      return payload;
    case 4:
      return lz4BlockStreamDecode(payload);
    default:
      throw new Error(`Unsupported chunk compression ${type & 0x7f}.`);
  }
}

/**
 * An Anvil region file (r.X.Z.mca): 32×32 chunks, each stored compressed in 4 KiB sectors.
 * Unmodified chunks keep their bytes as they were; changed ones are written back with zlib.
 */
export class RegionFile {
  readonly chunks: (RawChunk | null)[] = new Array<RawChunk | null>(1024).fill(null);

  constructor(
    readonly rx: number,
    readonly rz: number,
  ) {}

  static index(cx: number, cz: number): number {
    return (cx & 31) + (cz & 31) * 32;
  }

  /** Parse a region file; `external(cx, cz)` reads an oversized chunk's c.X.Z.mcc. */
  static parse(
    buf: Buffer,
    rx: number,
    rz: number,
    external?: (cx: number, cz: number) => Buffer | null,
  ): RegionFile {
    const region = new RegionFile(rx, rz);
    if (buf.length < 2 * SECTOR) return region;
    for (let i = 0; i < 1024; i++) {
      const loc = buf.readUInt32BE(i * 4);
      const offset = loc >>> 8;
      const count = loc & 0xff;
      if (offset < 2 || count === 0) continue;
      const start = offset * SECTOR;
      if (start + 5 > buf.length) continue;
      const length = buf.readUInt32BE(start);
      if (length < 1 || start + 4 + length > buf.length) continue;
      const type = buf[start + 4] as number;
      let payload: Buffer | null = buf.subarray(start + 5, start + 4 + length);
      if (type & EXTERNAL) {
        const cx = rx * 32 + (i & 31);
        const cz = rz * 32 + (i >> 5);
        payload = external?.(cx, cz) ?? null;
        if (!payload) continue;
      }
      region.chunks[i] = { type, payload, timestamp: buf.readUInt32BE(SECTOR + i * 4) };
    }
    return region;
  }

  has(cx: number, cz: number): boolean {
    return this.chunks[RegionFile.index(cx, cz)] !== null;
  }

  /** The chunk's NBT bytes, uncompressed, or null when it was never generated. */
  read(cx: number, cz: number): Buffer | null {
    const c = this.chunks[RegionFile.index(cx, cz)];
    return c ? decompressChunk(c.type, c.payload) : null;
  }

  write(cx: number, cz: number, nbt: Buffer, timestamp = Math.floor(Date.now() / 1000)): void {
    this.chunks[RegionFile.index(cx, cz)] = { type: 2, payload: deflateSync(nbt), timestamp };
  }

  /** The region file, plus the .mcc files of chunks too big for 255 sectors (by file name). */
  serialize(): { region: Buffer; external: Map<string, Buffer> } {
    const header = Buffer.alloc(2 * SECTOR);
    const bodies: Buffer[] = [];
    const external = new Map<string, Buffer>();
    let sector = 2;
    for (let i = 0; i < 1024; i++) {
      const c = this.chunks[i];
      if (!c) continue;
      let type = c.type & 0x7f;
      let payload = c.payload;
      if (Math.ceil((payload.length + 5) / SECTOR) > 255) {
        external.set(`c.${this.rx * 32 + (i & 31)}.${this.rz * 32 + (i >> 5)}.mcc`, payload);
        type |= EXTERNAL;
        payload = Buffer.alloc(0);
      }
      const sectors = Math.ceil((payload.length + 5) / SECTOR);
      const body = Buffer.alloc(sectors * SECTOR);
      body.writeUInt32BE(payload.length + 1, 0);
      body[4] = type;
      payload.copy(body, 5);
      header.writeUInt32BE(((sector << 8) | sectors) >>> 0, i * 4);
      header.writeUInt32BE(c.timestamp >>> 0, SECTOR + i * 4);
      bodies.push(body);
      sector += sectors;
    }
    return { region: Buffer.concat([header, ...bodies]), external };
  }
}
