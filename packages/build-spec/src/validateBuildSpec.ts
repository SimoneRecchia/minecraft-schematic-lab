import { buildSpecSchema } from './schema';
import type { BuildSpec } from './types';

export type ValidateResult =
  | { success: true; data: BuildSpec; errors: [] }
  | { success: false; errors: string[] };

export function validateBuildSpec(input: unknown): ValidateResult {
  const parsed = buildSpecSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data, errors: [] };
  }
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { success: false, errors };
}
