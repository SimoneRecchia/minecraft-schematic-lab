/**
 * Minimal, fast big-endian NBT writer. Works directly on typed arrays so multi-million block
 * schematics don't go through per-element JS objects.
 */

export type Tag =
  | { t: 'byte'; v: number }
  | { t: 'short'; v: number }
  | { t: 'int'; v: number }
  | { t: 'long'; v: bigint }
  | { t: 'float'; v: number }
  | { t: 'double'; v: number }
  | { t: 'string'; v: string }
  | { t: 'byteArray'; v: Uint8Array | Int8Array }
  | { t: 'intArray'; v: ArrayLike<number> }
  /** 64-bit values as little-endian 32-bit word pairs: [lo0, hi0, lo1, hi1, ...]. */
  | { t: 'longArray'; words: Uint32Array }
  | { t: 'list'; elem: TagType; v: Tag[] }
  | { t: 'compound'; v: Record<string, Tag> };

export type TagType = Tag['t'];

const IDS: Record<TagType, number> = {
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
  longArray: 12,
};

export const byte = (v: number): Tag => ({ t: 'byte', v });
export const short = (v: number): Tag => ({ t: 'short', v });
export const int = (v: number): Tag => ({ t: 'int', v });
export const long = (v: number | bigint): Tag => ({ t: 'long', v: BigInt(v) });
export const double = (v: number): Tag => ({ t: 'double', v });
export const str = (v: string): Tag => ({ t: 'string', v });
export const compound = (v: Record<string, Tag>): Tag => ({ t: 'compound', v });
export const list = (elem: TagType, v: Tag[]): Tag => ({ t: 'list', elem, v });
export const intArray = (v: ArrayLike<number>): Tag => ({ t: 'intArray', v });
export const byteArray = (v: Uint8Array | Int8Array): Tag => ({ t: 'byteArray', v });

/**
 * Java's "modified UTF-8" (DataOutput.writeUTF), which NBT uses: NUL takes two bytes and
 * characters outside the BMP are written as two 3-byte surrogates. Standard UTF-8 4-byte
 * sequences would make the game reject the whole chunk or file.
 */
export function encodeModifiedUtf8(s: string): Buffer {
  let ascii = true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0 || c > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) return Buffer.from(s, 'latin1');
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 0 && c <= 0x7f) out.push(c);
    else if (c <= 0x7ff) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Buffer.from(out);
}

class Writer {
  private buf = Buffer.allocUnsafe(1 << 16);
  private pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = Buffer.allocUnsafe(size);
    this.buf.copy(next, 0, 0, this.pos);
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf.writeUInt8(v & 0xff, this.pos++);
  }
  i8(v: number): void {
    this.ensure(1);
    this.buf.writeInt8(v, this.pos++);
  }
  i16(v: number): void {
    this.ensure(2);
    this.buf.writeInt16BE(v, this.pos);
    this.pos += 2;
  }
  u16(v: number): void {
    this.ensure(2);
    this.buf.writeUInt16BE(v, this.pos);
    this.pos += 2;
  }
  i32(v: number): void {
    this.ensure(4);
    this.buf.writeInt32BE(v | 0, this.pos);
    this.pos += 4;
  }
  u32(v: number): void {
    this.ensure(4);
    this.buf.writeUInt32BE(v >>> 0, this.pos);
    this.pos += 4;
  }
  i64(v: bigint): void {
    this.ensure(8);
    this.buf.writeBigInt64BE(BigInt.asIntN(64, v), this.pos);
    this.pos += 8;
  }
  f32(v: number): void {
    this.ensure(4);
    this.buf.writeFloatBE(v, this.pos);
    this.pos += 4;
  }
  f64(v: number): void {
    this.ensure(8);
    this.buf.writeDoubleBE(v, this.pos);
    this.pos += 8;
  }
  bytes(v: Uint8Array | Int8Array): void {
    this.ensure(v.length);
    this.buf.set(new Uint8Array(v.buffer, v.byteOffset, v.length), this.pos);
    this.pos += v.length;
  }
  string(s: string): void {
    const b = encodeModifiedUtf8(s);
    if (b.length > 65535) throw new Error('An NBT string is longer than 65535 bytes.');
    this.u16(b.length);
    this.bytes(b);
  }
  result(): Buffer {
    return this.buf.subarray(0, this.pos);
  }
}

function payload(w: Writer, tag: Tag): void {
  switch (tag.t) {
    case 'byte':
      return w.i8(tag.v);
    case 'short':
      return w.i16(tag.v);
    case 'int':
      return w.i32(tag.v);
    case 'long':
      return w.i64(tag.v);
    case 'float':
      return w.f32(tag.v);
    case 'double':
      return w.f64(tag.v);
    case 'string':
      return w.string(tag.v);
    case 'byteArray':
      w.i32(tag.v.length);
      return w.bytes(tag.v);
    case 'intArray':
      w.i32(tag.v.length);
      for (let i = 0; i < tag.v.length; i++) w.i32(tag.v[i] as number);
      return;
    case 'longArray': {
      const n = tag.words.length >> 1;
      w.i32(n);
      for (let i = 0; i < n; i++) {
        w.u32(tag.words[2 * i + 1] as number);
        w.u32(tag.words[2 * i] as number);
      }
      return;
    }
    case 'list':
      w.u8(IDS[tag.elem]);
      w.i32(tag.v.length);
      for (const item of tag.v) payload(w, item);
      return;
    case 'compound':
      for (const [name, child] of Object.entries(tag.v)) {
        w.u8(IDS[child.t]);
        w.string(name);
        payload(w, child);
      }
      w.u8(0);
      return;
  }
}

/** Serialize a named root compound (uncompressed). */
export function writeNbt(rootName: string, root: Record<string, Tag>): Buffer {
  const w = new Writer();
  w.u8(IDS.compound);
  w.string(rootName);
  payload(w, compound(root));
  return w.result();
}

const TYPED_NUMBER = /^(-?\d+(?:\.\d+)?)([bslfdBSLFD])$/;

/**
 * Convert JSON block-entity data into NBT. Integers become int, decimals double, booleans byte.
 * Strings like "1b", "5s", "12L", "0.5f", "2d" become that exact number type (SNBT suffixes).
 */
export function jsonToTag(value: unknown): Tag {
  if (typeof value === 'boolean') return byte(value ? 1 : 0);
  if (typeof value === 'number') return Number.isInteger(value) ? int(value) : double(value);
  if (typeof value === 'string') {
    const m = TYPED_NUMBER.exec(value);
    if (m) {
      const n = Number(m[1]);
      switch ((m[2] as string).toLowerCase()) {
        case 'b':
          return byte(n);
        case 's':
          return short(n);
        case 'l':
          return long(BigInt(Math.trunc(n)));
        case 'f':
          return { t: 'float', v: n };
        default:
          return double(n);
      }
    }
    return str(value);
  }
  if (Array.isArray(value)) {
    // ["B;", 1, 2], ["I;", …], ["L;", …]: typed arrays, as SNBT writes them.
    const kind = value[0];
    if (kind === 'B;' || kind === 'I;' || kind === 'L;') {
      const nums = value.slice(1);
      if (kind === 'B;') return byteArray(Int8Array.from(nums.map((n) => Number(n))));
      if (kind === 'I;') return intArray(nums.map((n) => Number(n)));
      const words = new Uint32Array(nums.length * 2);
      nums.forEach((n, i) => {
        const v = BigInt.asUintN(64, BigInt(String(n).replace(/[lL]$/, '')));
        words[2 * i] = Number(v & 0xffffffffn);
        words[2 * i + 1] = Number(v >> 32n);
      });
      return { t: 'longArray', words };
    }
    const items = value.map(jsonToTag);
    return list(items[0]?.t ?? 'compound', items);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, Tag> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonToTag(v);
    return compound(out);
  }
  return str('');
}
