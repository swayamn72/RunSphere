import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
    Text: native('Text'),
    View: native('View')
  };
});
const fitBounds = vi.fn();
vi.mock('@maplibre/maplibre-react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Camera: React.forwardRef((_props, ref) => {
      React.useImperativeHandle(ref, () => ({ fitBounds, setStop: () => undefined }));
      return null;
    }),
    GeoJSONSource: native('GeoJSONSource'),
    Layer: native('Layer'),
    Map: native('Map')
  };
});
vi.mock('../theme/theme', async () => (await import('../theme/theme-mock.js')).themeMock('light'));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 42, right: 0, bottom: 24, left: 0 })
}));
vi.mock('../maps/map-config', () => ({
  resolveMapRenderPlan: () => ({
    kind: 'provider',
    provider: { styleUrl: 'https://tiles.example.com/style.json', attribution: 'Example' }
  })
}));
vi.mock('../maps/turf-world-style-cache', () => ({
  cachedTurfWorldStyle: () => ({ version: 8, sources: {}, layers: [] }),
  hasTurfWorldStyle: () => true,
  loadTurfWorldStyle: async () => undefined
}));

const { RunReplayScreen } = await import('./RunReplayScreen.js');

const route: [number, number][][] = [
  [
    [72.83, 19.02],
    [72.832, 19.022],
    [72.835, 19.021],
    [72.836, 19.018]
  ]
];

const textOf = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAllByType('Text' as unknown as React.ElementType)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' | ');
const byLabel = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.find(
    (node) => (node.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );

const render = async (props: Partial<React.ComponentProps<typeof RunReplayScreen>> = {}) => {
  const onClose = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <RunReplayScreen
        lines={route}
        distanceMeters={1_200}
        averagePace={500}
        elapsedSeconds={660}
        onClose={onClose}
        {...props}
      />
    );
  });
  return { renderer, onClose };
};

describe('run replay', () => {
  it('shows the average pace without a pace legend', async () => {
    const { renderer } = await render();
    const text = textOf(renderer);
    expect(text).toContain('8:20');
    expect(text).not.toContain('QUICKER');
    expect(text).not.toContain('EASIER');
  });

  it('shows elapsed time and fits the full route inside the safe area', async () => {
    const { renderer } = await render();
    const text = textOf(renderer);
    expect(text).toContain('1.20');
    expect(text).toContain('11:00');
    expect(text).toContain('ELAPSED');
    expect(text).not.toContain('MOVING');
    fitBounds.mockClear();
    const map = byLabel(renderer, 'Your route, replaying');
    await act(async () =>
      (map.props as { onDidFinishLoadingStyle: () => void }).onDidFinishLoadingStyle()
    );
    expect(fitBounds).toHaveBeenCalledWith(expect.anything(), {
      padding: { top: 197, right: 36, bottom: 129, left: 36 },
      duration: 0
    });
    expect(byLabel(renderer, 'Replay route')).toBeDefined();
    expect(renderer.root.findAllByType('View' as React.ElementType)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          props: expect.objectContaining({
            style: expect.arrayContaining([expect.objectContaining({ paddingTop: 54 })])
          })
        })
      ])
    );
  });

  it('draws the route in one colour', async () => {
    const { renderer } = await render();
    const routeLine = renderer.root
      .findAllByType('Layer' as React.ElementType)
      .find((node) => node.props.id === 'replay-drawn-line');
    expect(routeLine?.props.paint).toHaveProperty('line-color');
    expect(routeLine?.props.paint).not.toHaveProperty('line-gradient');
  });

  it('reveals the whole route after three seconds of playback', async () => {
    vi.useFakeTimers();
    try {
      const { renderer } = await render();
      const map = byLabel(renderer, 'Your route, replaying');
      await act(async () =>
        (map.props as { onDidFinishLoadingStyle: () => void }).onDidFinishLoadingStyle()
      );
      const replay = byLabel(renderer, 'Replay route');
      await act(async () => (replay.props as { onPress: () => void }).onPress());
      await act(async () => {
        vi.advanceTimersByTime(2_999);
      });
      expect(() => byLabel(renderer, 'Replay route')).toThrow();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(byLabel(renderer, 'Replay route')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
