// Turn a block state id into a human-friendly label, e.g.
//   "minecraft:stone_bricks"        -> "Stone Bricks"
//   "minecraft:oak_log[axis=y]"     -> "Oak Log"
//   "spruce_planks"                 -> "Spruce Planks"

export function friendlyBlockName(id: string): string {
  const withoutNamespace = id.includes(':') ? (id.split(':')[1] ?? id) : id;
  const withoutState = withoutNamespace.split('[')[0] ?? withoutNamespace;
  return withoutState
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
