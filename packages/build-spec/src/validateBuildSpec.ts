import { buildSpecSchema } from './schema';
import type { BuildSpec } from './types';

export type ValidateResult =
  | { success: true; data: BuildSpec; errors: [] }
  | { success: false; errors: string[] };

function formatPath(path: (string | number)[]): string {
  let out = '';
  for (const p of path) out += typeof p === 'number' ? `[${p}]` : out ? `.${p}` : p;
  return out;
}

/** Structural validation (shape of the JSON). Block ids are checked later against the version. */
export function validateBuildSpec(input: unknown): ValidateResult {
  const parsed = buildSpecSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data, errors: [] };
  }
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const issue of parsed.error.issues) {
    const path = formatPath(issue.path);
    let message = issue.message;
    if (issue.code === 'unrecognized_keys') {
      message = `unknown field(s) ${issue.keys.map((k) => `"${k}"`).join(', ')}`;
    } else if (
      issue.code === 'invalid_type' &&
      issue.expected === 'array' &&
      issue.received === 'object'
    ) {
      message = 'expected an array like [x, y, z], received an object';
    }
    const line = path ? `${path}: ${message}` : message;
    if (!seen.has(line)) {
      seen.add(line);
      errors.push(line);
    }
  }
  return { success: false, errors: errors.slice(0, 40) };
}
