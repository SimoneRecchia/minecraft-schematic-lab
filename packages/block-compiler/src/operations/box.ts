import type { BoxOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

export function box(volume: BlockVolume, op: BoxOperation, ctx: CompileContext): void {
  const state = ctx.resolveBlock(op.block);
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        volume.setBlock(x, y, z, state);
      }
    }
  }
}
