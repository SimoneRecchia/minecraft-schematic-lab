/**
 * A small, safe expression language for circuit tests (no eval): numbers, names, + - * / % **,
 * bitwise & | ^ ~ << >>, comparisons, && || !, ?:, parentheses and min/max/abs/floor/bit(x,i).
 * Booleans are 1 and 0, so "S == (A + B) % 16 && C == (A + B > 15)" works.
 */

type Node =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'if'; c: Node; a: Node; b: Node }
  | { t: 'call'; f: string; args: Node[] };

const BINARY: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '<': 7,
  '<=': 7,
  '>': 7,
  '>=': 7,
  '<<': 8,
  '>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
  '**': 11,
};
const FUNCS: Record<string, (...a: number[]) => number> = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  abs: (a = 0) => Math.abs(a),
  floor: (a = 0) => Math.floor(a),
  bit: (x = 0, i = 0) => (Math.floor(x / 2 ** i) % 2 === 0 ? 0 : 1),
};

const TOKEN =
  /\s*(\d+(?:\.\d+)?|0x[0-9a-fA-F]+|0b[01]+|[A-Za-z_][\w]*|\*\*|<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%&|^~!<>?:(),])/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Unexpected "${src.slice(pos).trim().slice(0, 12)}" in "${src}".`);
    out.push(m[1] as string);
    pos = TOKEN.lastIndex;
  }
  return out;
}

export class Expr {
  private readonly node: Node;
  readonly names: ReadonlySet<string>;

  constructor(readonly source: string) {
    const tokens = tokenize(source);
    let k = 0;
    const names = new Set<string>();
    const peek = () => tokens[k];
    const next = () => tokens[k++];
    const expect = (t: string) => {
      if (next() !== t) throw new Error(`Expected "${t}" in "${source}".`);
    };
    const primary = (): Node => {
      const tok = next();
      if (tok === undefined) throw new Error(`"${source}" ends too early.`);
      if (tok === '(') {
        const e = ternary();
        expect(')');
        return e;
      }
      if (tok === '-' || tok === '+' || tok === '!' || tok === '~')
        return { t: 'un', op: tok, a: unary() };
      if (/^0x/.test(tok)) return { t: 'num', v: Number.parseInt(tok.slice(2), 16) };
      if (/^0b/.test(tok)) return { t: 'num', v: Number.parseInt(tok.slice(2), 2) };
      if (/^\d/.test(tok)) return { t: 'num', v: Number(tok) };
      if (tok === 'true' || tok === 'false') return { t: 'num', v: tok === 'true' ? 1 : 0 };
      if (/^[A-Za-z_]/.test(tok)) {
        if (peek() === '(') {
          if (!FUNCS[tok]) throw new Error(`Unknown function ${tok}() in "${source}".`);
          next();
          const args: Node[] = [];
          if (peek() !== ')') {
            for (;;) {
              args.push(ternary());
              if (peek() === ',') next();
              else break;
            }
          }
          expect(')');
          return { t: 'call', f: tok, args };
        }
        names.add(tok);
        return { t: 'name', v: tok };
      }
      throw new Error(`Unexpected "${tok}" in "${source}".`);
    };
    const unary = (): Node => primary();
    const binary = (minPrec: number): Node => {
      let left = unary();
      for (;;) {
        const op = peek();
        const prec = op !== undefined ? BINARY[op] : undefined;
        if (prec === undefined || prec < minPrec) return left;
        next();
        // ** is right-associative, the rest left-associative.
        const right = binary(op === '**' ? prec : prec + 1);
        left = { t: 'bin', op: op as string, a: left, b: right };
      }
    };
    const ternary = (): Node => {
      const c = binary(1);
      if (peek() !== '?') return c;
      next();
      const a = ternary();
      expect(':');
      return { t: 'if', c, a, b: ternary() };
    };
    this.node = ternary();
    if (k !== tokens.length) throw new Error(`Unexpected "${tokens[k]}" in "${source}".`);
    this.names = names;
  }

  eval(vars: (name: string) => number | undefined): number {
    const ev = (n: Node): number => {
      switch (n.t) {
        case 'num':
          return n.v;
        case 'name': {
          const v = vars(n.v);
          if (v === undefined) throw new Error(`Unknown name "${n.v}" in "${this.source}".`);
          return v;
        }
        case 'un': {
          const a = ev(n.a);
          return n.op === '-'
            ? -a
            : n.op === '!'
              ? a
                ? 0
                : 1
              : n.op === '~'
                ? -Math.trunc(a) - 1
                : a;
        }
        case 'if':
          return ev(n.c) ? ev(n.a) : ev(n.b);
        case 'call':
          return (FUNCS[n.f] as (...a: number[]) => number)(...n.args.map(ev));
        case 'bin': {
          if (n.op === '&&') return ev(n.a) && ev(n.b) ? 1 : 0;
          if (n.op === '||') return ev(n.a) || ev(n.b) ? 1 : 0;
          const a = ev(n.a);
          const b = ev(n.b);
          switch (n.op) {
            case '+':
              return a + b;
            case '-':
              return a - b;
            case '*':
              return a * b;
            case '/':
              return b === 0 ? 0 : Math.trunc(a / b);
            case '%':
              return b === 0 ? 0 : a % b;
            case '**':
              return a ** b;
            case '&':
              return Number(BigInt.asIntN(64, BigInt(Math.trunc(a)) & BigInt(Math.trunc(b))));
            case '|':
              return Number(BigInt.asIntN(64, BigInt(Math.trunc(a)) | BigInt(Math.trunc(b))));
            case '^':
              return Number(BigInt.asIntN(64, BigInt(Math.trunc(a)) ^ BigInt(Math.trunc(b))));
            case '<<':
              return Math.trunc(a) * 2 ** Math.trunc(b);
            case '>>':
              return Math.floor(Math.trunc(a) / 2 ** Math.trunc(b));
            case '==':
              return a === b ? 1 : 0;
            case '!=':
              return a !== b ? 1 : 0;
            case '<':
              return a < b ? 1 : 0;
            case '<=':
              return a <= b ? 1 : 0;
            case '>':
              return a > b ? 1 : 0;
            case '>=':
              return a >= b ? 1 : 0;
          }
          return 0;
        }
      }
    };
    return ev(this.node);
  }
}
