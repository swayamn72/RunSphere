import { describe, expect, it } from 'vitest';
import {
  adjustMapZoom,
  applyNativeCameraState,
  assertAttributionFontSize,
  decimateCoordinates,
  initialMapCameraState,
  startingView,
  startFollowing,
  FOLLOW_ZOOM,
  recenterMap,
  resetCompass,
  shouldAnimateCamera,
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

  it('keeps reduced-motion camera updates immediate without changing camera mode', () => {
    expect(shouldAnimateCamera(false)).toBe(true);
    expect(shouldAnimateCamera(true)).toBe(false);
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

describe('where a map opens', () => {
  it('opens on the runner when their position is known', () => {
    expect(startingView(undefined, [72.83, 19.05])).toEqual({ center: [72.83, 19.05], zoom: 12 });
    expect(startingView([72.9, 19.1], [72.83, 19.05]).center).toEqual([72.9, 19.1]);
  });

  it('opens on the launch city, not the whole world, before the first fix', () => {
    const view = startingView(undefined, undefined);
    expect(view.center).toEqual([72.8777, 19.076]);
    expect(view.zoom).toBeGreaterThanOrEqual(10);
  });
});

describe('following you on a run', () => {
  it('closes in to street level, and keeps a closer zoom the runner chose', () => {
    expect(startFollowing(initialMapCameraState)).toEqual({
      mode: 'follow',
      zoom: FOLLOW_ZOOM,
      bearing: 0
    });
    expect(startFollowing({ ...initialMapCameraState, zoom: 18 }).zoom).toBe(18);
  });
});
