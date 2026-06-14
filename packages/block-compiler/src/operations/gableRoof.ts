import type { GableRoofOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import { sortPair } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

export function gableRoof(
  volume: BlockVolume,
  op: GableRoofOperation,
  ctx: CompileContext,
): void {
  const state = ctx.resolveBlock(op.block);
  const oh = op.overhang ?? 0;
  const [x0, x1] = sortPair(op.from[0], op.to[0]);
  const [y0, y1] = sortPair(op.from[1], op.to[1]);
  const [z0, z1] = sortPair(op.from[2], op.to[2]);

  if (op.axis === 'x') {
    // Ridge runs along X; the roof slopes toward Z. Overhang extends the X span.
    const xa = x0 - oh;
    const xb = x1 + oh;
    for (let layer = 0; ; layer++) {
      const y = y0 + layer;
      const zl = z0 + layer;
      const zr = z1 - layer;
      if (y > y1 || zl > zr) break;
      for (let x = xa; x <= xb; x++) {
        volume.setBlock(x, y, zl, state);
        volume.setBlock(x, y, zr, state);
      }
    }
  } else {
    // Ridge runs along Z; the roof slopes toward X. Overhang extends the Z span.
    const za = z0 - oh;
    const zb = z1 + oh;
    for (let layer = 0; ; layer++) {
      const y = y0 + layer;
      const xl = x0 + layer;
      const xr = x1 - layer;
      if (y > y1 || xl > xr) break;
      for (let z = za; z <= zb; z++) {
        volume.setBlock(xl, y, z, state);
        volume.setBlock(xr, y, z, state);
      }
    }
  }
}
