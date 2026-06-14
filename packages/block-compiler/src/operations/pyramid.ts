import type { PyramidOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

export function pyramid(volume: BlockVolume, op: PyramidOperation, ctx: CompileContext): void {
  const state = ctx.resolveBlock(op.block);
  const hollow = op.hollow ?? false;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  for (let i = 0; ; i++) {
    const y = y0 + i;
    const ax0 = x0 + i;
    const ax1 = x1 - i;
    const az0 = z0 + i;
    const az1 = z1 - i;
    if (y > y1 || ax0 > ax1 || az0 > az1) break;
    for (let z = az0; z <= az1; z++) {
      for (let x = ax0; x <= ax1; x++) {
        if (!hollow || x === ax0 || x === ax1 || z === az0 || z === az1) {
          volume.setBlock(x, y, z, state);
        }
      }
    }
  }
}
