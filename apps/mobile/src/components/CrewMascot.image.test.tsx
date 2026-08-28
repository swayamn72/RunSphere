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
    colorScheme: 'dark',
    reduceMotion: true,
    tokens: {
      mascot: {
        body: '#21483E',
        outline: '#5B8075',
        orbit: '#C9F15A',
        pointer: '#47D5BD',
        eye: '#F7FFF7',
        beacon: '#C9F15A'
      }
    }
  })
}));

vi.mock('../crew-assets', () => ({
  crewImageOverrides: {
    rho: { light: { uri: 'rho-light' }, dark: { uri: 'rho-dark' } }
  }
}));

const { CrewMascot } = await import('./CrewMascot.js');

describe('CrewMascot image override', () => {
  it('prefers the theme-appropriate image over the vector fallback', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<CrewMascot character="rho" accessibility={{ mode: 'decorative' }} />);
    });
    const image = renderer.root.findByType('Image' as React.ElementType);
    expect(image.props.source).toEqual({ uri: 'rho-dark' });
    expect(renderer.root.findAllByType('View' as React.ElementType)).toHaveLength(0);
  });
});
