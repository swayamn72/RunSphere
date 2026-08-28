import { describe, expect, it } from 'vitest';
import { weeklyProgressFrom } from './index.js';

describe('weekly validated progress', () => {
  it('uses only validation outputs and rounds active duration down to whole minutes', () => {
    expect(
      weeklyProgressFrom([
        {
          activeDurationSeconds: 90,
          distanceMeters: 120.4,
          acceptedPointCount: 2,
          rejectedPointCount: 0,
          rejectedGapCount: 0
        },
        {
          activeDurationSeconds: 89,
          distanceMeters: 80.4,
          acceptedPointCount: 2,
          rejectedPointCount: 1,
          rejectedGapCount: 1
        }
      ])
    ).toEqual({ activeMinutes: 2, distanceMeters: 201 });
  });
});
