import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../maps/MapSurface', async () => {
  const React = await import('react');
  return {
    MapSurface: (props: Record<string, unknown>) =>
      React.createElement('MapSurface' as React.ElementType, props)
  };
});

const { RunDetailMap, FIT_DURATION_MS } = await import('./RunDetailMap.js');
const { DRAW_DURATION_MS } = await import('./route-draw-model.js');

/** A synthetic 1 km line near 0°, 0°. */
const lines = [Array.from({ length: 11 }, (_, i) => [0, (i * 100) / 111_195] as [number, number])];

const map = (renderer: ReactTestRenderer) =>
  renderer.root.findByType('MapSurface' as React.ElementType);
const layer = (renderer: ReactTestRenderer, id: string) =>
  (
    map(renderer).props.localLayers as {
      id: string;
      visible?: boolean;
      data: { features: { geometry: { coordinates: unknown[] } }[] };
      gradient?: unknown[];
    }[]
  ).find((candidate) => candidate.id === id)!;
const drawnPoints = (renderer: ReactTestRenderer) =>
  layer(renderer, 'run-detail-route').data.features[0]?.geometry.coordinates.flat().length ?? 0;

afterEach(() => vi.useRealTimers());

describe('drawn route (M9 9.18)', () => {
  it('fits the camera, then draws start to finish, popping the markers in', async () => {
    vi.useFakeTimers();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <RunDetailMap
          lines={lines}
          paceSeries={[
            [0, 300],
            [1_000, 360]
          ]}
          reduceMotion={false}
          accessibilityLabel="Your route"
        />
      );
    });
    expect(map(renderer).props.fitBounds).toMatchObject({ duration: FIT_DURATION_MS });
    expect(drawnPoints(renderer)).toBe(0);
    expect(layer(renderer, 'run-detail-start').visible).toBe(false);

    await act(async () => {
      map(renderer).props.onStyleReady();
    });
    await act(async () => {
      vi.advanceTimersByTime(FIT_DURATION_MS + DRAW_DURATION_MS / 3);
    });
    expect(drawnPoints(renderer)).toBeGreaterThan(0);
    expect(drawnPoints(renderer)).toBeLessThan(11);
    expect(layer(renderer, 'run-detail-start').visible).toBe(true);
    expect(layer(renderer, 'run-detail-head').visible).toBe(true);
    expect(layer(renderer, 'run-detail-finish').visible).toBe(false);
    expect(layer(renderer, 'run-detail-route').gradient?.[0]).toBe('interpolate');

    await act(async () => {
      vi.advanceTimersByTime(DRAW_DURATION_MS);
    });
    expect(drawnPoints(renderer)).toBe(11);
    expect(layer(renderer, 'run-detail-finish').visible).toBe(true);
    expect(layer(renderer, 'run-detail-head').visible).toBe(false);
  });

  it('with reduce motion shows the whole line and markers at once, without a camera move', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <RunDetailMap lines={lines} reduceMotion accessibilityLabel="Their route" />
      );
    });
    expect(map(renderer).props.fitBounds).toMatchObject({ duration: 0 });
    expect(drawnPoints(renderer)).toBe(11);
    expect(layer(renderer, 'run-detail-finish').visible).toBe(true);
    // Without a pace series the line is one colour.
    expect(layer(renderer, 'run-detail-route').gradient).toBeUndefined();
  });
});
