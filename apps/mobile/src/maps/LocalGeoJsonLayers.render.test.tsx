import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { SemanticTokens } from '@runsphere/ui';
import type { LocalGeoJsonLayer } from './LocalGeoJsonLayers';

vi.mock('@maplibre/maplibre-react-native', async () => {
  const React = await import('react');
  return {
    GeoJSONSource: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('GeoJSONSource' as React.ElementType, props, children as React.ReactNode),
    Layer: (props: Record<string, unknown>) =>
      React.createElement('Layer' as React.ElementType, props)
  };
});

const { LocalGeoJsonLayers } = await import('./LocalGeoJsonLayers.js');

const tokens = {
  route: { line: '#C9F15A', fill: '#C9F15A33', water: '#144655' },
  checkpoint: { fill: '#C9F15A', text: '#061411', outline: '#F5F7EF' },
  status: { info: '#6FC8DF', success: '#47D5BD', warning: '#FFC968', error: '#FF8E78' }
} as unknown as SemanticTokens;

const line = (id: string, kind: LocalGeoJsonLayer['kind']): LocalGeoJsonLayer => ({
  id,
  kind,
  data: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [72.838, 19.028],
            [72.842, 19.028],
            [72.842, 19.032]
          ]
        }
      }
    ]
  }
});

const paints = (layers: readonly LocalGeoJsonLayer[]): Record<string, Record<string, unknown>> => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<LocalGeoJsonLayers layers={layers} tokens={tokens} />);
  });
  return Object.fromEntries(
    renderer.root
      .findAllByType('Layer' as never)
      .map((node) => [String(node.props.id), node.props.paint as Record<string, unknown>])
  );
};

describe('the accepted-route guide', () => {
  it('is a dashed, translucent line, not the solid trace', () => {
    // `map-ux.md` 1.5 requires the guide to be visibly a different thing from
    // the live trace. Painted alike, a suggestion reads as a course.
    const painted = paints([line('trace', 'line'), line('guide', 'guide')]);

    expect(painted['guide-layer']).toMatchObject({
      'line-dasharray': [2, 2],
      'line-opacity': 0.5
    });
    expect(painted['trace-layer']).toMatchObject({
      'line-color': tokens.route.line,
      'line-opacity': 0.92
    });
    expect(painted['trace-layer']?.['line-dasharray']).toBeUndefined();
  });

  it('differs from the trace in colour and weight as well as dash', () => {
    // Three separate cues, because a dash alone disappears at low zoom and
    // opacity alone disappears against a light basemap.
    const painted = paints([line('trace', 'line'), line('guide', 'guide')]);

    expect(painted['guide-layer']?.['line-color']).not.toBe(painted['trace-layer']?.['line-color']);
    expect(Number(painted['guide-layer']?.['line-width'])).toBeLessThan(
      Number(painted['trace-layer']?.['line-width'])
    );
  });

  it('draws in the order it is given, so the guide sits under the trace', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <LocalGeoJsonLayers
          layers={[line('guide', 'guide'), line('trace', 'line')]}
          tokens={tokens}
        />
      );
    });

    expect(
      renderer.root.findAllByType('Layer' as never).map((node) => String(node.props.id))
    ).toEqual(['guide-layer', 'trace-layer']);
  });

  it('is a third distinct style from the trace and the guide', () => {
    // A live screen can carry all three at once: your trace, the route you
    // accepted, and the holder's run. Three lines a runner cannot tell apart
    // at a glance is worse than two.
    const painted = paints([line('trace', 'line'), line('guide', 'guide'), line('ghost', 'ghost')]);
    const colours = ['trace', 'guide', 'ghost'].map((id) =>
      String(painted[`${id}-layer`]?.['line-color'])
    );

    expect(new Set(colours).size).toBe(3);
    // The ghost line moves, so it is solid: a moving dash reads as a
    // rendering fault rather than as a runner.
    expect(painted['ghost-layer']?.['line-dasharray']).toBeUndefined();
    expect(painted['ghost-layer']?.['line-color']).toBe(tokens.status.info);
  });

  it('marks where the holder had got to, translucently', () => {
    const painted = paints([line('ghost-head', 'ghost-head')]);

    // A record of somebody else's run, not another runner on the road.
    expect(Number(painted['ghost-head-layer']?.['circle-opacity'])).toBeLessThan(1);
    expect(painted['ghost-head-layer']).toHaveProperty('circle-stroke-color');
  });

  it('leaves the territory and checkpoint kinds alone', () => {
    const painted = paints([line('cells', 'fill'), line('marks', 'circle')]);

    expect(painted['cells-layer']).toHaveProperty('fill-color');
    expect(painted['marks-layer']).toHaveProperty('circle-color');
  });
});
