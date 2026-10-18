import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileBuildSpec, nodeScriptRunner } from '@minecraft-schematic-lab/block-compiler';
import { operationSchema, validateBuildSpec } from '@minecraft-schematic-lab/build-spec';

const dir = join(import.meta.dirname, '..', 'guides');

/** Parse a ```json block: a full object, or a comma-separated list of operations. */
function parseSnippet(src: string): unknown[] {
  for (const candidate of [src, `[${src}]`, `{${src}}`]) {
    try {
      const v = JSON.parse(candidate) as unknown;
      return Array.isArray(v) ? v : [v];
    } catch {
      // try the next shape
    }
  }
  return [];
}

describe('guides', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  it('has every topic read_guide offers', () => {
    for (const t of [
      'workflow',
      'spec',
      'principles',
      'roofs',
      'styles',
      'palettes',
      'details',
      'landscape',
      'scripts',
      'versions',
      'redstone',
      'examples',
    ]) {
      expect(files).toContain(`${t}.md`);
    }
  });

  for (const file of files) {
    it(`${file}: JSON snippets use valid operations`, () => {
      const md = readFileSync(join(dir, file), 'utf8');
      const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] as string);
      for (const block of blocks) {
        if (block.includes('…')) continue; // illustrative fragment
        for (const value of parseSnippet(block)) {
          if (!value || typeof value !== 'object') continue;
          const obj = value as Record<string, unknown>;
          if ('operations' in obj && 'name' in obj && 'minecraftVersion' in obj) {
            const v = validateBuildSpec(obj);
            expect(v.errors, `${file}: spec`).toEqual([]);
            // Full examples must also compile (blocks exist in their version), and a circuit's
            // tests must pass: the guides only show redstone that works.
            const result = compileBuildSpec(obj, { scriptRunner: nodeScriptRunner });
            const failed = (result.circuit?.tests ?? []).filter((t) => !t.ok).map((t) => t.name);
            expect(failed, `${file}: ${String(obj.name)} circuit tests`).toEqual([]);
            expect(result.circuit?.errors ?? [], `${file}: circuit`).toEqual([]);
          } else if ('type' in obj && 'id' in obj) {
            const r = operationSchema.safeParse(obj);
            expect(
              r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
              `${file}: ${JSON.stringify(obj).slice(0, 80)}`,
            ).toEqual([]);
          }
        }
      }
    });
  }
});
