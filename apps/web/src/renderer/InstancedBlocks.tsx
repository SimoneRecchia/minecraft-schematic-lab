import { Instance, Instances } from '@react-three/drei';
import { blockShape, type BlockShape, type PreviewData } from '@minecraft-schematic-lab/shared';
import { colorFor, isTransparent, textureFor } from './blockMaterials';

/** Box dimensions for each shape (stairs are approximated as a full cube). */
function sizeForShape(shape: BlockShape): [number, number, number] {
  switch (shape) {
    case 'slab':
      return [1, 0.5, 1];
    case 'thin':
      return [0.3, 1, 0.3];
    default:
      return [1, 1, 1];
  }
}

/** Render the build as one instanced mesh per block state, centered on the origin. */
export function InstancedBlocks({ data }: { data: PreviewData }) {
  const cx = data.size.x / 2;
  const cy = data.size.y / 2;
  const cz = data.size.z / 2;

  return (
    <>
      {Object.entries(data.instances).map(([state, positions]) => {
        if (positions.length === 0) return null;
        const shape = blockShape(state);
        const transparent = shape === 'glass' || isTransparent(state);
        // Everything but thin posts (bars/rods) uses the real block texture when available.
        const texture = shape === 'thin' ? null : textureFor(state);
        const [gw, gh, gd] = sizeForShape(shape);
        // Slabs sit on the floor of their cell.
        const yOffset = shape === 'slab' ? -0.25 : 0;

        return (
          // Key by count: drei sizes the instance buffer from `limit` on mount only.
          <Instances
            key={`${state}:${shape}:${positions.length}`}
            limit={positions.length}
            range={positions.length}
          >
            <boxGeometry args={[gw, gh, gd]} />
            {transparent ? (
              <meshStandardMaterial
                map={texture ?? undefined}
                color={texture ? '#ffffff' : colorFor(state)}
                transparent
                opacity={texture ? 0.8 : 0.42}
                roughness={0.1}
                metalness={0}
                depthWrite={false}
              />
            ) : shape === 'thin' ? (
              <meshStandardMaterial color={colorFor(state)} roughness={0.55} metalness={0.25} />
            ) : (
              <meshStandardMaterial
                map={texture ?? undefined}
                color={texture ? '#ffffff' : colorFor(state)}
                roughness={0.85}
                metalness={0}
              />
            )}
            {positions.map((p, i) => (
              <Instance key={i} position={[p[0] - cx + 0.5, p[1] - cy + 0.5 + yOffset, p[2] - cz + 0.5]} />
            ))}
          </Instances>
        );
      })}
    </>
  );
}
