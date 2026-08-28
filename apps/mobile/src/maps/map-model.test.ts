import { describe, expect, it } from 'vitest';
import {
  adjustMapZoom,
  applyNativeCameraState,
  assertAttributionFontSize,
  decimateCoordinates,
  initialMapCameraState,
  recenterMap,
  resetCompass,
  resolveSheetState,
  transitionMapLifecycle
} from './map-model.js';

describe('map interaction models', () => {
  it('uses explicit follow and free-pan camera modes', () => {
    const following = recenterMap(initialMapCameraState);
    expect(following.mode).toBe('follow');
    expect(applyNativeCameraState(following, { zoom: 13, bearing: 21 }, true)).toEqual({
      mode: 'free-pan',
      zoom: 13,
      bearing: 21
    });
  });

  it('synchronizes zoom and bearing from native camera events', () => {
    expect(
      applyNativeCameraState(
        { ...initialMapCameraState, mode: 'follow' },
        { zoom: 15.5, bearing: 90 },
        false
      )
    ).toEqual({ mode: 'follow', zoom: 15.5, bearing: 90 });
  });

  it('bounds pan controls and resets compass state', () => {
    expect(adjustMapZoom({ ...initialMapCameraState, zoom: 22 }, 1).zoom).toBe(22);
    expect(adjustMapZoom({ ...initialMapCameraState, zoom: 1 }, -1).zoom).toBe(1);
    expect(resetCompass({ ...initialMapCameraState, bearing: 42 }).bearing).toBe(0);
  });

  it('models loading, offline, tile failure, retry, and foreground recovery', () => {
    expect(transitionMapLifecycle('loading', 'style-loaded')).toBe('ready');
    expect(transitionMapLifecycle('ready', 'offline')).toBe('offline');
    expect(transitionMapLifecycle('ready', 'tile-failed')).toBe('tile-error');
    expect(transitionMapLifecycle('tile-error', 'retry')).toBe('loading');
    expect(transitionMapLifecycle('loading', 'background')).toBe('fallback');
    expect(transitionMapLifecycle('offline', 'foreground')).toBe('loading');
  });

  it('exposes collapsed, half, expanded, and complete list alternatives', () => {
    expect(resolveSheetState('collapsed', 'expand')).toBe('half');
    expect(resolveSheetState('half', 'expand')).toBe('expanded');
    expect(resolveSheetState('expanded', 'collapse')).toBe('collapsed');
    expect(resolveSheetState('half', 'show-list')).toBe('list');
  });

  it('requires visible attribution to be at least 12sp', () => {
    expect(assertAttributionFontSize(12)).toBe(12);
    expect(() => assertAttributionFontSize(11)).toThrow('12sp');
  });

  it('decimates large renderer traces without altering the stored input', () => {
    const trace = Array.from({ length: 1001 }, (_, index) => index);
    const rendered = decimateCoordinates(trace, 100);
    expect(rendered.length).toBeLessThanOrEqual(101);
    expect(rendered.at(-1)).toBe(1000);
    expect(trace).toHaveLength(1001);
  });
});
