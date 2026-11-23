import { describe, expect, it } from 'vitest';
import { withinTimeLimit } from './quest-core.js';

const at = (minutes: number) => ({ at: new Date(Date.UTC(2026, 10, 24, 6, 0) + minutes * 60_000) });

describe('quest time limit', () => {
  const run = [at(0), at(5), at(10), at(15), at(20.5)];

  it('keeps every point when the quest has no limit', () => {
    expect(withinTimeLimit(run, null)).toHaveLength(5);
  });

  it('keeps only the points within the limit of the run’s first point', () => {
    expect(withinTimeLimit(run, 20)).toEqual(run.slice(0, 4));
    expect(withinTimeLimit(run, 15)).toEqual(run.slice(0, 4));
    expect(withinTimeLimit(run, 14)).toEqual(run.slice(0, 3));
  });

  it('handles an empty run', () => {
    expect(withinTimeLimit([], 10)).toEqual([]);
  });
});
