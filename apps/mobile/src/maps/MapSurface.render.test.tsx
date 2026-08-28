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
    AppState: { addEventListener: () => ({ remove: vi.fn() }) },
    Pressable: native('Pressable'),
    StyleSheet: { absoluteFill: {}, create: <T,>(styles: T) => styles },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('@maplibre/maplibre-react-native', async () => {
  const React = await import('react');
  return {
    Camera: React.forwardRef(() => null),
    Map: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('Map' as React.ElementType, props, children as React.ReactNode)
  };
});
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    reduceMotion: true,
    tokens: {
      background: { surfaceInset: '#000' },
      border: { subtle: '#111' },
      map: { control: '#222', controlText: '#fff', scrim: '#333' },
      route: { line: '#fff' },
      text: { primary: '#fff', secondary: '#aaa' }
    }
  })
}));
vi.mock('./map-config', () => ({
  mapProductCopy: () => 'Map unavailable',
  resolveMapRenderPlan: () => ({
    kind: 'provider',
    provider: { styleUrl: 'https://maps.example/style.json', attribution: 'Example Maps' }
  })
}));
vi.mock('./LocalGeoJsonLayers', () => ({ LocalGeoJsonLayers: () => null }));

const { MapSurface } = await import('./MapSurface.js');

describe('map render interaction', () => {
  it('reports follow to free-pan and delegates explicit recenter requests', async () => {
    const onEnterFreePan = vi.fn();
    const onRequestRecenter = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MapSurface
          accessibilityLabel="Private map"
          initialFollow
          liveCenter={[72.877, 19.076]}
          recenterEnabled
          onEnterFreePan={onEnterFreePan}
          onRequestRecenter={onRequestRecenter}
        />
      );
    });
    const controls = renderer.root.findAllByType('Pressable' as React.ElementType);
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      const style = control.props.style as Array<Record<string, unknown>>;
      const dimensions = style.find((value) => value.height === 48 && value.width === 48);
      expect(dimensions).toMatchObject({ minHeight: 48, minWidth: 48 });
    }
    const map = renderer.root.findByType('Map' as React.ElementType);
    await act(async () => {
      map.props.onRegionDidChange({ nativeEvent: { zoom: 13, bearing: 0, userInteraction: true } });
    });
    expect(onEnterFreePan).toHaveBeenCalledTimes(1);

    const recenter = renderer.root
      .findAllByType('Pressable' as React.ElementType)
      .find((node) => node.props.accessibilityLabel === 'Recenter current location');
    expect(recenter).toBeDefined();
    await act(async () => {
      recenter!.props.onPress();
    });
    expect(onRequestRecenter).toHaveBeenCalledTimes(1);
  });
});
