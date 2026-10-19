import { describe, expect, it } from 'vitest';
import { compileBuildSpec } from './compileBuildSpec';

const stateAt = (r: ReturnType<typeof compileBuildSpec>, x: number, y: number, z: number) => {
  const v = r.volume;
  return v.getState(x - v.origin[0], y - v.origin[1], z - v.origin[2]);
};

const base = {
  name: 'lamp switch',
  minecraftVersion: '1.21.4',
  operations: [
    { type: 'box', from: [0, -1, 0], to: [6, -1, 2], block: 'stone' },
    { type: 'blocks', block: 'lever[face=floor,facing=east]', at: [[0, 0, 1]] },
    { type: 'line', from: [1, 0, 1], to: [4, 0, 1], block: 'redstone_wire' },
    { type: 'blocks', block: 'redstone_lamp', at: [[5, 0, 1]] },
  ],
};

describe('redstone in builds', () => {
  it('connects dust like placing it by hand', () => {
    const r = compileBuildSpec(base);
    expect(stateAt(r, 2, 0, 1)).toBe(
      'minecraft:redstone_wire[east=side,north=none,power=0,south=none,west=side]',
    );
    expect(r.circuit).toBeUndefined();
  });

  it('keeps dust written with explicit connections', () => {
    const r = compileBuildSpec({
      ...base,
      operations: [
        ...base.operations,
        {
          type: 'blocks',
          block: 'redstone_wire[north=none,south=none,east=none,west=none]',
          at: [[3, 0, 2]],
        },
      ],
    });
    expect(stateAt(r, 3, 0, 2)).toMatch(/east=none,north=none,power=0,south=none,west=none/);
  });

  it('runs the circuit tests and saves the rest state', () => {
    const r = compileBuildSpec({
      ...base,
      operations: base.operations.map((op, i) =>
        i === 1 ? { ...op, block: 'lever[face=floor,facing=east,powered=true]' } : op,
      ),
      circuit: {
        inputs: { S: { at: [0, 0, 1] } },
        outputs: { L: { at: [5, 0, 1] } },
        tests: [
          { name: 'on', steps: [{ set: { S: 1 } }, { expect: { L: 1 } }] },
          { name: 'off', steps: [{ set: { S: 0 } }, { expect: { L: 0 }, within: 4 }] },
          {
            name: 'wrong on purpose',
            steps: [{ set: { S: 0 } }, { wait: 10 }, { expect: { L: 1 } }],
          },
        ],
      },
    });
    expect(r.circuit?.powerOn.settled).toBe(true);
    expect(r.circuit?.tests.map((t) => t.ok)).toEqual([true, true, false]);
    // The lever was written on: at rest the dust is powered and the lamp lit.
    expect(stateAt(r, 1, 0, 1)).toMatch(/power=15/);
    expect(stateAt(r, 5, 0, 1)).toBe('minecraft:redstone_lamp[lit=true]');
  });

  it('rejects a malformed circuit with a precise message', () => {
    expect(() =>
      compileBuildSpec({ ...base, circuit: { tests: [{ name: 't', steps: [{ jump: 3 }] }] } }),
    ).toThrow(/Unknown step/);
  });
});
