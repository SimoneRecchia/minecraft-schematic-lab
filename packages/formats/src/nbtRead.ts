import { gunzipSync, inflateSync } from 'node:zlib';
import type { Tag, TagType } from './nbt';

const TYPES: (TagType | null)[] = [
  null,
  'byte',
  'short',
  'int',
  'long',
  'float',
  'double',
  'byteArray',
  'string',
  'list',
  'compound',
  'intArray',
  'longArray',
];

/** Java's modified UTF-8 (see encodeModifiedUtf8 in nbt.ts); plain ASCII takes the fast path. */
export function decodeModifiedUtf8(buf: Buffer, start: number, end: number): string {
  let ascii = true;
  for (let i = start; i < end; i++) {
    if ((buf[i] as number) & 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return buf.toString('latin1', start, end);
  const units: number[] = [];
  let i = start;
  while (i < end) {
    const a = buf[i++] as number;
    if (a < 0x80) units.push(a);
    else if ((a & 0xe0) === 0xc0 && i < end) {
      units.push(((a & 0x1f) << 6) | ((buf[i++] as number) & 0x3f));
    } else if ((a & 0xf0) === 0xe0 && i + 1 < end) {
      const b = buf[i++] as number;
      const c = buf[i++] as number;
      units.push(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
    } else if ((a & 0xf8) === 0xf0 && i + 2 < end) {
      // Standard UTF-8 written by other tools: decode it rather than fail.
      const cp =
        ((a & 0x07) << 18) |
        (((buf[i] as number) & 0x3f) << 12) |
        (((buf[i + 1] as number) & 0x3f) << 6) |
        ((buf[i + 2] as number) & 0x3f);
      i += 3;
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else units.push(0xfffd);
  }
  let s = '';
  for (let k = 0; k < units.length; k += 8192)
    s += String.fromCharCode(...units.slice(k, k + 8192));
  return s;
}

/** Big-endian NBT reader producing the same tags the writer takes, so a file round-trips. */
class Reader {
  pos = 0;
  constructor(private readonly buf: Buffer) {}

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new Error('The NBT data ends too early.');
  }
  u8(): number {
    this.need(1);
    return this.buf.readUInt8(this.pos++);
  }
  i8(): number {
    this.need(1);
    return this.buf.readInt8(this.pos++);
  }
  i16(): number {
    this.need(2);
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  string(): string {
    const n = this.u16();
    this.need(n);
    const s = decodeModifiedUtf8(this.buf, this.pos, this.pos + n);
    this.pos += n;
    return s;
  }

  payload(type: TagType, depth: number): Tag {
    if (depth > 512) throw new Error('The NBT data nests too deeply.');
    const b = this.buf;
    switch (type) {
      case 'byte':
        return { t: 'byte', v: this.i8() };
      case 'short':
        return { t: 'short', v: this.i16() };
      case 'int':
        return { t: 'int', v: this.i32() };
      case 'long': {
        this.need(8);
        const v = b.readBigInt64BE(this.pos);
        this.pos += 8;
        return { t: 'long', v };
      }
      case 'float': {
        this.need(4);
        const v = b.readFloatBE(this.pos);
        this.pos += 4;
        return { t: 'float', v };
      }
      case 'double': {
        this.need(8);
        const v = b.readDoubleBE(this.pos);
        this.pos += 8;
        return { t: 'double', v };
      }
      case 'string':
        return { t: 'string', v: this.string() };
      case 'byteArray': {
        const n = this.i32();
        this.need(n);
        const v = new Int8Array(n);
        v.set(new Int8Array(b.buffer, b.byteOffset + this.pos, n));
        this.pos += n;
        return { t: 'byteArray', v };
      }
      case 'intArray': {
        const n = this.i32();
        this.need(n * 4);
        const v = new Int32Array(n);
        for (let i = 0; i < n; i++) v[i] = b.readInt32BE(this.pos + i * 4);
        this.pos += n * 4;
        return { t: 'intArray', v };
      }
      case 'longArray': {
        const n = this.i32();
        this.need(n * 8);
        const words = new Uint32Array(n * 2);
        for (let i = 0; i < n; i++) {
          words[2 * i + 1] = b.readUInt32BE(this.pos + i * 8);
          words[2 * i] = b.readUInt32BE(this.pos + i * 8 + 4);
        }
        this.pos += n * 8;
        return { t: 'longArray', words };
      }
      case 'list': {
        const id = this.u8();
        const n = this.i32();
        const elem = TYPES[id] ?? 'compound';
        const v: Tag[] = [];
        if (id !== 0) for (let i = 0; i < n; i++) v.push(this.payload(elem, depth + 1));
        return { t: 'list', elem, v };
      }
      case 'compound': {
        const v: Record<string, Tag> = {};
        for (;;) {
          const id = this.u8();
          if (id === 0) break;
          const type = TYPES[id];
          if (!type) throw new Error(`Unknown NBT tag type ${id}.`);
          const name = this.string();
          v[name] = this.payload(type, depth + 1);
        }
        return { t: 'compound', v };
      }
    }
  }
}

/** Gzip, zlib or plain bytes, by their first bytes. */
export function decompress(buf: Buffer): Buffer {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf);
  if (buf.length >= 2 && buf[0] === 0x78) return inflateSync(buf);
  return buf;
}

/** Parse NBT (compressed or not). The root must be a compound. */
export function readNbt(input: Buffer): { name: string; root: Record<string, Tag> } {
  const buf = decompress(input);
  const r = new Reader(buf);
  const type = r.u8();
  if (type !== 10) throw new Error('Not an NBT file (the root is not a compound).');
  const name = r.string();
  const root = r.payload('compound', 0);
  return { name, root: (root as { t: 'compound'; v: Record<string, Tag> }).v };
}

// ---------------------------------------------------------------- reading helpers

export type Compound = Record<string, Tag>;

export function getCompound(c: Compound | undefined, key: string): Compound | undefined {
  const t = c?.[key];
  return t?.t === 'compound' ? t.v : undefined;
}

export function getList(c: Compound | undefined, key: string): Tag[] {
  const t = c?.[key];
  return t?.t === 'list' ? t.v : [];
}

export function getCompounds(c: Compound | undefined, key: string): Compound[] {
  return getList(c, key).flatMap((t) => (t.t === 'compound' ? [t.v] : []));
}

/** A number of any numeric tag (longs as numbers). */
export function getNumber(c: Compound | undefined, key: string): number | undefined {
  const t = c?.[key];
  if (!t) return undefined;
  if (t.t === 'byte' || t.t === 'short' || t.t === 'int' || t.t === 'float' || t.t === 'double')
    return t.v;
  if (t.t === 'long') return Number(t.v);
  return undefined;
}

export function getString(c: Compound | undefined, key: string): string | undefined {
  const t = c?.[key];
  return t?.t === 'string' ? t.v : undefined;
}

/** Int array or a list of ints, as numbers. */
export function getInts(c: Compound | undefined, key: string): number[] | undefined {
  const t = c?.[key];
  if (t?.t === 'intArray') return Array.from(t.v);
  if (t?.t === 'list') return t.v.map((x) => (x.t === 'int' ? x.v : 0));
  return undefined;
}

/**
 * NBT as JSON that `jsonToTag` turns back into the same tags: ints are numbers, other number
 * types carry an SNBT suffix ("1b", "5s", "12L", "0.5f", "2.0d"), typed arrays are written
 * ["B;", …], ["I;", …], ["L;", …].
 */
export function tagToJson(tag: Tag): unknown {
  switch (tag.t) {
    case 'byte':
      return `${tag.v}b`;
    case 'short':
      return `${tag.v}s`;
    case 'int':
      return tag.v;
    case 'long':
      return `${tag.v}L`;
    case 'float':
      return `${tag.v}f`;
    case 'double':
      return Number.isInteger(tag.v) ? `${tag.v}d` : tag.v;
    case 'string':
      return tag.v;
    case 'byteArray':
      return ['B;', ...Array.from(tag.v)];
    case 'intArray':
      return ['I;', ...Array.from(tag.v)];
    case 'longArray': {
      const out: unknown[] = ['L;'];
      for (let i = 0; i < tag.words.length; i += 2) {
        const v = BigInt.asIntN(
          64,
          (BigInt(tag.words[i + 1] as number) << 32n) | BigInt(tag.words[i] as number),
        );
        out.push(`${v}`);
      }
      return out;
    }
    case 'list':
      return tag.v.map(tagToJson);
    case 'compound': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(tag.v)) out[k] = tagToJson(v);
      return out;
    }
  }
}

export function compoundToJson(c: Compound): Record<string, unknown> {
  return tagToJson({ t: 'compound', v: c }) as Record<string, unknown>;
}
