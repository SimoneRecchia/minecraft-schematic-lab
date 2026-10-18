import { describe, expect, it } from 'vitest';
import { at, makeWorld, prop } from './testWorld';

const V = '1.21.4';

/** Run until `test` holds; the tick it first held (relative to now), or -1. */
function waitFor(w: ReturnType<typeof makeWorld>, test: () => boolean, max = 200): number {
  const t0 = w.time;
  for (let t = 0; t <= max; t++) {
    if (test()) return w.time - t0;
    w.tick();
  }
  return -1;
}

describe('redstone dust', () => {
  it('loses one level per block and lights a lamp 15 blocks away', () => {
    const blocks: Record<string, string> = { '0,0,0': 'lever[face=floor,facing=east]' };
    for (let x = 1; x <= 15; x++) blocks[`${x},0,0`] = 'redstone_wire';
    blocks['16,0,0'] = 'redstone_lamp';
    const w = makeWorld(V, blocks);
    expect(w.powerOn()).toBe(true);
    expect(prop(w, 16, 0, 0, 'lit')).toBe('false');
    w.use(w.index(0, 0, 0));
    for (let x = 1; x <= 15; x++) expect(prop(w, x, 0, 0, 'power')).toBe(String(16 - x));
    expect(prop(w, 16, 0, 0, 'lit')).toBe('true');
    // Switching off: dust goes dark at once, the lamp 4 game ticks later.
    w.use(w.index(0, 0, 0));
    expect(prop(w, 8, 0, 0, 'power')).toBe('0');
    expect(waitFor(w, () => prop(w, 16, 0, 0, 'lit') === 'false')).toBe(4);
  });

  it('connects into a line and points into the blocks at its ends', () => {
    const w = makeWorld(V, {
      '0,0,0': 'redstone_wire',
      '1,0,0': 'redstone_wire',
      '2,0,0': 'redstone_wire',
    });
    w.powerOn();
    expect(prop(w, 1, 0, 0, 'east')).toBe('side');
    expect(prop(w, 1, 0, 0, 'north')).toBe('none');
    // An end of a straight line points on into the block beyond it.
    expect(prop(w, 0, 0, 0, 'west')).toBe('side');
  });

  it('powers the block it points into, which lights a lamp but not other dust', () => {
    const w = makeWorld(V, {
      '0,0,1': 'lever[face=floor,facing=east]',
      '1,0,1': 'redstone_wire',
      '2,0,1': 'stone',
      '3,0,1': 'redstone_lamp',
      '2,0,2': 'redstone_wire',
    });
    w.powerOn();
    w.use(w.index(0, 0, 1));
    expect(prop(w, 3, 0, 1, 'lit')).toBe('true');
    expect(prop(w, 2, 0, 2, 'power')).toBe('0');
  });

  it('climbs blocks, and a solid block above a step cuts it', () => {
    const w = makeWorld(V, {
      '0,0,0': 'redstone_block',
      '1,0,0': 'redstone_wire',
      '2,0,0': 'stone',
      '2,1,0': 'redstone_wire',
    });
    w.powerOn();
    expect(prop(w, 1, 0, 0, 'east')).toBe('up');
    expect(prop(w, 2, 1, 0, 'power')).toBe('14');
    const cut = makeWorld(V, {
      '0,0,0': 'redstone_block',
      '1,0,0': 'redstone_wire',
      '1,1,0': 'stone',
      '2,0,0': 'stone',
      '2,1,0': 'redstone_wire',
    });
    cut.powerOn();
    expect(prop(cut, 2, 1, 0, 'power')).toBe('0');
  });

  it('1.16+: a dot powers no side; before 1.16 a lone dust powers all four', () => {
    const blocks = {
      '1,0,1': 'redstone_wire[north=none,south=none,east=none,west=none]',
      '1,1,1': 'redstone_block',
      '2,0,1': 'redstone_lamp',
    };
    const modern = makeWorld(V, blocks);
    modern.powerOn();
    expect(prop(modern, 1, 0, 1, 'power')).toBe('15');
    expect(prop(modern, 2, 0, 1, 'lit')).toBe('false');
    const old = makeWorld('1.12.2', blocks);
    old.powerOn();
    expect(prop(old, 2, 0, 1, 'lit')).toBe('true');
  });
});

describe('torches', () => {
  it('turn off 2 game ticks after their block is powered', () => {
    const w = makeWorld(V, {
      '0,0,0': 'lever[face=wall,facing=west]',
      '1,0,0': 'stone',
      '2,0,0': 'redstone_wall_torch[facing=east]',
      '3,0,0': 'redstone_lamp',
    });
    w.powerOn();
    expect(prop(w, 2, 0, 0, 'lit')).toBe('true');
    expect(prop(w, 3, 0, 0, 'lit')).toBe('true');
    w.use(w.index(0, 0, 0));
    expect(waitFor(w, () => prop(w, 2, 0, 0, 'lit') === 'false')).toBe(2);
  });

  it('strongly power the block above them', () => {
    const w = makeWorld(V, {
      '0,0,0': 'redstone_torch',
      '0,1,0': 'stone',
      '1,0,0': 'stone',
      '1,1,0': 'redstone_wire',
    });
    w.powerOn();
    expect(prop(w, 1, 1, 0, 'power')).toBe('15');
  });

  it('burn out when toggled 8 times within 60 ticks', () => {
    // A wall torch whose own signal comes back to its block through a repeater: an 8-tick clock.
    const w = makeWorld(V, {
      '0,0,0': 'stone',
      '1,0,0': 'redstone_wall_torch[facing=east]',
      '2,0,0': 'redstone_wire',
      '2,0,1': 'redstone_wire',
      '2,0,2': 'redstone_wire',
      '1,0,2': 'redstone_wire',
      '0,0,2': 'redstone_wire',
      '0,0,1': 'repeater[facing=south]',
    });
    w.powerOn(300);
    expect(w.events.some((e) => e.type === 'burnout')).toBe(true);
  });
});

describe('repeaters', () => {
  for (const delay of [1, 2, 3, 4]) {
    it(`delay ${delay} waits ${delay * 2} game ticks`, () => {
      const w = makeWorld(V, {
        '0,0,0': 'lever[face=floor,facing=east]',
        '1,0,0': `repeater[facing=west,delay=${delay}]`,
        '2,0,0': 'redstone_lamp',
      });
      w.powerOn();
      w.use(w.index(0, 0, 0));
      expect(waitFor(w, () => prop(w, 2, 0, 0, 'lit') === 'true')).toBe(delay * 2);
    });
  }

  it('is locked by a powered repeater pointing into its side', () => {
    const w = makeWorld(V, {
      '0,0,1': 'lever[face=floor,facing=east]',
      '1,0,1': 'repeater[facing=west]',
      '2,0,1': 'redstone_lamp',
      '1,0,3': 'lever[face=floor,facing=north]',
      '1,0,2': 'repeater[facing=south]',
    });
    w.powerOn();
    w.use(w.index(1, 0, 3));
    w.run(4);
    expect(prop(w, 1, 0, 1, 'locked')).toBe('true');
    w.use(w.index(0, 0, 1));
    w.run(10);
    expect(prop(w, 2, 0, 1, 'lit')).toBe('false');
  });

  it('delays a button pulse without changing its length', () => {
    const w = makeWorld(V, {
      '0,0,0': 'stone_button[face=floor,facing=east]',
      '1,0,0': 'repeater[facing=west,delay=4]',
      '2,0,0': 'redstone_wire',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    expect(waitFor(w, () => prop(w, 2, 0, 0, 'power') === '15')).toBe(8);
    // Button: 20 ticks pressed, so the output is on 20 ticks too.
    expect(waitFor(w, () => prop(w, 2, 0, 0, 'power') === '0')).toBe(20);
  });
});

describe('comparators', () => {
  it('subtracts a side input', () => {
    const w = makeWorld(V, {
      '0,0,2': 'redstone_block',
      '1,0,2': 'comparator[facing=west,mode=subtract]',
      '2,0,2': 'redstone_wire',
      '1,0,1': 'redstone_wire',
      '1,0,0': 'redstone_wire',
      '2,0,0': 'redstone_wire',
      '3,0,0': 'redstone_wire',
      '4,0,0': 'redstone_block',
    });
    w.powerOn();
    // Side dust at 12 (fourth from its source): 15 - 12 = 3, and the dust in front reads 3.
    expect(prop(w, 1, 0, 1, 'power')).toBe('12');
    expect(w.comparatorOutputAt(w.index(1, 0, 2))).toBe(3);
    expect(prop(w, 2, 0, 2, 'power')).toBe('3');
  });

  it('reads a chest, also through a block', () => {
    const items = { Items: [{ Slot: 0, id: 'minecraft:stone', Count: 64 }] };
    const w = makeWorld(
      V,
      {
        '0,0,0': 'chest[facing=north,type=single]',
        '1,0,0': 'comparator[facing=west]',
        '2,0,0': 'redstone_wire',
      },
      { blockEntities: [{ pos: [0, 0, 0], data: items }] },
    );
    w.powerOn();
    expect(w.comparatorOutputAt(w.index(1, 0, 0))).toBe(1);
    const through = makeWorld(
      V,
      {
        '0,0,0': 'chest[facing=north,type=single]',
        '1,0,0': 'stone',
        '2,0,0': 'comparator[facing=west]',
      },
      {
        blockEntities: [
          {
            pos: [0, 0, 0],
            data: {
              Items: Array.from({ length: 27 }, (_, k) => ({
                Slot: k,
                id: 'minecraft:stone',
                Count: 64,
              })),
            },
          },
        ],
      },
    );
    through.powerOn();
    expect(through.comparatorOutputAt(through.index(2, 0, 0))).toBe(15);
  });

  it('reads cake bites from its state', () => {
    const w = makeWorld(V, { '0,0,0': 'cake[bites=3]', '1,0,0': 'comparator[facing=west]' });
    w.powerOn();
    expect(w.comparatorOutputAt(w.index(1, 0, 0))).toBe(8);
  });
});

describe('observers', () => {
  it('give a 2-tick pulse 2 ticks after the block in front changes', () => {
    const w = makeWorld(V, {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'observer[facing=west]',
      '2,0,0': 'redstone_wire',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    expect(waitFor(w, () => prop(w, 2, 0, 0, 'power') === '15')).toBe(2);
    expect(waitFor(w, () => prop(w, 2, 0, 0, 'power') === '0')).toBe(2);
  });
});

describe('pistons', () => {
  it('push a block in 2 ticks after the block event', () => {
    const w = makeWorld(V, {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'piston[facing=east]',
      '2,0,0': 'stone',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    w.tick();
    expect(prop(w, 1, 0, 0, 'extended')).toBe('true');
    expect(at(w, 3, 0, 0)).toMatch(/^moving_piston/);
    w.tick();
    expect(at(w, 3, 0, 0)).toMatch(/^moving_piston/);
    w.tick();
    expect(at(w, 3, 0, 0)).toBe('stone');
    expect(at(w, 2, 0, 0)).toMatch(/^piston_head/);
    w.use(w.index(0, 0, 0));
    w.run(4);
    expect(prop(w, 1, 0, 0, 'extended')).toBe('false');
    expect(at(w, 2, 0, 0)).toBe('air');
    expect(at(w, 3, 0, 0)).toBe('stone');
  });

  it('sticky pistons pull the block back', () => {
    const w = makeWorld(V, {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'sticky_piston[facing=east]',
      '2,0,0': 'oak_planks',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    w.run(4);
    expect(at(w, 3, 0, 0)).toBe('oak_planks');
    w.use(w.index(0, 0, 0));
    w.run(4);
    expect(at(w, 2, 0, 0)).toBe('oak_planks');
    expect(at(w, 3, 0, 0)).toBe('air');
  });

  it('move slime and what sticks to it, and refuse more than 12 blocks', () => {
    // In the air: slime on the ground would stick to the floor and fail to move.
    const w = makeWorld(V, {
      '0,0,0': 'stone',
      '0,1,0': 'lever[face=floor,facing=east]',
      '1,1,0': 'piston[facing=east]',
      '2,1,0': 'slime_block',
      '2,2,0': 'oak_planks',
    });
    w.powerOn();
    w.use(w.index(0, 1, 0));
    w.run(4);
    expect(at(w, 3, 1, 0)).toBe('slime_block');
    expect(at(w, 3, 2, 0)).toBe('oak_planks');
    expect(at(w, 2, 2, 0)).toBe('air');
    const blocks: Record<string, string> = {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'piston[facing=east]',
    };
    for (let x = 2; x <= 14; x++) blocks[`${x},0,0`] = 'stone';
    const heavy = makeWorld(V, blocks, { margin: 4 });
    heavy.powerOn();
    heavy.use(heavy.index(0, 0, 0));
    heavy.run(4);
    expect(prop(heavy, 1, 0, 0, 'extended')).toBe('false');
  });

  it('are activated through the block above them (quasi-connectivity) on their next update', () => {
    const w = makeWorld(V, {
      '1,0,0': 'piston[facing=north]',
      '1,1,1': 'lever[face=wall,facing=west]',
      '2,1,1': 'stone',
      '2,0,0': 'stone',
    });
    w.powerOn();
    // The lever powers the space above the piston, diagonally: the piston doesn't notice…
    w.use(w.index(1, 1, 1));
    w.run(4);
    expect(prop(w, 1, 0, 0, 'extended')).toBe('false');
    // …until a block next to it changes.
    w.place(w.index(2, 0, 0), 'minecraft:oak_planks');
    w.run(4);
    expect(prop(w, 1, 0, 0, 'extended')).toBe('true');
  });
});

describe('other components', () => {
  it('iron doors open both halves', () => {
    const w = makeWorld(V, {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'iron_door[half=lower,facing=east]',
      '1,1,0': 'iron_door[half=upper,facing=east]',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    expect(prop(w, 1, 0, 0, 'open')).toBe('true');
    expect(prop(w, 1, 1, 0, 'open')).toBe('true');
  });

  it('powered rails carry power 8 rails each way', () => {
    const blocks: Record<string, string> = { '0,0,0': 'redstone_block' };
    for (let x = 1; x <= 11; x++) blocks[`${x},0,0`] = 'powered_rail[shape=east_west]';
    const w = makeWorld(V, blocks);
    w.powerOn();
    for (let x = 1; x <= 9; x++) expect(prop(w, x, 0, 0, 'powered')).toBe('true');
    expect(prop(w, 10, 0, 0, 'powered')).toBe('false');
  });

  it('note blocks play on a rising edge', () => {
    const w = makeWorld(V, {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'note_block[note=12]',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    w.tick();
    expect(w.events.filter((e) => e.type === 'note')).toHaveLength(1);
  });

  it('copper bulbs toggle on each rising edge', () => {
    const w = makeWorld(V, {
      '0,0,0': 'stone_button[face=floor,facing=east]',
      '1,0,0': 'copper_bulb',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    expect(prop(w, 1, 0, 0, 'lit')).toBe('true');
    w.run(25);
    expect(prop(w, 1, 0, 0, 'lit')).toBe('true');
    w.use(w.index(0, 0, 0));
    expect(prop(w, 1, 0, 0, 'lit')).toBe('false');
  });

  it('weighted plates count entities', () => {
    const w = makeWorld(V, {
      '0,0,0': 'light_weighted_pressure_plate',
      '1,0,0': 'redstone_wire',
    });
    w.powerOn();
    w.setPlateEntities(w.index(0, 0, 0), 5);
    w.tick();
    expect(prop(w, 0, 0, 0, 'power')).toBe('5');
    expect(prop(w, 1, 0, 0, 'power')).toBe('5');
    w.setPlateEntities(w.index(0, 0, 0), 0);
    expect(waitFor(w, () => prop(w, 0, 0, 0, 'power') === '0')).toBeLessThanOrEqual(10);
  });
});

describe('determinism', () => {
  it('gives the same result wherever the build sits', () => {
    const blocks = {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'redstone_wire',
      '2,0,0': 'redstone_wire',
      '2,0,1': 'redstone_wire',
      '3,0,1': 'repeater[facing=west]',
      '4,0,1': 'sticky_piston[facing=east]',
      '5,0,1': 'stone',
    };
    const runIt = (offset: [number, number, number]) => {
      const w = makeWorld(V, blocks, { offset });
      w.powerOn();
      w.use(w.index(0, 0, 0));
      w.run(10);
      return [at(w, 6, 0, 1), prop(w, 4, 0, 1, 'extended')];
    };
    expect(runIt([0, 64, 0])).toEqual(runIt([1234, -60, -987]));
  });
});
