// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Layout } from './Layout';

afterEach(cleanup);

describe('Layout', () => {
  it('renders the title and the provided slots', () => {
    render(<Layout left={<div>LEFT</div>} center={<div>CENTER</div>} />);
    expect(screen.getByText('minecraft-schematic-lab')).toBeTruthy();
    expect(screen.getByText('LEFT')).toBeTruthy();
    expect(screen.getByText('CENTER')).toBeTruthy();
  });

  it('uses the two-column layout when no right slot is given', () => {
    const { container } = render(<Layout left={<div />} center={<div />} />);
    expect(container.querySelector('.app-body.no-right')).toBeTruthy();
  });
});
