import { describe, expect, it } from 'vitest';
import {
  acquisitionStatusCopy,
  beginPreparationAcquisition,
  preparationFix,
  preparationTimeout
} from './activity-preparation-model.js';

const fix = (accuracy: number) => ({
  recordedAt: '2026-08-28T06:00:00.000Z',
  latitude: 19,
  longitude: 72,
  accuracy,
  altitude: null
});

describe('preparation orchestration model', () => {
  it('keeps acquisition in memory until three reusable fixes make it ready', () => {
    let state = beginPreparationAcquisition(0);
    state = preparationFix(state, fix(51), 1_000);
    state = preparationFix(state, fix(50), 2_000);
    state = preparationFix(state, fix(10), 3_000);
    expect(state).toMatchObject({ status: 'acquiring', usableFixes: 2 });
    expect(preparationFix(state, fix(8), 4_000)).toMatchObject({
      status: 'ready',
      usableFixes: 3
    });
  });

  it('communicates that acquisition fixes are not retained as route data', () => {
    expect(acquisitionStatusCopy(beginPreparationAcquisition(0))).toContain('not saved');
  });

  it('returns timeout recovery without producing a durable session', () => {
    expect(preparationTimeout(beginPreparationAcquisition(0), 30_000)).toMatchObject({
      status: 'timed-out'
    });
  });
});
