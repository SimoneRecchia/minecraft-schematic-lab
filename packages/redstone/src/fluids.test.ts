import { describe, expect, it } from 'vitest';
import { at, makeWorld, prop } from './testWorld';

const V = '1.21.4';

/** A 1-wide channel along +x at y=0, walled at z=0 and z=2, closed at x=0. */
function channel(length: number): Record<string, string> {
  const b: Record<string, string> = { '0,0,1': 'stone' };
  for (let x = 0; x <= length; x++) {
    b[`${x},0,0`] = 'stone';
    b[`${x},0,2`] = 'stone';
  }
  return b;
}

describe('fluids', () => {
  it('water spreads 7 blocks along a channel, 5 game ticks per block', () => {
    const w = makeWorld(V, channel(10));
    w.powerOn();
    w.place(w.index(1, 0, 1), 'minecraft:water[level=0]');
    w.run(4);
    expect(at(w, 2, 0, 1)).toBe('air');
    w.run(1);
    expect(at(w, 2, 0, 1)).toBe('water[level=1]');
    w.run(60);
    for (let k = 1; k <= 7; k++) expect(prop(w, 1 + k, 0, 1, 'level')).toBe(String(k));
    expect(at(w, 9, 0, 1)).toBe('air');
    expect(w.idle).toBe(true);
  });

  it('flows toward the nearest drop and falls down it', () => {
    // A source on a platform: the hole 2 blocks east pulls all the water that way.
    const b: Record<string, string> = {};
    for (let x = 0; x < 7; x++) for (let z = 0; z < 5; z++) b[`${x},2,${z}`] = 'stone';
    b['5,2,2'] = 'air';
    b['3,3,2'] = 'water';
    const w = makeWorld(V, b);
    w.powerOn();
    w.place(w.index(3, 4, 2), 'minecraft:stone');
    w.run(80);
    expect(prop(w, 4, 3, 2, 'level')).toBe('1');
    expect(at(w, 2, 3, 2)).toBe('air');
    expect(at(w, 3, 3, 1)).toBe('air');
    expect(prop(w, 5, 2, 2, 'level')).toBe('8');
    expect(at(w, 5, 1, 2).startsWith('water')).toBe(true);
  });

  it('makes a new source between two sources', () => {
    const b = channel(4);
    b['1,0,1'] = 'water';
    b['3,0,1'] = 'water';
    b['4,0,1'] = 'stone';
    const w = makeWorld(V, b);
    w.powerOn();
    w.breakBlock(w.index(4, 0, 1));
    w.place(w.index(4, 0, 1), 'minecraft:stone');
    w.run(30);
    expect(prop(w, 2, 0, 1, 'level')).toBe('0');
  });

  it('washes redstone away, and the circuit loses power', () => {
    const b = channel(6);
    b['2,0,1'] = 'lever[face=floor,facing=east,powered=true]';
    b['3,0,1'] = 'redstone_wire';
    b['4,0,1'] = 'redstone_wire';
    b['5,0,1'] = 'redstone_lamp';
    const w = makeWorld(V, b);
    w.powerOn();
    expect(prop(w, 5, 0, 1, 'lit')).toBe('true');
    w.place(w.index(1, 0, 1), 'minecraft:water[level=0]');
    w.run(40);
    expect(at(w, 2, 0, 1)).toMatch(/^water/);
    expect(at(w, 3, 0, 1)).toMatch(/^water/);
    expect(prop(w, 5, 0, 1, 'lit')).toBe('false');
    const washed = w.events.filter((e) => e.type === 'break' && /washed/.test(e.detail ?? ''));
    expect(washed.length).toBeGreaterThanOrEqual(3);
  });

  it('pressure plates and signs hold water back instead of washing away', () => {
    const b = channel(6);
    b['3,0,1'] = 'stone_pressure_plate';
    const w = makeWorld(V, b);
    w.powerOn();
    w.place(w.index(1, 0, 1), 'minecraft:water[level=0]');
    w.run(60);
    expect(at(w, 3, 0, 1)).toBe('stone_pressure_plate[powered=false]');
    expect(at(w, 4, 0, 1)).toBe('air');
  });

  it('lava and water make obsidian, cobblestone and stone', () => {
    const b = channel(8);
    b['1,0,1'] = 'lava';
    b['4,0,1'] = 'stone';
    b['5,0,1'] = 'water';
    const w = makeWorld(V, b);
    w.powerOn();
    // Water poured next to the lava source: obsidian.
    w.place(w.index(2, 0, 1), 'minecraft:water[level=0]');
    expect(at(w, 1, 0, 1)).toBe('obsidian');
    // Flowing lava meeting water: cobblestone.
    const c = makeWorld(V, { ...channel(8), '1,0,1': 'lava', '4,0,1': 'water' });
    c.powerOn();
    c.place(c.index(1, 1, 1), 'minecraft:stone');
    c.run(200);
    expect(at(c, 3, 0, 1)).toBe('cobblestone');
    // Lava falling onto water: stone.
    const s = makeWorld(V, { '0,0,0': 'water', '0,2,0': 'lava', '1,2,0': 'stone' });
    s.powerOn();
    s.breakBlock(s.index(1, 2, 0));
    s.run(70);
    expect(at(s, 0, 0, 0)).toBe('stone');
  });

  it('lava spreads 3 blocks, 30 game ticks per block', () => {
    const w = makeWorld(V, channel(8));
    w.powerOn();
    w.place(w.index(1, 0, 1), 'minecraft:lava[level=0]');
    w.run(29);
    expect(at(w, 2, 0, 1)).toBe('air');
    w.run(1);
    expect(prop(w, 2, 0, 1, 'level')).toBe('2');
    w.run(200);
    expect(prop(w, 3, 0, 1, 'level')).toBe('4');
    expect(prop(w, 4, 0, 1, 'level')).toBe('6');
    expect(at(w, 5, 0, 1)).toBe('air');
  });

  it('a waterlogged block spills its water, flowing water passes slabs by', () => {
    const b = channel(4);
    b['1,0,1'] = 'oak_slab[type=bottom,waterlogged=true]';
    const w = makeWorld(V, b);
    w.powerOn();
    w.place(w.index(1, 1, 1), 'minecraft:stone');
    w.run(30);
    expect(prop(w, 2, 0, 1, 'level')).toBe('1');
  });

  it('a dispenser pours a water bucket and picks it back up', () => {
    const w = makeWorld(
      V,
      {
        ...channel(4),
        '0,0,1': 'dispenser[facing=east]',
        '0,1,1': 'stone',
        '0,2,1': 'lever[face=floor,facing=east]',
        '0,0,3': 'comparator[facing=north]',
      },
      {
        blockEntities: [
          {
            pos: [0, 0, 1],
            data: { Items: [{ Slot: 0, id: 'minecraft:water_bucket', count: 1 }] },
          },
        ],
      },
    );
    w.powerOn();
    const lever = w.index(0, 2, 1);
    w.use(lever);
    w.run(6);
    expect(at(w, 1, 0, 1)).toBe('water[level=0]');
    expect(w.inventoryAt(w.index(0, 0, 1))?.[0]?.id).toBe('minecraft:bucket');
    w.use(lever);
    w.run(4);
    w.use(lever);
    w.run(6);
    expect(at(w, 1, 0, 1)).not.toBe('water[level=0]');
    expect(w.inventoryAt(w.index(0, 0, 1))?.[0]?.id).toBe('minecraft:water_bucket');
  });
});
