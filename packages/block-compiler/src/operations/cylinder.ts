import type { CylinderOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

export function cylinder(volume: BlockVolume, op: CylinderOperation, ctx: CompileContext): void {
  const state = ctx.resolveBlock(op.block);
  const [cx, cy, cz] = op.center;
  const r = op.radius;
  const hollow = op.hollow ?? false;
  const reach = Math.ceil(r);
  for (let h = 0; h < op.height; h++) {
    const y = cy + h;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist > r + 0.5) continue;
        if (hollow && dist <= r - 0.5) continue;
        volume.setBlock(cx + dx, y, cz + dz, state);
      }
    }
  }
}
