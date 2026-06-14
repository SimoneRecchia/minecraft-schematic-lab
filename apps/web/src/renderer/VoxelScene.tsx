import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei';
import type { PreviewData } from '@minecraft-schematic-lab/shared';
import { InstancedBlocks } from './InstancedBlocks';
import { presetPosition, type CameraPresetName } from './cameraPresets';

interface ControlsLike {
  target: { set(x: number, y: number, z: number): void };
  update(): void;
}

function CameraRig({ preset, size }: { preset: CameraPresetName; size: PreviewData['size'] }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  useEffect(() => {
    const [x, y, z] = presetPosition(preset, size);
    camera.position.set(x, y, z);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [preset, size.x, size.y, size.z, camera, controls]);
  return null;
}

export function VoxelScene({ data, preset }: { data: PreviewData; preset: CameraPresetName }) {
  const size = data.size;
  const maxDim = Math.max(size.x, size.y, size.z, 1);

  return (
    <Canvas
      camera={{ position: presetPosition(preset, size), fov: 50 }}
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#0e1116']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[maxDim, maxDim * 1.5, maxDim]} intensity={1.1} />
      <directionalLight position={[-maxDim, maxDim, -maxDim * 0.5]} intensity={0.4} />
      <Grid
        args={[maxDim * 3, maxDim * 3]}
        position={[0, -size.y / 2 - 0.01, 0]}
        cellColor="#2a2f3a"
        sectionColor="#3a4250"
        infiniteGrid
        fadeDistance={maxDim * 6}
      />
      <axesHelper args={[maxDim]} />
      <mesh>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshBasicMaterial wireframe color="#33405a" transparent opacity={0.25} />
      </mesh>
      <InstancedBlocks data={data} />
      <OrbitControls makeDefault target={[0, 0, 0]} />
      <CameraRig preset={preset} size={size} />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#e06c75', '#98c379', '#61afef']} labelColor="#ffffff" />
      </GizmoHelper>
    </Canvas>
  );
}
