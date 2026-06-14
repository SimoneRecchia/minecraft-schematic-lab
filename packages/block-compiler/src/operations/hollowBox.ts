import type { HollowBoxOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

export function hollowBox(
  volume: BlockVolume,
  op: HollowBoxOperation,
  ctx: CompileContext,
): void {
  const state = ctx.resolveBlock(op.block);
  const t = op.thickness ?? 1;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const onShell =
          x < x0 + t ||
          x > x1 - t ||
          y < y0 + t ||
          y > y1 - t ||
          z < z0 + t ||
          z > z1 - t;
        if (onShell) volume.setBlock(x, y, z, state);
      }
    }
  }
}
