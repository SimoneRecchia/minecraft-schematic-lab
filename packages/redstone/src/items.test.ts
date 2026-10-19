import { describe, expect, it } from 'vitest';
import { at, makeWorld, prop } from './testWorld';
import type { World } from './world';

const V = '1.21.4';

const items = (id: string, count: number, slot = 0) => ({
  Items: [{ Slot: slot, id: `minecraft:${id}`, count }],
});

function count(w: World, x: number, y: number, z: number): number {
  return (w.inventoryAt(w.index(x, y, z)) ?? []).reduce((n, s) => n + (s?.count ?? 0), 0);
}

describe('hoppers', () => {
  it('pass an item on after 7 game ticks, whichever hopper ticks first', () => {
    for (const dir of ['east', 'west'] as const) {
      const east = dir === 'east';
      const xs = east ? [0, 1, 2, 3] : [3, 2, 1, 0];
      const w = makeWorld(
        V,
        {
          [`${xs[0]},0,0`]: `hopper[facing=${dir}]`,
          [`${xs[1]},0,0`]: `hopper[facing=${dir}]`,
          [`${xs[2]},0,0`]: `hopper[facing=${dir}]`,
          [`${xs[3]},0,0`]: 'chest[facing=north,type=single]',
        },
        { blockEntities: [{ pos: [xs[0] as number, 0, 0], data: items('iron_ingot', 1) }] },
      );
      let arrived = -1;
      for (let t = 1; t <= 40 && arrived < 0; t++) {
        w.tick();
        if (count(w, xs[3] as number, 0, 0) === 1) arrived = t;
      }
      // Moved on tick 1, then 7 gt in each of the two hoppers after the first.
      expect(arrived).toBe(15);
    }
  });

  it('move one item every 8 game ticks', () => {
    const w = makeWorld(
      V,
      { '0,0,0': 'hopper[facing=east]', '1,0,0': 'chest[facing=north,type=single]' },
      { blockEntities: [{ pos: [0, 0, 0], data: items('iron_ingot', 3) }] },
    );
    const times: number[] = [];
    for (let t = 1; t <= 30; t++) {
      const before = count(w, 1, 0, 0);
      w.tick();
      if (count(w, 1, 0, 0) > before) times.push(t);
    }
    expect(times).toEqual([1, 9, 17]);
  });

  it('pull from the container above and stop while powered', () => {
    const w = makeWorld(
      V,
      {
        '0,1,0': 'barrel[facing=up]',
        '0,0,0': 'hopper[facing=east]',
        '1,0,0': 'chest[facing=north,type=single]',
        '0,0,1': 'lever[face=floor,facing=east]',
      },
      { blockEntities: [{ pos: [0, 1, 0], data: items('cobblestone', 10) }] },
    );
    w.powerOn();
    w.run(40);
    const moved = count(w, 1, 0, 0);
    expect(moved).toBeGreaterThanOrEqual(4);
    w.use(w.index(0, 0, 1));
    w.run(80);
    expect(count(w, 1, 0, 0) - moved).toBeLessThanOrEqual(1);
    expect(prop(w, 0, 0, 0, 'enabled')).toBe('false');
    w.use(w.index(0, 0, 1));
    expect(w.settle(400)).toBe(true);
    expect(count(w, 1, 0, 0)).toBe(10);
    expect(count(w, 0, 1, 0)).toBe(0);
  });

  it('comparators follow the items as they move', () => {
    const w = makeWorld(
      V,
      {
        '0,0,0': 'hopper[facing=east]',
        '1,0,0': 'hopper[facing=down]',
        '1,-0,1': 'stone',
        '0,0,1': 'comparator[facing=north]',
        '0,0,2': 'redstone_wire',
      },
      { blockEntities: [{ pos: [0, 0, 0], data: items('stone', 2) }] },
    );
    w.powerOn(10);
    // 2 stones of 64 in 5 slots read 1; empty reads 0.
    w.run(30);
    expect(count(w, 0, 0, 0)).toBe(0);
    expect(w.comparatorOutputAt(w.index(0, 0, 1))).toBe(0);
    expect(prop(w, 0, 0, 2, 'power')).toBe('0');
  });

  it('a dropper pushes items into the container it faces', () => {
    const w = makeWorld(
      V,
      {
        '0,0,0': 'dropper[facing=east]',
        '1,0,0': 'hopper[facing=down]',
        '0,1,0': 'stone_button[face=floor,facing=east]',
        '0,0,1': 'stone',
      },
      { blockEntities: [{ pos: [0, 0, 0], data: items('diamond', 3) }] },
    );
    w.powerOn();
    w.use(w.index(0, 1, 0));
    w.run(6);
    expect(count(w, 0, 0, 0)).toBe(2);
    expect(count(w, 1, 0, 0)).toBe(1);
  });

  it('writes the moved items into a snapshot and rewinds them', () => {
    const w = makeWorld(
      V,
      { '0,0,0': 'hopper[facing=east]', '1,0,0': 'chest[facing=north,type=single]' },
      { blockEntities: [{ pos: [0, 0, 0], data: items('apple', 3) }] },
    );
    const snap = w.snapshot();
    w.run(30);
    expect(count(w, 1, 0, 0)).toBe(3);
    w.restore(snap);
    expect(count(w, 0, 0, 0)).toBe(3);
    expect(count(w, 1, 0, 0)).toBe(0);
  });

  it('a dispenser with nothing in it just clicks', () => {
    const w = makeWorld(V, {
      '0,0,0': 'dispenser[facing=east]',
      '0,1,0': 'stone_button[face=floor,facing=east]',
      '0,0,1': 'stone',
    });
    w.powerOn();
    w.use(w.index(0, 1, 0));
    w.run(6);
    expect(w.events.some((e) => e.type === 'dispense' && /empty/.test(e.detail ?? ''))).toBe(true);
    expect(at(w, 1, 0, 0)).toBe('air');
  });
});

describe('activating sources like a player', () => {
  it('steps on a pressure plate and off again', () => {
    const w = makeWorld(V, {
      '0,0,0': 'oak_pressure_plate',
      '1,0,0': 'redstone_lamp',
    });
    w.powerOn();
    const plate = w.index(0, 0, 0);
    w.activate(plate);
    expect(prop(w, 0, 0, 0, 'powered')).toBe('true');
    w.run(60);
    expect(prop(w, 1, 0, 0, 'lit')).toBe('true');
    w.activate(plate);
    w.run(30);
    expect(prop(w, 0, 0, 0, 'powered')).toBe('false');
    w.run(5);
    expect(prop(w, 1, 0, 0, 'lit')).toBe('false');
  });

  it('shoots a target: full power in the middle, less toward the edge', () => {
    const w = makeWorld(V, { '0,0,0': 'target' });
    w.powerOn();
    const t = w.index(0, 0, 0);
    w.activate(t, { face: 1, point: [0.5, 1, 0.5] });
    expect(prop(w, 0, 0, 0, 'power')).toBe('15');
    w.run(20);
    expect(prop(w, 0, 0, 0, 'power')).toBe('0');
    w.activate(t, { face: 1, point: [0.9, 1, 0.5] });
    expect(prop(w, 0, 0, 0, 'power')).toBe('3');
  });

  it('opens a trapped chest, turns a lectern page, strikes a lightning rod', () => {
    const w = makeWorld(V, {
      '0,0,0': 'trapped_chest[facing=north,type=single]',
      '1,0,0': 'redstone_wire',
      '3,1,0': 'lectern[facing=north,has_book=true]',
      '3,0,0': 'stone',
      '4,0,0': 'redstone_wire',
      '6,0,0': 'lightning_rod[facing=up]',
      '7,0,0': 'redstone_wire',
    });
    w.powerOn();
    w.activate(w.index(0, 0, 0));
    expect(prop(w, 1, 0, 0, 'power')).toBe('1');
    w.activate(w.index(0, 0, 0));
    expect(prop(w, 1, 0, 0, 'power')).toBe('0');

    w.activate(w.index(3, 1, 0));
    expect(prop(w, 4, 0, 0, 'power')).toBe('15');
    w.run(2);
    expect(prop(w, 4, 0, 0, 'power')).toBe('0');

    w.activate(w.index(6, 0, 0));
    expect(prop(w, 7, 0, 0, 'power')).toBe('15');
    w.run(7);
    expect(prop(w, 7, 0, 0, 'power')).toBe('15');
    w.run(1);
    expect(prop(w, 7, 0, 0, 'power')).toBe('0');
  });

  it('tunes a note block, flips a daylight detector, lights TNT', () => {
    const w = makeWorld(V, {
      '0,0,0': 'note_block[note=3]',
      '2,0,0': 'daylight_detector[power=4]',
      '4,0,0': 'tnt',
    });
    w.powerOn();
    w.activate(w.index(0, 0, 0));
    expect(prop(w, 0, 0, 0, 'note')).toBe('4');
    w.activate(w.index(2, 0, 0));
    expect(prop(w, 2, 0, 0, 'inverted')).toBe('true');
    expect(prop(w, 2, 0, 0, 'power')).toBe('11');
    w.activate(w.index(4, 0, 0));
    expect(at(w, 4, 0, 0)).toBe('air');
    expect(w.events.some((e) => e.type === 'tnt')).toBe(true);
  });

  it('a sculk sensor hears it: 30 gt active, then 10 gt cooldown', () => {
    const w = makeWorld(V, { '0,0,0': 'sculk_sensor', '1,0,0': 'redstone_wire' });
    w.powerOn();
    w.activate(w.index(0, 0, 0));
    expect(prop(w, 0, 0, 0, 'sculk_sensor_phase')).toBe('active');
    expect(prop(w, 1, 0, 0, 'power')).toBe('15');
    w.run(30);
    expect(prop(w, 0, 0, 0, 'sculk_sensor_phase')).toBe('cooldown');
    expect(prop(w, 1, 0, 0, 'power')).toBe('0');
    w.run(10);
    expect(prop(w, 0, 0, 0, 'sculk_sensor_phase')).toBe('inactive');
  });
});
