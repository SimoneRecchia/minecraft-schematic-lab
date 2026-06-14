import { create } from 'zustand';
import type { BuildResult } from '@minecraft-schematic-lab/shared';
import type { CameraPresetName } from '../renderer/cameraPresets';

interface BuildState {
  build: BuildResult | null;
  cameraPreset: CameraPresetName;
  setBuild: (build: BuildResult | null) => void;
  setCameraPreset: (preset: CameraPresetName) => void;
}

export const useBuildStore = create<BuildState>((set) => ({
  build: null,
  cameraPreset: 'isometric',
  setBuild: (build) => set({ build }),
  setCameraPreset: (cameraPreset) => set({ cameraPreset }),
}));
