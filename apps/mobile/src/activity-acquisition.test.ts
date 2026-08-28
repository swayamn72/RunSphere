import { describe, expect, it } from 'vitest';
import {
  ACQUISITION_TIMEOUT_MS,
  acquisitionTimeout,
  advanceAcquisition,
  cancelAcquisition,
  startAcquisition
} from './activity-acquisition.js';

const fix = (accuracy: number) => ({
  recordedAt: '2026-08-28T06:00:00.000Z',
  latitude: 19,
  longitude: 72,
  accuracy,
  altitude: null
});

describe('activity acquisition gate', () => {
  it('starts only after three usable fixes in thirty seconds', () => {
    const startedAt = 1_000;
    let state = startAcquisition(startedAt);
    state = advanceAcquisition(state, fix(12), 2_000);
    state = advanceAcquisition(state, fix(20), 3_000);
    expect(state).toMatchObject({ status: 'acquiring', usableFixes: 2 });
    expect(advanceAcquisition(state, fix(50), 4_000)).toMatchObject({
      status: 'ready',
      usableFixes: 3
    });
  });

  it('excludes weak fixes and never makes acquisition samples a route input', () => {
    const state = advanceAcquisition(startAcquisition(0), fix(51), 1_000);
    expect(state).toMatchObject({ status: 'acquiring', usableFixes: 0 });
  });

  it('times out into preparation recovery and supports cancellation', () => {
    expect(acquisitionTimeout(startAcquisition(0), ACQUISITION_TIMEOUT_MS)).toMatchObject({
      status: 'timed-out'
    });
    expect(cancelAcquisition(startAcquisition(0))).toMatchObject({ status: 'cancelled' });
  });
});
