import type { RampOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

export function ramp(volume: BlockVolume, op: RampOperation, ctx: CompileContext): void {
  const state = ctx.resolveBlock(op.block);
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);

  if (op.axis === 'x') {
    const span = Math.max(1, x1 - x0);
    for (let x = x0; x <= x1; x++) {
      const topY = y0 + Math.round(((x - x0) / span) * (y1 - y0));
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= topY; y++) {
          volume.setBlock(x, y, z, state);
        }
      }
    }
  } else {
    const span = Math.max(1, z1 - z0);
    for (let z = z0; z <= z1; z++) {
      const topY = y0 + Math.round(((z - z0) / span) * (y1 - y0));
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= topY; y++) {
          volume.setBlock(x, y, z, state);
        }
      }
    }
  }
}
