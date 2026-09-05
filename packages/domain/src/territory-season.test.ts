import { describe, expect, it } from 'vitest';
import {
  TERRITORY_CONCENTRATION_LIMITS,
  canRollBackTerritoryWeek,
  closedTerritoryWeeks,
  concentrationApplies,
  concentrationBreachRun,
  concentrationPausesAwards,
  divisionConcentration,
  seasonStandings,
  territoryControlCarriesForward,
  territoryWeekClosed,
  territoryWeekOf
} from './territory-season.js';

/** 2026-09-07 is a Monday in Asia/Kolkata. */
const MONDAY = '2026-09-07';
const kolkata = (iso: string) => new Date(iso);

describe('when a territory week may be snapshotted', () => {
  it('is not closed while it is still running', () => {
    // Sunday evening of the same week, Kolkata.
    expect(territoryWeekClosed(MONDAY, kolkata('2026-09-13T17:00:00.000Z'))).toBe(false);
  });

  it('closes at the start of the next Kolkata Monday', () => {
    // 2026-09-14 00:00 Kolkata is 2026-09-13 18:30 UTC.
    expect(territoryWeekClosed(MONDAY, kolkata('2026-09-13T18:29:00.000Z'))).toBe(false);
    expect(territoryWeekClosed(MONDAY, kolkata('2026-09-13T18:30:00.000Z'))).toBe(true);
  });

  it('reads a week from any instant inside it', () => {
    expect(territoryWeekOf(kolkata('2026-09-10T04:00:00.000Z'))).toBe(MONDAY);
  });
});

describe('the weeks of a season', () => {
  it('lists only the weeks that have ended', () => {
    const weeks = closedTerritoryWeeks(
      kolkata('2026-09-07T00:00:00.000Z'),
      kolkata('2026-10-19T00:00:00.000Z'),
      kolkata('2026-09-25T00:00:00.000Z')
    );

    // Two full weeks have ended by 25 September; the third is still running.
    expect(weeks).toEqual(['2026-09-07', '2026-09-14']);
  });

  it('is empty before the first week is over', () => {
    expect(
      closedTerritoryWeeks(
        kolkata('2026-09-07T00:00:00.000Z'),
        kolkata('2026-10-19T00:00:00.000Z'),
        kolkata('2026-09-09T00:00:00.000Z')
      )
    ).toEqual([]);
  });

  it('stops at the season end rather than running on to today', () => {
    const weeks = closedTerritoryWeeks(
      kolkata('2026-09-07T00:00:00.000Z'),
      kolkata('2026-09-21T00:00:00.000Z'),
      kolkata('2027-01-01T00:00:00.000Z')
    );

    expect(weeks).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
  });

  it('refuses to loop forever on a season with an absurd end date', () => {
    const weeks = closedTerritoryWeeks(
      kolkata('2026-09-07T00:00:00.000Z'),
      kolkata('2400-01-01T00:00:00.000Z'),
      kolkata('2400-01-01T00:00:00.000Z')
    );

    expect(weeks).toHaveLength(120);
  });

  it('never carries control from one week into the next', () => {
    // ADR-0008: cells reset to unclaimed weekly. The reset is structural —
    // a new week has no control rows — and this is the assertion of that.
    expect(territoryControlCarriesForward).toBe(false);
  });
});

describe('season standings', () => {
  const row = (participantRef: string, weekStartsOn: string, points: number) => ({
    participantRef,
    weekStartsOn,
    points
  });

  it('accumulates across weeks even though cells reset', () => {
    const standings = seasonStandings([
      row('alice', '2026-09-07', 12),
      row('alice', '2026-09-14', 8),
      row('bob', '2026-09-07', 15)
    ]);

    expect(standings).toEqual([
      { participantRef: 'alice', points: 20, rank: 1, weeksScored: 2 },
      { participantRef: 'bob', points: 15, rank: 2, weeksScored: 1 }
    ]);
  });

  it('lets equal points share a rank and skips the next', () => {
    const standings = seasonStandings([
      row('alice', '2026-09-07', 10),
      row('bob', '2026-09-07', 10),
      row('carol', '2026-09-07', 4)
    ]);

    expect(standings.map((entry) => entry.rank)).toEqual([1, 1, 3]);
  });

  it('renders a tie in the same order every time', () => {
    const rows = [row('bob', '2026-09-07', 10), row('alice', '2026-09-07', 10)];

    expect(seasonStandings(rows)).toEqual(seasonStandings([...rows].reverse()));
  });

  it('does not count a scoreless week as a week scored', () => {
    const standings = seasonStandings([
      row('alice', '2026-09-07', 5),
      row('alice', '2026-09-14', 0)
    ]);

    expect(standings[0]).toMatchObject({ points: 5, weeksScored: 1 });
  });
});

describe('division concentration guardrails', () => {
  const evenDivision = (participants: number, each = 10) =>
    Array.from({ length: participants }, () => each);

  it('is clean when a large division is evenly spread', () => {
    const concentration = divisionConcentration(evenDivision(100));

    expect(concentration.breached).toBe(false);
    expect(concentration.topParticipantShare).toBeCloseTo(0.01);
    expect(concentration.topDecileShare).toBeCloseTo(0.1);
  });

  it('breaches when one participant holds more than 8% of the points', () => {
    const points = [...evenDivision(99, 1), 20];
    const concentration = divisionConcentration(points);

    expect(concentration.topParticipantShare).toBeGreaterThan(
      TERRITORY_CONCENTRATION_LIMITS.topParticipantShare
    );
    expect(concentration.breached).toBe(true);
  });

  it('breaches when the top tenth holds more than 35%', () => {
    // Ten of a hundred hold 40 points each; the rest hold one.
    const points = [...evenDivision(10, 40), ...evenDivision(90, 1)];
    const concentration = divisionConcentration(points);

    expect(concentration.topDecileShare).toBeGreaterThan(
      TERRITORY_CONCENTRATION_LIMITS.topDecileShare
    );
    expect(concentration.breached).toBe(true);
  });

  it('reports a division too small for the guardrail rather than breaching it daily', () => {
    // Twelve participants splitting points perfectly evenly still each hold
    // 8.3%, so the 8% limit cannot be met at that size. That is a fact about
    // arithmetic, not about the season, and it must not read as a breach.
    expect(concentrationApplies(12)).toBe(false);
    expect(concentrationApplies(13)).toBe(true);

    const concentration = divisionConcentration(evenDivision(12));
    expect(concentration.applicable).toBe(false);
    expect(concentration.breached).toBe(false);
  });

  it('is quiet on a division nobody has scored in', () => {
    const concentration = divisionConcentration(evenDivision(100, 0));

    expect(concentration).toMatchObject({ totalPoints: 0, breached: false, topDecileShare: 0 });
  });

  it('is quiet on an empty division', () => {
    expect(divisionConcentration([])).toMatchObject({ participants: 0, breached: false });
  });
});

describe('a sustained breach', () => {
  it('counts consecutive days and resets on the first clean one', () => {
    expect(concentrationBreachRun(3, true)).toBe(4);
    expect(concentrationBreachRun(6, false)).toBe(0);
  });

  it('pauses awards analysis only after seven consecutive days', () => {
    expect(concentrationPausesAwards(6)).toBe(false);
    expect(concentrationPausesAwards(7)).toBe(true);
  });
});

describe('rolling a week back', () => {
  it('accepts an earlier existing version', () => {
    expect(canRollBackTerritoryWeek(3, 1)).toBe(true);
    expect(canRollBackTerritoryWeek(3, 2)).toBe(true);
  });

  it('refuses the current version, a later one, and a nonsense one', () => {
    // Rolling "back" to what is already current would look like an action and
    // change nothing; rolling forward is a recomputation, not a rollback.
    expect(canRollBackTerritoryWeek(3, 3)).toBe(false);
    expect(canRollBackTerritoryWeek(3, 4)).toBe(false);
    expect(canRollBackTerritoryWeek(3, 0)).toBe(false);
    expect(canRollBackTerritoryWeek(3, 1.5)).toBe(false);
  });
});
