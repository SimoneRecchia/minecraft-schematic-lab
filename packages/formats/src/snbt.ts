const TYPED_NUMBER = /^(-?\d+(?:\.\d+)?)([bslfdBSLFD])$/;
const BARE_KEY = /^[A-Za-z0-9._+-]+$/;

function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Block-entity JSON (as BuildSpecs write it, see jsonToTag) as SNBT for commands:
 * {Items:[{Slot:0b,id:"minecraft:apple",count:2}]}.
 */
export function jsonToSnbt(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1b' : '0b';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    return Number.isInteger(value) ? String(value) : `${value}d`;
  }
  if (typeof value === 'string') return TYPED_NUMBER.test(value) ? value : quote(value);
  if (Array.isArray(value)) {
    const kind = value[0];
    if (kind === 'B;' || kind === 'I;' || kind === 'L;') {
      const suffix = kind === 'B;' ? 'b' : kind === 'L;' ? 'L' : '';
      const nums = value.slice(1).map((n) => `${String(n).replace(/[bBlL]$/, '')}${suffix}`);
      return `[${kind}${nums.join(',')}]`;
    }
    return `[${value.map(jsonToSnbt).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${BARE_KEY.test(k) ? k : quote(k)}:${jsonToSnbt(v)}`,
    );
    return `{${parts.join(',')}}`;
  }
  return '""';
}
