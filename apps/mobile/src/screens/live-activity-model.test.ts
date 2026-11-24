import { describe, expect, it } from 'vitest';
import {
  GPS_LABEL,
  PANEL_SWIPE_DISTANCE,
  classifyLiveGps,
  panelOpenAfterSwipe,
  liveLoopFeedback,
  liveRouteGeometry,
  liveRouteLayers
} from './live-activity-model.js';
import type { RecordedLocationSample } from '../activity-recorder-core.js';

const sample = (
  disposition: RecordedLocationSample['disposition'],
  minute: number
): RecordedLocationSample => ({
  recordedAt: `2026-08-28T10:${minute.toString().padStart(2, '0')}:00Z`,
  latitude: 19 + minute / 10_000,
  longitude: 72 + minute / 10_000,
  accuracy: disposition === 'weak-accuracy' ? 80 : 8,
  altitude: null,
  disposition,
  segmentBreak: disposition !== 'usable'
});

describe('Live activity model', () => {
  it('guides a large loop back to its start and resets across a recording break', () => {
    const loop = [
      [72, 19],
      [72.001, 19],
      [72.001, 19.001],
      [72, 19.001],
      [72, 19.00005]
    ].map(([longitude, latitude], minute) => ({
      ...sample('usable', minute),
      longitude: longitude!,
      latitude: latitude!
    }));
    expect(liveLoopFeedback(loop.slice(0, 4))?.layer.kind).toBe('loop-return');
    expect(liveLoopFeedback(loop)?.layer.kind).toBe('loop-ready');
    expect(
      liveLoopFeedback(
        loop.map((point, index) => (index === 2 ? { ...point, segmentBreak: true } : point))
      )
    ).toBeUndefined();
  });
  it('creates renderer-local segmented GeoJSON in longitude/latitude order without mutating observations', () => {
    const observations = [
      sample('usable', 0),
      sample('usable', 1),
      sample('weak-accuracy', 2),
      sample('gap-anchor', 3),
      sample('usable', 4)
    ];
    const before = structuredClone(observations);
    expect(liveRouteGeometry(observations)).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [72, 19],
          [72.0001, 19.0001]
        ],
        [
          [72.0003, 19.0003],
          [72.0004, 19.0004]
        ]
      ]
    });
    expect(liveRouteLayers(observations)).toHaveLength(1);
    expect(observations).toEqual(before);
  });

  it('classifies weak, gap, recovered, and explicit pause separately', () => {
    const usable = sample('usable', 0);
    expect(
      classifyLiveGps({
        state: 'active',
        samples: [usable, sample('weak-accuracy', 1)],
        now: Date.parse('2026-08-28T10:00:30Z')
      }).state
    ).toBe('weak');
    expect(
      classifyLiveGps({
        state: 'active',
        samples: [usable, sample('weak-accuracy', 1)],
        now: Date.parse('2026-08-28T10:01:50Z')
      }).state
    ).toBe('gap');
    expect(
      classifyLiveGps({
        state: 'active',
        samples: [usable],
        now: Date.parse('2026-08-28T10:01:01Z')
      }).state
    ).toBe('gap');
    expect(
      classifyLiveGps({
        state: 'active',
        samples: [usable, sample('gap-anchor', 2)],
        now: Date.parse('2026-08-28T10:02:00Z')
      }).state
    ).toBe('recovered');
    expect(classifyLiveGps({ state: 'paused', samples: [usable], now: Date.now() }).state).toBe(
      'paused'
    );
  });
});

describe('the run panel', () => {
  it('hides on a drag down, comes back on a drag up, and ignores a short drag', () => {
    expect(panelOpenAfterSwipe(true, PANEL_SWIPE_DISTANCE + 1)).toBe(false);
    expect(panelOpenAfterSwipe(false, -(PANEL_SWIPE_DISTANCE + 1))).toBe(true);
    expect(panelOpenAfterSwipe(true, 10)).toBe(true);
    expect(panelOpenAfterSwipe(false, -10)).toBe(false);
  });

  it('names every GPS state in two plain words', () => {
    for (const label of Object.values(GPS_LABEL))
      expect(label.split(' ').length).toBeLessThanOrEqual(2);
    expect(GPS_LABEL.strong).toBe('GPS good');
  });
});
