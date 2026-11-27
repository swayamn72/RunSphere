import { describe, expect, it } from 'vitest';
import { easedReplayProgress, formatReplayClock, formatReplayDistance } from './run-replay-model';

describe('replay playback', () => {
  it('covers ground quickly at the start and slows toward the three-second finish', () => {
    const firstPart = easedReplayProgress(600) - easedReplayProgress(0);
    const lastPart = easedReplayProgress(3_000) - easedReplayProgress(2_400);
    expect(easedReplayProgress(0)).toBe(0);
    expect(firstPart).toBeCloseTo(0.36);
    expect(lastPart).toBeCloseTo(0.04);
    expect(easedReplayProgress(1_500)).toBeCloseTo(0.75);
    expect(easedReplayProgress(3_000)).toBe(1);
    expect(easedReplayProgress(3_001)).toBe(1);
  });

  it('formats distance and the clock', () => {
    expect(formatReplayDistance(22_860)).toBe('22.86');
    expect(formatReplayClock(65)).toBe('1:05');
    expect(formatReplayClock(4 * 3600 + 2 * 60 + 28)).toBe('4:02:28');
  });
});
