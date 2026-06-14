// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MaterialsPanel } from './MaterialsPanel';
import { useBuildStore } from '../state/useBuildStore';

afterEach(() => {
  cleanup();
  useBuildStore.setState({ build: null });
});

describe('MaterialsPanel', () => {
  it('shows an empty hint when there is no build', () => {
    render(<MaterialsPanel />);
    expect(screen.getByText('Build something (ask Claude).')).toBeTruthy();
  });

  it('lists block counts from the build', () => {
    useBuildStore.setState({
      build: {
        sessionId: 's',
        buildId: 'b1',
        valid: true,
        errors: [],
        warnings: [],
        blockCount: 3,
        palette: ['minecraft:stone'],
        previewData: {
          size: { x: 3, y: 1, z: 1 },
          instances: { 'minecraft:stone': [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
        },
      },
    });
    render(<MaterialsPanel />);
    expect(screen.getByText('Stone')).toBeTruthy();
    expect(screen.getByText('×3')).toBeTruthy();
  });
});
