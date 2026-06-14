import type { SphereOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

export function sphere(volume: BlockVolume, op: SphereOperation, ctx: CompileContext): void {
  const state = ctx.resolveBlock(op.block);
  const [cx, cy, cz] = op.center;
  const r = op.radius;
  const hollow = op.hollow ?? false;
  const reach = Math.ceil(r);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > r + 0.5) continue;
        if (hollow && dist <= r - 0.5) continue;
        volume.setBlock(cx + dx, cy + dy, cz + dz, state);
      }
    }
  }
}
