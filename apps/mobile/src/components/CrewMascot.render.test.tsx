import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const native =
  (name: string) =>
  ({ children, ...props }: Record<string, unknown>) =>
    React.createElement(name as React.ElementType, props, children as React.ReactNode);

vi.mock('react-native', () => ({
  Image: native('Image'),
  View: native('View')
}));

vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: {
      mascot: {
        body: '#D9EAE0',
        outline: '#386755',
        orbit: '#5D8500',
        pointer: '#087B69',
        eye: '#10251F',
        beacon: '#8FBD18'
      }
    }
  })
}));

const { CrewMascot } = await import('./CrewMascot.js');

describe('CrewMascot vector render', () => {
  it('renders each crew member as an accessible-safe static guide', async () => {
    for (const character of ['rho', 'mira', 'coda', 'bram'] as const) {
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(
          <CrewMascot character={character} accessibility={{ mode: 'decorative' }} />
        );
      });
      const root = renderer.root.findByType('View' as React.ElementType);
      expect(root.props.accessible).toBe(false);
      expect(root.props.accessibilityLabel).toBeUndefined();
    }
  });

  it('propagates meaningful labels to the guide wrapper', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <CrewMascot
          character="mira"
          accessibility={{ mode: 'meaningful', label: 'Mira is scouting the next checkpoint.' }}
        />
      );
    });
    const root = renderer.root.findByType('View' as React.ElementType);
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityLabel).toBe('Mira is scouting the next checkpoint.');
  });
});
