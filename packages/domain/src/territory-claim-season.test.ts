import { describe, expect, it } from 'vitest';
import {
  beatsRecord,
  hallOfFameCandidates,
  heldDays,
  isCurrentSeason,
  peakAreaSqm,
  previousSeasonMonth,
  daysUntilSeasonEnd,
  isSeasonEndingSoon,
  rankWeekStart,
  seasonEndedMessage,
  seasonEndsAt,
  seasonsDueForReset,
  turfStandings,
  weeklyRankMessage,
  type TurfHolding
} from './territory-claim-season.js';

const holding = (
  accountId: string,
  totalAreaSqm: number,
  extra: Partial<TurfHolding> = {}
): TurfHolding => ({
  accountId,
  totalAreaSqm,
  claimCount: 1,
  largestClaimSqm: totalAreaSqm,
  longestHeldDays: 0,
  ...extra
});

describe('ranking a season', () => {
  it('puts the most ground first', () => {
    const standings = turfStandings([
      holding('b', 20_000),
      holding('a', 50_000),
      holding('c', 30_000)
    ]);

    expect(standings.map((entry) => entry.accountId)).toEqual(['a', 'c', 'b']);
    expect(standings.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it('shares a rank on a tie and skips the next one', () => {
    // Two runners on 30,000 m² are both second, and the next one is fourth.
    const standings = turfStandings([
      holding('a', 50_000),
      holding('b', 30_000),
      holding('c', 30_000),
      holding('d', 10_000)
    ]);

    expect(standings.map((entry) => entry.rank)).toEqual([1, 2, 2, 4]);
  });

  it('orders a tie the same way every time it is asked', () => {
    // A snapshot taken twice must not disagree with itself about who is listed
    // first, so equal rows fall back to a stable key.
    const holdings = [holding('b', 30_000), holding('a', 30_000)];

    expect(turfStandings(holdings).map((entry) => entry.accountId)).toEqual(
      turfStandings([...holdings].reverse()).map((entry) => entry.accountId)
    );
  });

  it('leaves out anybody holding nothing', () => {
    // A board listing people against a zero reads as a wall of shame.
    expect(turfStandings([holding('a', 0), holding('b', 10_000)])).toHaveLength(1);
  });

  it('is empty rather than throwing when nobody holds anything', () => {
    expect(turfStandings([])).toEqual([]);
  });
});

describe('what a season is remembered by', () => {
  it('keeps the largest figure any snapshot recorded', () => {
    // Held 90,000 in week two, 20,000 at the end. The season was the 90,000.
    expect(peakAreaSqm(20_000, [90_000, 40_000])).toBe(90_000);
  });

  it('falls back to the final total when no week was recorded', () => {
    expect(peakAreaSqm(20_000, [])).toBe(20_000);
  });

  it('is never negative', () => {
    expect(peakAreaSqm(0, [])).toBe(0);
  });
});

describe('the hall of fame', () => {
  it('nominates the biggest holding and the biggest single claim separately', () => {
    const standings = turfStandings([
      holding('spread', 60_000, { claimCount: 6, largestClaimSqm: 12_000 }),
      holding('one-big', 40_000, { claimCount: 1, largestClaimSqm: 40_000 })
    ]);
    const candidates = hallOfFameCandidates(standings);

    expect(candidates).toEqual([
      { recordType: 'largest_holding', accountId: 'spread', valueSqm: 60_000 },
      { recordType: 'largest_claim', accountId: 'one-big', valueSqm: 40_000 }
    ]);
  });

  it('nominates nobody when nobody held anything', () => {
    expect(hallOfFameCandidates([])).toEqual([]);
  });

  it('treats an unset record as beatable and a tie as not', () => {
    expect(beatsRecord(10_000, undefined)).toBe(true);
    expect(beatsRecord(10_001, 10_000)).toBe(true);
    // A tie does not take a record, for the same reason it does not carve
    // ground: whoever got there first keeps it.
    expect(beatsRecord(10_000, 10_000)).toBe(false);
    expect(beatsRecord(9_999, 10_000)).toBe(false);
  });
});

describe('when a season is over', () => {
  it('resets a month that has passed and leaves the current one alone', () => {
    const now = new Date('2026-10-05T06:00:00.000Z');

    expect(seasonsDueForReset(['2026-09', '2026-10'], now)).toEqual(['2026-09']);
  });

  it('closes several missed months oldest first', () => {
    // A deployment that was off for two months closes both, in order.
    const now = new Date('2026-11-02T06:00:00.000Z');

    expect(seasonsDueForReset(['2026-10', '2026-09'], now)).toEqual(['2026-09', '2026-10']);
  });

  it('has nothing to do when the only open season is the current one', () => {
    expect(seasonsDueForReset(['2026-09'], new Date('2026-09-15T06:00:00.000Z'))).toEqual([]);
  });

  it('uses the Kolkata month, so the 1st starts in Kolkata and not in UTC', () => {
    // 19:00 UTC on 30 September is already 1 October in Kolkata, where the
    // reset runs — so September is due.
    expect(seasonsDueForReset(['2026-09'], new Date('2026-09-30T19:00:00.000Z'))).toEqual([
      '2026-09'
    ]);
    expect(seasonsDueForReset(['2026-09'], new Date('2026-09-30T17:00:00.000Z'))).toEqual([]);
  });

  it('knows which season is being played', () => {
    expect(isCurrentSeason('2026-09', new Date('2026-09-15T06:00:00.000Z'))).toBe(true);
    expect(isCurrentSeason('2026-08', new Date('2026-09-15T06:00:00.000Z'))).toBe(false);
  });

  it('steps back a month, over a year boundary', () => {
    expect(previousSeasonMonth('2026-10')).toBe('2026-09');
    expect(previousSeasonMonth('2026-01')).toBe('2025-12');
  });

  it('refuses a season month that is not one', () => {
    expect(() => previousSeasonMonth('October')).toThrow(/YYYY-MM/);
  });
});

describe('the week a rank belongs to', () => {
  it('is the Kolkata Monday', () => {
    // 2026-09-09 is a Wednesday; its week began Monday the 7th.
    expect(rankWeekStart(new Date('2026-09-09T06:00:00.000Z'))).toBe('2026-09-07');
  });

  it('treats a Monday as its own week', () => {
    expect(rankWeekStart(new Date('2026-09-07T06:00:00.000Z'))).toBe('2026-09-07');
  });

  it('treats a Sunday as the week that is ending, not the one starting', () => {
    expect(rankWeekStart(new Date('2026-09-13T06:00:00.000Z'))).toBe('2026-09-07');
  });

  it('rolls over at Kolkata midnight and not at UTC midnight', () => {
    // 20:00 UTC on Sunday the 13th is Monday the 14th in Kolkata.
    expect(rankWeekStart(new Date('2026-09-13T20:00:00.000Z'))).toBe('2026-09-14');
  });

  it('is the shape the schema stores', () => {
    expect(rankWeekStart(new Date('2026-01-01T00:00:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('how long ground has been held', () => {
  it('floors to whole days', () => {
    const claimed = new Date('2026-09-01T06:00:00.000Z');

    expect(heldDays(claimed, new Date('2026-09-19T05:00:00.000Z'))).toBe(17);
    expect(heldDays(claimed, new Date('2026-09-19T07:00:00.000Z'))).toBe(18);
  });

  it('is never negative for a claim in the future', () => {
    expect(
      heldDays(new Date('2026-09-19T06:00:00.000Z'), new Date('2026-09-01T06:00:00.000Z'))
    ).toBe(0);
  });
});

describe('what a runner is told', () => {
  it('names the city and the peak, and never a coordinate', () => {
    const message = seasonEndedMessage({
      seasonMonth: '2026-09',
      rank: 4,
      peakAreaSqm: 48_200,
      cityTag: 'Mumbai'
    });

    expect(message).toContain('#4');
    expect(message).toContain('Mumbai');
    expect(message).toContain('48,200');
    expect(message).toContain('New season starts now');
    // No coordinates, no route, no named rival (`screens.md` push rules).
    expect(message).not.toMatch(/\d+\.\d{4}/);
  });

  it('says nothing about a place for somebody whose ground is untagged', () => {
    const message = seasonEndedMessage({ seasonMonth: '2026-09', rank: 9, peakAreaSqm: 1_000 });

    expect(message).toContain('#9');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain(' in ');
  });

  it('reports a week without telling anybody to try harder', () => {
    const message = weeklyRankMessage({ rank: 2, totalAreaSqm: 31_400, cityTag: 'Mumbai' });

    expect(message).toContain('#2');
    expect(message).toContain('31,400');
    expect(message).not.toMatch(/keep|harder|should|must/i);
  });
});

describe('when a season closes', () => {
  // Kolkata is UTC+05:30, so 00:01 IST on the 1st is 18:31 UTC on the last day
  // of the previous month.
  it('closes at 00:01 IST on the first of the next month', () => {
    expect(seasonEndsAt(new Date('2026-09-15T12:00:00Z')).toISOString()).toBe(
      '2026-09-30T18:31:00.000Z'
    );
  });

  it('rolls the year over in December', () => {
    expect(seasonEndsAt(new Date('2026-12-20T12:00:00Z')).toISOString()).toBe(
      '2026-12-31T18:31:00.000Z'
    );
  });

  it('counts the days left, rounded up', () => {
    // 2026-09-28 18:31 UTC is exactly two days before the close.
    expect(daysUntilSeasonEnd(new Date('2026-09-28T18:31:00Z'))).toBe(2);
    // Half a day later is still "one more day to go", not zero.
    expect(daysUntilSeasonEnd(new Date('2026-09-30T06:00:00Z'))).toBe(1);
  });

  it('opens the warning window in the last three days and not before', () => {
    expect(isSeasonEndingSoon(new Date('2026-09-15T12:00:00Z'))).toBe(false);
    // Five days out.
    expect(isSeasonEndingSoon(new Date('2026-09-26T18:00:00Z'))).toBe(false);
    expect(isSeasonEndingSoon(new Date('2026-09-28T18:00:00Z'))).toBe(true);
    expect(isSeasonEndingSoon(new Date('2026-09-30T12:00:00Z'))).toBe(true);
  });

  it('closes the window once the season has ended', () => {
    // Past the boundary the month has rolled over, so this is the *new*
    // season, which is a month away from ending rather than zero days.
    expect(isSeasonEndingSoon(new Date('2026-10-01T00:00:00Z'))).toBe(false);
    expect(daysUntilSeasonEnd(new Date('2026-10-01T00:00:00Z'))).toBe(31);
  });

  it('handles a short month', () => {
    expect(seasonEndsAt(new Date('2026-02-10T12:00:00Z')).toISOString()).toBe(
      '2026-02-28T18:31:00.000Z'
    );
    expect(isSeasonEndingSoon(new Date('2026-02-26T18:00:00Z'))).toBe(true);
  });
});
