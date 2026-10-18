import { describe, expect, it } from 'vitest';
import { formatReport, runCircuit } from './circuit';
import type { CircuitSpec } from './circuit';
import { Expr } from './expr';
import { makeWorld } from './testWorld';

const V = '1.21.4';

/** Two levers into one dust line: an OR gate, plus a torch inverter on the output. */
function orGate() {
  return makeWorld(V, {
    '0,0,0': 'lever[face=floor,facing=east]',
    '0,0,2': 'lever[face=floor,facing=east]',
    '1,0,0': 'redstone_wire',
    '1,0,1': 'redstone_wire',
    '1,0,2': 'redstone_wire',
    '2,0,1': 'redstone_wire',
    '3,0,1': 'redstone_lamp',
    '4,0,1': 'redstone_wall_torch[facing=east]',
    '5,0,1': 'redstone_lamp',
  });
}

const OR: CircuitSpec = {
  inputs: { A: { at: [0, 0, 0] }, B: { at: [0, 0, 2] } },
  outputs: { L: { at: [3, 0, 1] }, N: { at: [5, 0, 1] }, P: { at: [2, 0, 1], read: 'power' } },
};

describe('circuit tests', () => {
  it('check a truth table with forAll and expressions', () => {
    const { report } = runCircuit(
      orGate(),
      {
        ...OR,
        tests: [
          {
            name: 'or',
            forAll: { A: [0, 1], B: [0, 1] },
            steps: [
              { set: { A: 'A', B: 'B' } },
              { expect: { L: 'A || B', N: '!(A || B)' }, within: 6 },
            ],
          },
        ],
      },
      [0, 0, 0],
    );
    expect(report.errors).toEqual([]);
    expect(report.powerOn.settled).toBe(true);
    expect(report.tests[0]?.ok).toBe(true);
    expect(report.tests[0]?.cases).toBe(4);
  });

  it('report the latency and catch a wrong expectation', () => {
    const { report } = runCircuit(
      orGate(),
      {
        ...OR,
        tests: [
          {
            name: 'latency',
            trace: ['A', 'N'],
            // Torch off after 2 ticks, then its lamp after 4 more; the dust two blocks on is at 13.
            steps: [{ set: { A: 1 } }, { expect: { N: 0 }, within: 10 }, { expect: { P: 13 } }],
          },
          { name: 'wrong', steps: [{ set: { A: 1 } }, { wait: 5 }, { expect: { L: 0 } }] },
        ],
      },
      [0, 0, 0],
    );
    const [lat, wrong] = report.tests;
    expect(lat?.ok, formatReport(report)).toBe(true);
    expect(lat?.notes[0]).toBe('N=0 after 6 ticks');
    expect(lat?.trace?.N).toEqual([
      [0, 1],
      [6, 0],
    ]);
    expect(wrong?.ok).toBe(false);
    expect(wrong?.failures[0]?.message).toBe('L is 1, expected 0');
    expect(formatReport(report)).toContain('✗ wrong');
  });

  it('read buses as integers and drive "as" inputs', () => {
    const w = makeWorld(V, {
      '0,0,0': 'redstone_lamp',
      '2,0,0': 'redstone_lamp',
      '4,0,0': 'redstone_lamp',
      '9,0,0': 'stone',
    });
    const { report } = runCircuit(
      w,
      {
        inputs: {
          X: {
            at: [
              [0, 1, 0],
              [2, 1, 0],
              [4, 1, 0],
            ],
            as: 'redstone_block',
          },
        },
        outputs: {
          Y: {
            at: [
              [0, 0, 0],
              [2, 0, 0],
              [4, 0, 0],
            ],
          },
        },
        tests: [
          {
            name: 'bus',
            forAll: { X: [0, 7] },
            steps: [{ set: { X: 'X' } }, { expect: { Y: 'X' }, within: 4 }],
          },
        ],
      },
      [0, 0, 0],
    );
    expect(report.errors).toEqual([]);
    expect(report.tests[0]?.ok).toBe(true);
    expect(report.tests[0]?.cases).toBe(8);
  });

  it('measure a clock', () => {
    // Repeater loop: torch + repeater, an 8-tick period until the torch burns out.
    const w = makeWorld(V, {
      '0,0,0': 'stone',
      '1,0,0': 'redstone_wall_torch[facing=east]',
      '2,0,0': 'redstone_wire',
      '2,0,1': 'redstone_wire',
      '2,0,2': 'redstone_wire',
      '1,0,2': 'redstone_wire',
      '0,0,2': 'redstone_wire',
      '0,0,1': 'repeater[facing=south,delay=4]',
    });
    const { report } = runCircuit(
      w,
      {
        outputs: { T: { at: [1, 0, 0] } },
        settleTicks: 10,
        tests: [{ name: 'clock', steps: [{ measure: 'T', ticks: 60, expect: { period: 20 } }] }],
      },
      [0, 0, 0],
    );
    expect(report.powerOn.settled).toBe(false);
    expect(report.tests[0]?.ok, formatReport(report)).toBe(true);
  });

  it('explain inputs that are not controls', () => {
    const { report } = runCircuit(orGate(), { inputs: { A: { at: [3, 0, 1] } } }, [0, 0, 0]);
    expect(report.errors[0]).toMatch(/redstone_lamp: an input must be a lever/);
  });
});

describe('expressions', () => {
  const ev = (s: string, vars: Record<string, number> = {}) => new Expr(s).eval((n) => vars[n]);
  it('follow the usual precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('2 ** 3 ** 2')).toBe(512);
    expect(ev('A + B > 15 ? 1 : 0', { A: 9, B: 9 })).toBe(1);
    expect(ev('(A + B) % 16', { A: 9, B: 9 })).toBe(2);
    expect(ev('A ^ B', { A: 6, B: 3 })).toBe(5);
    expect(ev('bit(A, 2)', { A: 4 })).toBe(1);
    expect(ev('!A && B', { A: 0, B: 1 })).toBe(1);
    expect(ev('1 << 40')).toBe(2 ** 40);
  });
  it('reject anything else', () => {
    expect(() => new Expr('constructor.constructor("x")()')).toThrow();
    expect(() => new Expr('a; b')).toThrow();
    expect(() => ev('Z')).toThrow(/Unknown name/);
  });
});
