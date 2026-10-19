/**
 * LZ4 as Minecraft writes it (region compression type 4, 1.20.5+ with
 * `region-file-compression=lz4`): lz4-java's LZ4BlockOutputStream framing around raw LZ4 blocks.
 * Read-only: VibeSchem writes chunks back with zlib, which every version reads.
 */

const MAGIC = Buffer.from('LZ4Block', 'latin1');
const HEADER = MAGIC.length + 1 + 4 + 4 + 4;

/** Decode one raw LZ4 block into `out` at `op`; returns the new output position. */
function decodeBlock(src: Buffer, start: number, end: number, out: Buffer, op: number): number {
  let ip = start;
  while (ip < end) {
    const token = src[ip++] as number;
    let lit = token >>> 4;
    if (lit === 15) {
      let b: number;
      do {
        b = src[ip++] as number;
        lit += b;
      } while (b === 255 && ip < end);
    }
    if (ip + lit > end || op + lit > out.length) throw new Error('Corrupt LZ4 data.');
    src.copy(out, op, ip, ip + lit);
    ip += lit;
    op += lit;
    if (ip >= end) break;
    const offset = (src[ip] as number) | ((src[ip + 1] as number) << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Error('Corrupt LZ4 data.');
    let len = token & 15;
    if (len === 15) {
      let b: number;
      do {
        b = src[ip++] as number;
        len += b;
      } while (b === 255 && ip < end);
    }
    len += 4;
    if (op + len > out.length) throw new Error('Corrupt LZ4 data.');
    let from = op - offset;
    for (let i = 0; i < len; i++) out[op++] = out[from++] as number;
  }
  return op;
}

export function lz4BlockStreamDecode(src: Buffer): Buffer {
  const parts: Buffer[] = [];
  let p = 0;
  while (p + HEADER <= src.length) {
    if (!src.subarray(p, p + MAGIC.length).equals(MAGIC))
      throw new Error('Not an LZ4Block stream.');
    const token = src[p + MAGIC.length] as number;
    const compressed = src.readInt32LE(p + MAGIC.length + 1);
    const original = src.readInt32LE(p + MAGIC.length + 5);
    p += HEADER;
    if (original === 0) break;
    if (compressed < 0 || original < 0 || p + compressed > src.length)
      throw new Error('Corrupt LZ4 data.');
    const method = token & 0xf0;
    if (method === 0x10) {
      parts.push(Buffer.from(src.subarray(p, p + compressed)));
    } else if (method === 0x20) {
      const out = Buffer.alloc(original);
      const n = decodeBlock(src, p, p + compressed, out, 0);
      if (n !== original) throw new Error('Corrupt LZ4 data.');
      parts.push(out);
    } else {
      throw new Error('Unknown LZ4 block method.');
    }
    p += compressed;
  }
  return Buffer.concat(parts);
}
