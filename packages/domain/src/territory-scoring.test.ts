import { describe, expect, it } from 'vitest';
import {
  bestContiguousWindow,
  dailyContribution,
  parseTerritoryScoringRule,
  resolveCellControl,
  weeklyLadderPoints,
  type CellIndexer,
  type EligibilitySource,
  type TracePoint
} from './territory-scoring.js';

const rule = parseTerritoryScoringRule({
  bestWindowMinutes: 60,
  dailyEligibleCellCap: 40,
  weeklyControlDayCap: 20
});

/**
 * A fake indexer that reads the cell straight off the latitude, so a test can
 * say "these points are in these cells" without depending on H3 itself. The
 * real indexer is injected for exactly this reason.
 */
const indexer: CellIndexer = {
  resolution: 9,
  h3Version: 'fake-1',
  algorithmVersion: 'test',
  cellFor: (point) => `cell-${point.latitude}`
};

const allEligible: EligibilitySource = { version: 'test', isEligible: () => true };

const at = (minutes: number): Date => new Date(Date.UTC(2026, 8, 7, 3, minutes));

/** A point in cell N at minute M of the day. */
const point = (cell: number, minutes: number): TracePoint => ({
  latitude: cell,
  longitude: 72,
  at: at(minutes)
});

describe('the published scoring rule', () => {
  it('refuses a malformed rule rather than scoring under a guess', () => {
    expect(() => parseTerritoryScoringRule(null)).toThrow(/JSON object/);
    expect(() => parseTerritoryScoringRule({ ...rule, bestWindowMinutes: 0 })).toThrow(
      /bestWindowMinutes/
    );
    expect(() => parseTerritoryScoringRule({ ...rule, dailyEligibleCellCap: -1 })).toThrow(
      /dailyEligibleCellCap/
    );
  });
});

describe('the best contiguous window of a day', () => {
  it('picks the hour covering the most distinct cells', () => {
    const points = [
      point(1, 0),
      point(2, 10),
      // A denser hour later in the day: four cells rather than two.
      point(3, 200),
      point(4, 210),
      point(5, 220),
      point(6, 230)
    ];

    expect(bestContiguousWindow(points, rule, indexer, allEligible)?.cells).toEqual([
      'cell-3',
      'cell-4',
      'cell-5',
      'cell-6'
    ]);
  });

  it('counts a cell once however long somebody stays in it', () => {
    const still = [point(1, 0), point(1, 10), point(1, 20), point(1, 50)];
    const moving = [point(1, 0), point(2, 10)];

    // Pace neutrality in one assertion: standing still scores its one cell,
    // and passing through two scores two, whatever the speed.
    expect(bestContiguousWindow(still, rule, indexer, allEligible)?.cells).toEqual(['cell-1']);
    expect(bestContiguousWindow(moving, rule, indexer, allEligible)?.cells).toHaveLength(2);
  });

  it('breaks a tie by the earliest start', () => {
    const points = [point(1, 0), point(2, 5), point(3, 200), point(4, 205)];
    const window = bestContiguousWindow(points, rule, indexer, allEligible);

    expect(window?.cells).toEqual(['cell-1', 'cell-2']);
    expect(window?.startsAt).toEqual(at(0));
  });

  it('is a span of wall-clock time, not a pick of favourable points', () => {
    // Three cells spread over 90 minutes: no 60-minute window holds all three.
    const points = [point(1, 0), point(2, 45), point(3, 90)];

    expect(bestContiguousWindow(points, rule, indexer, allEligible)?.cells).toHaveLength(2);
  });

  it('excludes a cell the eligibility source rejects', () => {
    const eligibility: EligibilitySource = {
      version: 'test',
      isEligible: (cell) => cell !== 'cell-2'
    };
    const points = [point(1, 0), point(2, 5), point(3, 10)];

    expect(bestContiguousWindow(points, rule, indexer, eligibility)?.cells).toEqual([
      'cell-1',
      'cell-3'
    ]);
  });

  it('finds nothing when no cell is eligible', () => {
    const none: EligibilitySource = { version: 'test', isEligible: () => false };

    expect(bestContiguousWindow([point(1, 0)], rule, indexer, none)).toBeUndefined();
  });
});

describe("one day's accepted contribution", () => {
  it('holds the day to the published cap', () => {
    const capped = parseTerritoryScoringRule({ ...rule, dailyEligibleCellCap: 2 });
    const points = [point(1, 0), point(2, 5), point(3, 10), point(4, 15)];

    expect(dailyContribution(points, capped, indexer, allEligible)?.cells).toEqual([
      'cell-1',
      'cell-2'
    ]);
  });

  it('records the local day the window started in', () => {
    expect(dailyContribution([point(1, 0)], rule, indexer, allEligible)?.localDate).toBe(
      '2026-09-07'
    );
  });

  it('is nothing at all for a day with no points', () => {
    expect(dailyContribution([], rule, indexer, allEligible)).toBeUndefined();
  });
});

describe('weekly cell control', () => {
  const contribution = (
    cell: string,
    ref: string,
    localDate: string,
    acceptedAt = new Date('2026-09-07T10:00:00.000Z')
  ) => ({ cellIndex: cell, participantRef: ref, localDate, acceptedAt });

  it('goes to whoever contributed on the most days', () => {
    const control = resolveCellControl([
      contribution('cell-1', 'alice', '2026-09-07'),
      contribution('cell-1', 'alice', '2026-09-08'),
      contribution('cell-1', 'bob', '2026-09-09')
    ]);

    expect(control).toEqual([{ cellIndex: 'cell-1', participantRef: 'alice', days: 2 }]);
  });

  it('counts days rather than visits, so repetition in one day wins nothing', () => {
    const control = resolveCellControl([
      // Bob passed through three times on one day; Alice came on two days.
      contribution('cell-1', 'bob', '2026-09-07'),
      contribution('cell-1', 'bob', '2026-09-07'),
      contribution('cell-1', 'bob', '2026-09-07'),
      contribution('cell-1', 'alice', '2026-09-07'),
      contribution('cell-1', 'alice', '2026-09-08')
    ]);

    expect(control[0]?.participantRef).toBe('alice');
  });

  it('breaks a tie by the earliest accepted contribution', () => {
    const control = resolveCellControl([
      contribution('cell-1', 'bob', '2026-09-07', new Date('2026-09-07T12:00:00.000Z')),
      contribution('cell-1', 'alice', '2026-09-08', new Date('2026-09-07T09:00:00.000Z'))
    ]);

    expect(control[0]?.participantRef).toBe('alice');
  });

  it('falls back to the opaque reference only when everything else ties', () => {
    const same = new Date('2026-09-07T09:00:00.000Z');
    const control = resolveCellControl([
      contribution('cell-1', 'bob', '2026-09-07', same),
      contribution('cell-1', 'alice', '2026-09-07', same)
    ]);

    // A documented reproducibility fallback, not a fair tiebreak.
    expect(control[0]?.participantRef).toBe('alice');
  });

  it('never lets input order decide control', () => {
    const rows = [
      contribution('cell-1', 'alice', '2026-09-07'),
      contribution('cell-1', 'alice', '2026-09-08'),
      contribution('cell-1', 'bob', '2026-09-09')
    ];

    expect(resolveCellControl(rows)).toEqual(resolveCellControl([...rows].reverse()));
  });

  it('resolves each cell independently', () => {
    const control = resolveCellControl([
      contribution('cell-2', 'bob', '2026-09-07'),
      contribution('cell-1', 'alice', '2026-09-07')
    ]);

    expect(control.map((entry) => entry.cellIndex)).toEqual(['cell-1', 'cell-2']);
  });
});

describe('weekly ladder points', () => {
  const control = (ref: string, days: number, cell: string) => ({
    cellIndex: cell,
    participantRef: ref,
    days
  });

  it('adds up the control-days a participant actually earned', () => {
    expect(
      weeklyLadderPoints([control('alice', 3, 'a'), control('alice', 2, 'b')], 'alice', rule)
    ).toBe(5);
  });

  it('counts nobody else towards them', () => {
    expect(weeklyLadderPoints([control('bob', 5, 'a')], 'alice', rule)).toBe(0);
  });

  it('holds a week to the published cap, which is what stops speed winning', () => {
    const many = Array.from({ length: 30 }, (_unused, index) =>
      control('alice', 1, `cell-${index}`)
    );

    expect(weeklyLadderPoints(many, 'alice', rule)).toBe(20);
  });
});
