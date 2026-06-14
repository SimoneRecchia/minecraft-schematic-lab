import type { BlockEntityOperation } from '@minecraft-schematic-lab/build-spec';
import type { BlockVolume } from '../BlockVolume';
import type { CompileContext } from '../compileBuildSpec';

export function blockEntity(
  volume: BlockVolume,
  op: BlockEntityOperation,
  ctx: CompileContext,
): void {
  const state = ctx.resolveBlock(op.block);
  const [x, y, z] = op.pos;
  if (!volume.setBlock(x, y, z, state)) {
    ctx.warn(`block_entity at [${x}, ${y}, ${z}] is out of bounds; skipped.`);
    return;
  }
  ctx.addBlockEntity({
    pos: [x, y, z],
    id: state.split('[')[0] ?? state,
    data: op.data ?? {},
  });
}
