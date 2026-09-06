import { describe, expect, it } from 'vitest';
import {
  MAX_STRETCH_FACTOR,
  MINIMUM_RUNS_FOR_ADVICE,
  RECOMMENDATION_NOTE,
  RECOMMENDATION_TOO_SOON,
  abilityFrom,
  loopEfficiency,
  recommendCaptures,
  successProbability,
  type CandidateTerritory,
  type PastRun,
  type RunnerAbility
} from './territory-recommendation.js';

/** `count` runs of `km` at `paceSecondsPerKm`. */
const runs = (count: number, km: number, paceSecondsPerKm: number): PastRun[] =>
  Array.from({ length: count }, () => ({
    distanceMetres: km * 1000,
    durationSeconds: km * paceSecondsPerKm
  }));

const ability: RunnerAbility = {
  typicalDistanceMetres: 5000,
  typicalPaceSecondsPerKm: 330, // 5:30/km
  bestPaceSecondsPerKm: 300,
  runsConsidered: 12
};

const candidate = (overrides: Partial<CandidateTerritory> = {}): CandidateTerritory => ({
  claimId: 'claim-1',
  perimeterMetres: 5000,
  holderDurationSeconds: 1800, // 30:00
  areaSqm: 90_000,
  isSelf: false,
  ...overrides
});

describe('reading ability from history', () => {
  it('needs a few runs before it will say anything', () => {
    expect(abilityFrom(runs(MINIMUM_RUNS_FOR_ADVICE - 1, 5, 330))).toBeUndefined();
    expect(abilityFrom(runs(MINIMUM_RUNS_FOR_ADVICE, 5, 330))).toBeDefined();
  });

  it('uses the median, so one long run does not redefine the runner', () => {
    const mostly5k = [...runs(9, 5, 330), { distanceMetres: 42_000, durationSeconds: 42 * 400 }];

    expect(abilityFrom(mostly5k)?.typicalDistanceMetres).toBe(5000);
  });

  it('ignores runs too short or malformed to read a pace from', () => {
    const noisy: PastRun[] = [
      ...runs(4, 5, 330),
      { distanceMetres: 50, durationSeconds: 20 },
      { distanceMetres: 5000, durationSeconds: 0 },
      { distanceMetres: Number.NaN, durationSeconds: 100 }
    ];

    expect(abilityFrom(noisy)?.runsConsidered).toBe(4);
  });

  it('keeps the best pace alongside the usual one', () => {
    const mixed = [...runs(4, 5, 330), { distanceMetres: 5000, durationSeconds: 5 * 280 }];

    expect(abilityFrom(mixed)?.bestPaceSecondsPerKm).toBe(280);
  });
});

describe('estimating the chance', () => {
  it('is better than even when the runner is faster than the record', () => {
    // Needs 1800s, would take 1650s at their usual pace.
    expect(successProbability(1650, 1800, 12)).toBeGreaterThan(0.5);
  });

  it('is worse than even when the record is faster than they are', () => {
    expect(successProbability(1950, 1800, 12)).toBeLessThan(0.5);
  });

  it('never promises a certainty in either direction', () => {
    expect(successProbability(1, 3600, 50)).toBeLessThanOrEqual(0.95);
    expect(successProbability(3600, 60, 50)).toBeGreaterThanOrEqual(0.05);
  });

  it('is pulled towards "no idea" when there is little history', () => {
    const confident = successProbability(1500, 1800, 20);
    const tentative = successProbability(1500, 1800, 3);

    // A confident number from three runs is a lie told precisely.
    expect(tentative).toBeLessThan(confident);
    expect(tentative).toBeGreaterThan(0.5);
  });

  it('scales the margin against the size of the target', () => {
    // A minute off matters more on a ten-minute loop than on an hour one.
    const shortLoop = successProbability(540, 600, 20);
    const longLoop = successProbability(3540, 3600, 20);

    expect(shortLoop).toBeGreaterThan(longLoop);
  });
});

describe('what gets recommended', () => {
  it('says nothing at all without enough history', () => {
    expect(recommendCaptures(undefined, [candidate()])).toEqual([]);
    expect(RECOMMENDATION_TOO_SOON).toContain('Run a few more times');
  });

  it('recommends a loop the runner can plausibly take', () => {
    const [best] = recommendCaptures(ability, [candidate()]);

    expect(best?.claimId).toBe('claim-1');
    expect(best?.estimatedSeconds).toBe(1650);
    expect(best?.difficulty).toBe('comfortable');
  });

  it('never suggests a run half again as long as anything they do', () => {
    // Safety, not likelihood: the app should not talk somebody into this.
    const tooLong = candidate({
      claimId: 'marathon',
      perimeterMetres: ability.typicalDistanceMetres * MAX_STRETCH_FACTOR + 1
    });

    expect(recommendCaptures(ability, [tooLong])).toEqual([]);
  });

  it('marks a longer-than-usual loop as a stretch rather than hiding it', () => {
    const [stretch] = recommendCaptures(ability, [
      candidate({ perimeterMetres: 6500, holderDurationSeconds: 2400 })
    ]);

    expect(stretch?.difficulty).toBe('stretch');
    expect(stretch?.reason).toContain('longer than your usual');
  });

  it('leaves the reader own ground out, because that is defending', () => {
    expect(recommendCaptures(ability, [candidate({ isSelf: true })])).toEqual([]);
  });

  it('puts the best chance first and returns at most three', () => {
    const many = [
      candidate({ claimId: 'hard', holderDurationSeconds: 1200 }),
      candidate({ claimId: 'easy', holderDurationSeconds: 2400 }),
      candidate({ claimId: 'medium', holderDurationSeconds: 1700 }),
      candidate({ claimId: 'also-easy', holderDurationSeconds: 2300 })
    ];
    const recommended = recommendCaptures(ability, many);

    expect(recommended).toHaveLength(3);
    expect(recommended[0]?.claimId).toBe('easy');
  });

  it('explains itself in words a person can disagree with', () => {
    const [best] = recommendCaptures(ability, [candidate()]);

    expect(best?.reason).toContain('km');
    expect(best?.reason).toContain('%');
    expect(best?.reason).toContain('recent runs');
  });

  it('states that the estimate is a guess wherever it is shown', () => {
    expect(RECOMMENDATION_NOTE).toContain('not a promise');
    // It knows distance and pace. It does not know the road or the day.
    expect(RECOMMENDATION_NOTE).toContain('does not know the route');
  });

  it('reads nothing about a person except distance and pace', () => {
    // The recommender takes two numbers per past run. There is deliberately no
    // input for where somebody lives, when they run, or who they run near.
    const past: PastRun = { distanceMetres: 5000, durationSeconds: 1650 };

    expect(Object.keys(past)).toEqual(['distanceMetres', 'durationSeconds']);
  });
});

describe('how efficiently a loop encloses ground', () => {
  it('scores a circle at one', () => {
    const radius = 500;
    expect(loopEfficiency(Math.PI * radius ** 2, 2 * Math.PI * radius)).toBeCloseTo(1, 6);
  });

  it('scores a square below a circle of the same perimeter', () => {
    // 4pi*A/P^2 for a square is pi/4, about 0.785.
    expect(loopEfficiency(250_000, 2000)).toBeCloseTo(Math.PI / 4, 3);
  });

  it('approaches nothing for a long thin loop', () => {
    // 2 km out and back enclosing a 10 m strip: almost no ground for the run.
    expect(loopEfficiency(20_000, 4020)).toBeLessThan(0.02);
  });

  it('is never above one, whatever numbers it is handed', () => {
    // Area and perimeter arrive from separate columns and could disagree.
    expect(loopEfficiency(10_000_000, 10)).toBe(1);
  });

  it('is nothing for a loop with no length or no area', () => {
    expect(loopEfficiency(0, 1000)).toBe(0);
    expect(loopEfficiency(90_000, 0)).toBe(0);
  });

  it('prefers the loop that returns more ground for the same effort', () => {
    // Same distance, same time to beat, same chance — one encloses far more.
    const round = candidate({ claimId: 'round', perimeterMetres: 4000, areaSqm: 1_200_000 });
    const thin = candidate({ claimId: 'thin', perimeterMetres: 4000, areaSqm: 40_000 });
    const [best] = recommendCaptures({ ...ability, typicalDistanceMetres: 4000 }, [thin, round]);

    expect(best?.claimId).toBe('round');
    expect(best!.efficiency).toBeGreaterThan(0.5);
  });
});
