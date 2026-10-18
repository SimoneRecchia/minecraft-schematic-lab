import { describe, expect, it } from 'vitest';
import { at, makeWorld, prop } from './testWorld';

describe('piston timing', () => {
  it('a sticky piston spits its block on an observer pulse (2 ticks) and pulls on a long one', () => {
    const blocks = {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'observer[facing=west]',
      '2,0,0': 'sticky_piston[facing=east]',
      '3,0,0': 'oak_planks',
    };
    const w = makeWorld('1.21.4', blocks);
    w.powerOn();
    w.use(w.index(0, 0, 0));
    w.run(12);
    expect(prop(w, 2, 0, 0, 'extended')).toBe('false');
    expect(at(w, 4, 0, 0)).toBe('oak_planks');
    expect(at(w, 3, 0, 0)).toBe('air');

    const long = makeWorld('1.21.4', {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'repeater[facing=west]',
      '2,0,0': 'sticky_piston[facing=east]',
      '3,0,0': 'oak_planks',
    });
    long.powerOn();
    long.use(long.index(0, 0, 0));
    long.run(8);
    long.use(long.index(0, 0, 0));
    long.run(8);
    expect(at(long, 3, 0, 0)).toBe('oak_planks');
  });
});

describe('observers moved by pistons', () => {
  it('pulse once they land, like in the game', () => {
    // The observer watches the stone ahead of it; the piston pushes both one block east.
    const w = makeWorld('1.21.4', {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'piston[facing=east]',
      '2,0,0': 'observer[facing=east]',
      '3,0,0': 'stone',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    let pulsed = false;
    for (let t = 0; t < 10; t++) {
      w.tick();
      if (prop(w, 3, 0, 0, 'powered') === 'true') pulsed = true;
    }
    expect(at(w, 4, 0, 0)).toBe('stone');
    expect(pulsed).toBe(true);
    expect(prop(w, 3, 0, 0, 'powered')).toBe('false');
  });
});

describe('versions', () => {
  it('1.12 dust depowers one level per update but ends in the same state', () => {
    const blocks: Record<string, string> = { '0,0,0': 'lever[face=floor,facing=east]' };
    for (let x = 1; x <= 8; x++) blocks[`${x},0,0`] = 'redstone_wire';
    for (const v of ['1.12.2', '1.16.5', '1.21.4']) {
      const w = makeWorld(v, blocks);
      w.powerOn();
      w.use(w.index(0, 0, 0));
      expect(prop(w, 8, 0, 0, 'power')).toBe('8');
      w.use(w.index(0, 0, 0));
      for (let x = 1; x <= 8; x++) expect(prop(w, x, 0, 0, 'power')).toBe('0');
    }
  });

  it('1.8: no observers in the catalog, but the rest runs', () => {
    const w = makeWorld('1.8.9', {
      '0,0,0': 'lever[face=floor,facing=east]',
      '1,0,0': 'repeater[facing=west,delay=2]',
      '2,0,0': 'redstone_lamp',
    });
    w.powerOn();
    w.use(w.index(0, 0, 0));
    w.run(4);
    expect(prop(w, 2, 0, 0, 'lit')).toBe('true');
  });
});

describe('speed', () => {
  it('runs a few thousand components at well over 20 ticks per second', () => {
    // 64 independent 8-tick clocks (torch + repeater loops) and a 400-dust bus.
    const blocks: Record<string, string> = {};
    for (let k = 0; k < 64; k++) {
      const z = k * 4;
      blocks[`0,0,${z}`] = 'stone';
      blocks[`1,0,${z}`] = 'redstone_wall_torch[facing=east]';
      blocks[`2,0,${z}`] = 'redstone_wire';
      blocks[`2,0,${z + 1}`] = 'redstone_wire';
      blocks[`2,0,${z + 2}`] = 'redstone_wire';
      blocks[`1,0,${z + 2}`] = 'redstone_wire';
      blocks[`0,0,${z + 2}`] = 'redstone_wire';
      blocks[`0,0,${z + 1}`] = 'repeater[facing=south,delay=4]';
      for (let x = 4; x < 30; x++)
        blocks[`${x},0,${z}`] = x % 15 === 0 ? 'repeater[facing=west]' : 'redstone_wire';
    }
    blocks['3,0,0'] = 'redstone_wire';
    const w = makeWorld('1.21.4', blocks);
    const t = performance.now();
    w.powerOn(10);
    w.run(200);
    const ms = performance.now() - t;
    // 210 game ticks; the game itself does 20 per second.
    expect(ms).toBeLessThan(3000);
  });
});
