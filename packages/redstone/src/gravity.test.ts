import { describe, expect, it } from 'vitest';
import { at, makeWorld, prop } from './testWorld';
import type { World } from './world';

const V = '1.21.4';

function lands(w: World, max = 200): number {
  for (let t = 1; t <= max; t++) {
    w.tick();
    if (w.falling.length === 0) return t;
  }
  return -1;
}

describe('falling blocks', () => {
  it('sand falls when its support goes, and lands on the ground', () => {
    const w = makeWorld(V, { '0,3,0': 'stone', '0,4,0': 'sand' });
    w.powerOn();
    expect(at(w, 0, 4, 0)).toBe('sand');
    w.breakBlock(w.index(0, 3, 0));
    // FallingBlock waits 2 gt, then turns into an entity and drops 4 blocks.
    w.tick();
    expect(at(w, 0, 4, 0)).toBe('sand');
    w.tick();
    expect(at(w, 0, 4, 0)).toBe('air');
    expect(w.falling).toHaveLength(1);
    const t = lands(w);
    expect(t).toBeGreaterThan(5);
    expect(at(w, 0, 0, 0)).toBe('sand');
    expect(w.events.some((e) => e.type === 'land')).toBe(true);
    w.run(2);
    expect(w.idle).toBe(true);
  });

  it('takes 7 game ticks to fall one block (gravity 0.04, drag 0.98)', () => {
    const w = makeWorld(V, { '0,0,0': 'stone', '0,1,0': 'gravel' });
    w.powerOn();
    w.breakBlock(w.index(0, 0, 0));
    w.run(2);
    expect(w.falling).toHaveLength(1);
    expect(lands(w)).toBe(6);
    expect(at(w, 0, 0, 0)).toBe('gravel');
  });

  it('a stack falls one block after another and lands as a stack', () => {
    const w = makeWorld(V, {
      '0,2,0': 'stone',
      '0,3,0': 'sand',
      '0,4,0': 'red_sand',
      '0,5,0': 'gravel',
    });
    w.powerOn();
    w.breakBlock(w.index(0, 2, 0));
    w.run(80);
    expect([0, 1, 2].map((y) => at(w, 0, y, 0))).toEqual(['sand', 'red_sand', 'gravel']);
    expect(at(w, 0, 3, 0)).toBe('air');
  });

  it('breaks into an item on a torch or a bottom slab, rests on a fence', () => {
    const w = makeWorld(V, {
      '0,0,0': 'torch',
      '0,2,0': 'stone',
      '0,3,0': 'sand',
      '2,0,0': 'oak_slab[type=bottom]',
      '2,2,0': 'stone',
      '2,3,0': 'sand',
      '4,0,0': 'oak_fence',
      '4,2,0': 'stone',
      '4,3,0': 'sand',
    });
    w.powerOn();
    for (const x of [0, 2, 4]) w.breakBlock(w.index(x, 2, 0));
    w.run(60);
    expect(at(w, 0, 0, 0)).toBe('torch');
    expect(at(w, 0, 1, 0)).toBe('air');
    expect(at(w, 2, 1, 0)).toBe('air');
    expect(at(w, 4, 1, 0)).toBe('sand');
    const dropped = w.events.filter((e) => e.type === 'break' && /dropped/.test(e.detail ?? ''));
    expect(dropped.map((e) => e.pos[0]).sort()).toEqual([0, 2]);
  });

  it('a sticky piston pulling the support away drops the sand', () => {
    // The lever starts on, holding the stone out; turning it off pulls the stone back.
    const w = makeWorld(V, {
      '0,0,0': 'stone',
      '0,1,0': 'lever[face=floor,facing=east,powered=true]',
      '1,1,0': 'sticky_piston[facing=east,extended=true]',
      '2,1,0': 'piston_head[facing=east,type=sticky]',
      '3,1,0': 'stone',
      '3,2,0': 'sand',
    });
    w.powerOn();
    expect(at(w, 3, 2, 0)).toBe('sand');
    w.use(w.index(0, 1, 0));
    w.run(40);
    expect(at(w, 2, 1, 0)).toBe('stone');
    expect(at(w, 3, 2, 0)).toBe('air');
    expect(at(w, 3, 0, 0)).toBe('sand');
  });

  it('floating sand stays as built until something next to it changes', () => {
    const w = makeWorld(V, { '0,3,0': 'sand', '1,0,0': 'lever[face=floor,facing=east]' });
    expect(w.powerOn()).toBe(true);
    expect(at(w, 0, 3, 0)).toBe('sand');
    w.place(w.index(1, 3, 0), 'minecraft:stone');
    w.run(40);
    expect(at(w, 0, 0, 0)).toBe('sand');
  });

  it('concrete powder hardens in water and next to it', () => {
    const blocks: Record<string, string> = {};
    for (let x = 0; x < 3; x++)
      for (let z = 0; z < 3; z++) if (x !== 1 || z !== 1) blocks[`${x},0,${z}`] = 'stone';
    blocks['1,0,1'] = 'water';
    blocks['1,3,1'] = 'stone';
    blocks['1,4,1'] = 'white_concrete_powder';
    blocks['5,0,0'] = 'water';
    blocks['5,0,1'] = 'stone';
    const w = makeWorld(V, blocks);
    w.powerOn();
    w.breakBlock(w.index(1, 3, 1));
    w.run(60);
    expect(at(w, 1, 0, 1)).toBe('white_concrete');
    w.place(w.index(5, 1, 1), 'minecraft:red_concrete_powder');
    w.place(w.index(4, 0, 0), 'minecraft:blue_concrete_powder');
    w.run(10);
    // Water beside it: concrete; the one on stone with water only below-side stays powder.
    expect(at(w, 4, 0, 0)).toBe('blue_concrete');
    expect(at(w, 5, 1, 1)).toBe('red_concrete_powder');
  });

  it('anvils and dragon eggs fall; suspicious sand shatters', () => {
    const w = makeWorld(V, {
      '0,2,0': 'stone',
      '0,3,0': 'anvil[facing=north]',
      '2,2,0': 'stone',
      '2,3,0': 'suspicious_sand',
      '4,2,0': 'stone',
      '4,3,0': 'dragon_egg',
    });
    w.powerOn();
    for (const x of [0, 2, 4]) w.breakBlock(w.index(x, 2, 0));
    w.run(60);
    expect(at(w, 0, 0, 0)).toBe('anvil[facing=north]');
    expect(at(w, 2, 0, 0)).toBe('air');
    expect(at(w, 4, 0, 0)).toBe('dragon_egg');
    expect(w.events.some((e) => e.type === 'break' && /shattered/.test(e.detail ?? ''))).toBe(true);
  });

  it('falls through water and grass (1.13+), not through grass in 1.12', () => {
    const blocks = {
      '0,0,0': 'short_grass',
      '0,1,0': 'sand',
      '2,0,0': 'water',
      '2,2,0': 'stone',
      '2,3,0': 'sand',
    };
    for (const [v, grass] of [
      [V, 'air'],
      ['1.12.2', 'sand'],
    ] as const) {
      const w = makeWorld(v, blocks);
      w.powerOn();
      w.place(w.index(1, 1, 0), 'minecraft:stone');
      w.breakBlock(w.index(2, 2, 0));
      w.run(60);
      expect(at(w, 0, 1, 0)).toBe(grass);
      expect(at(w, 0, 0, 0)).toBe(grass === 'air' ? 'sand' : 'grass');
      expect(at(w, 2, 0, 0)).toBe('sand');
    }
  });

  it('a stalactite falls when the block holding it goes, and breaks', () => {
    const w = makeWorld(V, {
      '0,4,0': 'stone',
      '0,3,0': 'pointed_dripstone[vertical_direction=down,thickness=base]',
      '0,2,0': 'pointed_dripstone[vertical_direction=down,thickness=tip]',
    });
    w.powerOn();
    w.breakBlock(w.index(0, 4, 0));
    w.run(60);
    expect(at(w, 0, 3, 0)).toBe('air');
    expect(at(w, 0, 2, 0)).toBe('air');
    expect(at(w, 0, 0, 0)).toBe('air');
    expect(w.events.filter((e) => e.type === 'break').length).toBeGreaterThanOrEqual(2);
  });

  it('rewinds falling blocks with snapshot and restore', () => {
    const w = makeWorld(V, { '0,3,0': 'stone', '0,4,0': 'sand' });
    w.powerOn();
    w.breakBlock(w.index(0, 3, 0));
    w.run(4);
    const snap = w.snapshot();
    const y = w.falling[0]?.y;
    w.run(40);
    expect(at(w, 0, 0, 0)).toBe('sand');
    w.restore(snap);
    expect(w.falling).toHaveLength(1);
    expect(w.falling[0]?.y).toBe(y);
    expect(at(w, 0, 0, 0)).toBe('air');
    w.run(40);
    expect(at(w, 0, 0, 0)).toBe('sand');
  });

  it('1.16 removes the block on the entity’s first tick, the same game tick', () => {
    const w = makeWorld('1.16.5', { '0,3,0': 'stone', '0,4,0': 'sand' });
    w.powerOn();
    w.breakBlock(w.index(0, 3, 0));
    w.run(2);
    expect(at(w, 0, 4, 0)).toBe('air');
    w.run(40);
    expect(at(w, 0, 0, 0)).toBe('sand');
    expect(prop(w, 0, 0, 0, 'x')).toBeUndefined();
  });
});
