export interface ParsedState {
  namespace: string;
  name: string;
  props: Record<string, string>;
}

const STATE_RE = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)(?:\[([^\]]*)\])?$/;

/** Parse "minecraft:oak_stairs[facing=north,half=top]" (namespace and properties optional). */
export function parseBlockState(input: string): ParsedState | { error: string } {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  const m = STATE_RE.exec(s);
  if (!m)
    return { error: `"${input}" is not a valid block state (expected name[prop=value,...]).` };
  const props: Record<string, string> = {};
  if (m[3]) {
    for (const pair of m[3].split(',')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq <= 0 || eq === pair.length - 1) {
        return { error: `"${input}": property "${pair}" must look like key=value.` };
      }
      props[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return { namespace: m[1] ?? 'minecraft', name: m[2] as string, props };
}

/** Canonical form: namespaced, properties sorted by name. */
export function stringifyState(
  name: string,
  props: Record<string, string>,
  namespace = 'minecraft',
): string {
  const keys = Object.keys(props).sort();
  const base = `${namespace}:${name}`;
  if (keys.length === 0) return base;
  return `${base}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]`;
}

/** "minecraft:oak_stairs[facing=north]" -> "oak_stairs". */
export function blockNameOf(state: string): string {
  const noNs = state.includes(':') ? state.slice(state.indexOf(':') + 1) : state;
  const br = noNs.indexOf('[');
  return br === -1 ? noNs : noNs.slice(0, br);
}

/** Properties of a canonical state string (cheap; no validation). */
export function propsOf(state: string): Record<string, string> {
  const br = state.indexOf('[');
  const out: Record<string, string> = {};
  if (br === -1) return out;
  for (const pair of state.slice(br + 1, -1).split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

export function withProps(state: string, patch: Record<string, string>): string {
  return stringifyState(blockNameOf(state), { ...propsOf(state), ...patch });
}
