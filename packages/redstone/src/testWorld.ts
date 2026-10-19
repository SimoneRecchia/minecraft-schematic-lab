import { getCatalog } from '@minecraft-schematic-lab/catalog';
import { World } from './world';
import type { Vec3, WorldOptions } from './world';

/** Test helper: a world from "x,y,z": "block[props]" pairs, states completed by the catalog. */
export function makeWorld(
  version: string,
  blocks: Record<string, string>,
  opts: Partial<WorldOptions> = {},
): World {
  const cat = getCatalog(version);
  const entries = Object.entries(blocks).map(([k, v]) => {
    const pos = k.split(',').map(Number) as Vec3;
    const n = cat.normalize(v);
    if (!n.ok) throw new Error(n.error);
    return { pos, state: n.state };
  });
  const size: Vec3 = [1, 1, 1];
  for (const e of entries)
    for (let a = 0; a < 3; a++) size[a] = Math.max(size[a] as number, (e.pos[a] as number) + 1);
  const palette = ['minecraft:air'];
  const data = new Uint16Array(size[0] * size[1] * size[2]);
  for (const e of entries) {
    let id = palette.indexOf(e.state);
    if (id < 0) id = palette.push(e.state) - 1;
    data[e.pos[0] + size[0] * (e.pos[2] + size[2] * e.pos[1])] = id;
  }
  return new World({
    version: cat.version.id,
    size,
    palette,
    data,
    isFullCube: (n) => cat.isFullCube(n),
    defaults: {
      piston_head: cat.defaultProps('piston_head'),
      moving_piston: cat.defaultProps('moving_piston'),
    },
    ...opts,
  });
}

export function at(w: World, x: number, y: number, z: number): string {
  return w.stateAt(x, y, z).replace(/^minecraft:/, '');
}

export function prop(w: World, x: number, y: number, z: number, key: string): string | undefined {
  return w.info(w.index(x, y, z)).props[key];
}
