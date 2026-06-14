// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ExportPanel } from './ExportPanel';
import { useBuildStore } from '../state/useBuildStore';

afterEach(() => {
  cleanup();
  useBuildStore.setState({ build: null });
});

describe('ExportPanel', () => {
  it('is disabled when there is no build', () => {
    render(<ExportPanel />);
    const link = screen.getByText('Export .schem');
    expect(link.getAttribute('aria-disabled')).toBe('true');
  });

  it('is enabled once there is a valid build', () => {
    useBuildStore.setState({
      build: {
        sessionId: 's',
        buildId: 'b1',
        valid: true,
        errors: [],
        warnings: [],
        blockCount: 1,
        palette: ['minecraft:stone'],
        previewData: { size: { x: 1, y: 1, z: 1 }, instances: { 'minecraft:stone': [[0, 0, 0]] } },
      },
    });
    render(<ExportPanel />);
    const link = screen.getByText('Export .schem');
    expect(link.getAttribute('aria-disabled')).toBe('false');
    expect(link.getAttribute('href')).toContain('export.schem');
  });
});
