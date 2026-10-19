import type { CircuitDefinition } from '@minecraft-schematic-lab/build-spec';
import type { BlockCatalog } from '@minecraft-schematic-lab/catalog';
import { itemsToNbt, K, runCircuit, World } from '@minecraft-schematic-lab/redstone';
import type { CircuitReport, CircuitSpec } from '@minecraft-schematic-lab/redstone';
import type { BlockVolume } from './BlockVolume';
import { FLAG_REDSTONE, type PaletteEntry } from './palette';

/** A redstone world over a compiled volume (the build sits on flat ground, like a paste). */
export function worldFor(
  volume: BlockVolume,
  catalog: BlockCatalog,
  opts: { margin?: number; offset?: [number, number, number] } = {},
): World {
  return new World({
    version: catalog.version.id,
    size: [volume.sizeX, volume.sizeY, volume.sizeZ],
    palette: volume.palette,
    data: volume.data,
    isFullCube: (n) => catalog.isFullCube(n),
    defaults: {
      piston_head: catalog.defaultProps('piston_head'),
      moving_piston: catalog.defaultProps('moving_piston'),
    },
    margin: opts.margin ?? 6,
    ...(opts.offset ? { offset: opts.offset } : {}),
    blockEntities: volume.blockEntities,
  });
}

/** Connect dust and lock repeaters the way placing them by hand would (WorldEdit doesn't). */
export function applyRedstoneShapes(
  volume: BlockVolume,
  entries: readonly PaletteEntry[],
  catalog: BlockCatalog,
): void {
  const flagged = new Uint8Array(volume.palette.length);
  let any = false;
  entries.forEach((e, id) => {
    if (e.flags & FLAG_REDSTONE && id < flagged.length) {
      flagged[id] = 1;
      any = true;
    }
  });
  if (!any) return;
  const world = worldFor(volume, catalog, { margin: 0 });
  const { sizeX, sizeY, sizeZ } = volume;
  const data = volume.data;
  const updates: [number, string][] = [];
  let i = 0;
  for (let y = 0; y < sizeY; y++)
    for (let z = 0; z < sizeZ; z++)
      for (let x = 0; x < sizeX; x++, i++) {
        if (!flagged[data[i] as number]) continue;
        const id = world.placementState(world.index(x, y, z));
        updates.push([i, world.states.info(id).state]);
      }
  for (const [k, state] of updates) data[k] = volume.idFor(state);
}

/** True when the volume holds anything the simulation moves or powers. */
export function hasRedstone(volume: BlockVolume): boolean {
  return volume.palette.some((s) =>
    /redstone|repeater|comparator|piston|observer|lever|_button|pressure_plate/.test(s),
  );
}

/**
 * Power the circuit on, write its rest state into the volume (so the viewer and the exports show
 * it as it looks in game once built) and run its tests.
 */
export function runBuildCircuit(
  volume: BlockVolume,
  circuit: CircuitDefinition,
  catalog: BlockCatalog,
): CircuitReport {
  const world = worldFor(volume, catalog);
  const { report } = runCircuit(world, circuit as CircuitSpec, volume.origin);
  if (!report.powerOn.settled) return report;
  const { sizeX, sizeY, sizeZ } = volume;
  let i = 0;
  const comparators = new Map<string, number>();
  const containers = new Map<string, number>();
  const replaced = new Set<string>();
  for (let y = 0; y < sizeY; y++)
    for (let z = 0; z < sizeZ; z++)
      for (let x = 0; x < sizeX; x++, i++) {
        const w = world.index(x, y, z);
        const state = world.displayState(w);
        const before = volume.palette[volume.data[i] as number] as string;
        const key = `${x},${y},${z}`;
        if (state !== before) {
          volume.data[i] = volume.idFor(state);
          if (state.replace(/\[.*$/, '') !== before.replace(/\[.*$/, '')) replaced.add(key);
        }
        const info = world.info(w);
        if (info.kind === K.COMPARATOR) comparators.set(key, world.comparatorOutputAt(w));
        if (info.blockEntity) containers.set(key, w);
      }
  // Hoppers and dispensers may have moved items; water may have washed a banner away.
  for (let k = volume.blockEntities.length - 1; k >= 0; k--) {
    const be = volume.blockEntities[k] as (typeof volume.blockEntities)[number];
    const key = be.pos.join(',');
    if (replaced.has(key)) {
      volume.blockEntities.splice(k, 1);
      continue;
    }
    const w = containers.get(key);
    if (w === undefined) continue;
    containers.delete(key);
    const inv = world.inventoryAt(w);
    if (!inv && !Array.isArray(be.data.Items)) continue;
    const { Items, ...rest } = be.data;
    be.data = inv ? { ...rest, Items: itemsToNbt(inv, Items) } : rest;
  }
  for (const [key, w] of containers) {
    const inv = world.inventoryAt(w);
    if (!inv) continue;
    const pos = key.split(',').map(Number) as [number, number, number];
    volume.blockEntities.push({
      id: `minecraft:${world.info(w).name}`,
      pos,
      data: { Items: itemsToNbt(inv) },
    });
  }
  // Comparators keep their output in a block entity: export it so a paste starts consistent.
  for (const be of volume.blockEntities) {
    const key = be.pos.join(',');
    const out = comparators.get(key);
    if (out === undefined) continue;
    be.data = { ...be.data, OutputSignal: out };
    comparators.delete(key);
  }
  for (const [key, out] of comparators) {
    if (out === 0) continue;
    const pos = key.split(',').map(Number) as [number, number, number];
    volume.blockEntities.push({ id: 'minecraft:comparator', pos, data: { OutputSignal: out } });
  }
  return report;
}
