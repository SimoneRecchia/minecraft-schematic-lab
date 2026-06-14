import { describe, expect, it } from 'vitest';
import { CAMERA_PRESETS, presetPosition } from './cameraPresets';

describe('cameraPresets', () => {
  it('exposes the three presets', () => {
    expect(CAMERA_PRESETS.map((p) => p.name)).toEqual(['isometric', 'front', 'top']);
  });

  it('scales the camera distance to the build size', () => {
    const small = presetPosition('isometric', { x: 4, y: 4, z: 4 });
    const large = presetPosition('isometric', { x: 80, y: 40, z: 80 });
    expect(large[0]).toBeGreaterThan(small[0]);
  });

  it('places the top view above the build', () => {
    const [, y] = presetPosition('top', { x: 10, y: 10, z: 10 });
    expect(y).toBeGreaterThan(0);
  });
});
