import { Instance, Instances } from '@react-three/drei';
import type { PreviewData } from '@minecraft-schematic-lab/shared';
import { colorFor, isTransparent, textureFor } from './blockMaterials';

/** Render the build as one instanced mesh per block state, centered on the origin. */
export function InstancedBlocks({ data }: { data: PreviewData }) {
  const cx = data.size.x / 2;
  const cy = data.size.y / 2;
  const cz = data.size.z / 2;

  return (
    <>
      {Object.entries(data.instances).map(([state, positions]) => {
        if (positions.length === 0) return null;
        const texture = textureFor(state);
        const transparent = isTransparent(state);
        return (
          // Key by count: drei sizes the instance buffer from `limit` on mount only.
          <Instances
            key={`${state}:${positions.length}`}
            limit={positions.length}
            range={positions.length}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial
              map={texture ?? undefined}
              color={texture ? '#ffffff' : colorFor(state)}
              transparent={transparent}
              opacity={transparent ? 0.55 : 1}
              roughness={0.85}
              metalness={0}
            />
            {positions.map((p, i) => (
              <Instance key={i} position={[p[0] - cx + 0.5, p[1] - cy + 0.5, p[2] - cz + 0.5]} />
            ))}
          </Instances>
        );
      })}
    </>
  );
}
