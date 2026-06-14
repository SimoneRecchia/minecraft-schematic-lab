import { describe, expect, it } from 'vitest';
import { validateBuildSpec } from './validateBuildSpec';
import { fantasyHouseDemo } from './examples';

describe('validateBuildSpec', () => {
  it('accepts the fantasy house demo', () => {
    const result = validateBuildSpec(fantasyHouseDemo);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('fantasy-house');
      expect(result.errors).toEqual([]);
    }
  });

  it('reports field paths for bad input', () => {
    const result = validateBuildSpec({
      ...fantasyHouseDemo,
      size: { x: 0, y: 16, z: 19 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.startsWith('size.x'))).toBe(true);
    }
  });

  it('rejects an unknown operation type', () => {
    const result = validateBuildSpec({
      ...fantasyHouseDemo,
      operations: [{ type: 'teleport', from: [0, 0, 0], to: [1, 1, 1], block: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { name: _name, ...withoutName } = fantasyHouseDemo;
    const result = validateBuildSpec(withoutName);
    expect(result.success).toBe(false);
  });
});
