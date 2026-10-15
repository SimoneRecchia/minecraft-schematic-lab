import { describe, expect, it } from 'vitest';
import { exampleSpecs } from './examples';
import { validateBuildSpec } from './validateBuildSpec';

describe('validateBuildSpec', () => {
  it('accepts every example', () => {
    for (const spec of Object.values(exampleSpecs)) {
      expect(validateBuildSpec(spec).errors).toEqual([]);
    }
  });

  it('reports one precise error per bad field, with its path', () => {
    const r = validateBuildSpec({
      name: 'x',
      minecraftVersion: '1.21.4',
      operations: [
        { type: 'box', from: { x: 0, y: 0, z: 0 }, to: [1, 1, 1], block: 'stone' },
        {
          type: 'group',
          operations: [
            { type: 'sphere', center: [0, 0, 0], radius: 2, block: 'stone', colour: 'red' },
          ],
        },
        { type: 'pyramid' },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.errors).toContain(
      'operations[0].from: expected an array like [x, y, z], received an object',
    );
    expect(r.errors.join('\n')).toMatch(
      /operations\[1\]\.operations\[0\]: unknown field\(s\) "colour"/,
    );
    expect(r.errors.join('\n')).toMatch(/operations\[2\]\.type: Unknown operation type "pyramid"/);
  });

  it('requires name and minecraftVersion', () => {
    const r = validateBuildSpec({ operations: [] });
    expect(r.errors.join(' ')).toMatch(/name/);
    expect(r.errors.join(' ')).toMatch(/minecraftVersion/);
  });
});
