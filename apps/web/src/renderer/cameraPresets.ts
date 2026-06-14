import type { Vec3Size } from '@minecraft-schematic-lab/shared';

export type CameraPresetName = 'isometric' | 'front' | 'top';

export const CAMERA_PRESETS: { name: CameraPresetName; label: string }[] = [
  { name: 'isometric', label: 'Isometric' },
  { name: 'front', label: 'Front' },
  { name: 'top', label: 'Top' },
];

/** Camera position for a preset, scaled to the build size. Target is always the origin. */
export function presetPosition(name: CameraPresetName, size: Vec3Size): [number, number, number] {
  const reach = Math.max(size.x, size.y, size.z, 1) * 1.6 + 6;
  switch (name) {
    case 'front':
      return [0, size.y / 2, reach];
    case 'top':
      return [0.001, reach, 0.001];
    case 'isometric':
    default:
      return [reach, reach * 0.85, reach];
  }
}
