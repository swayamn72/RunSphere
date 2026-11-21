import { describe, expect, it } from 'vitest';
import type {
  TerritoryClaimSeasonListResponse,
  TerritoryHallOfFameEntry
} from '@runsphere/contracts';
import {
  HALL_EMPTY,
  RECAP_EMPTY,
  hallEmptyMessage,
  monthLabel,
  recapView,
  recordRows,
  seasonRows
} from './season-history-model';

const entry = (overrides: Partial<TerritoryHallOfFameEntry> = {}): TerritoryHallOfFameEntry => ({
  recordType: 'largest_holding',
  valueSqm: 250_000,
  displayName: 'Ravi',
  seasonMonth: '2026-10',
  achievedAt: '2026-10-20T00:00:00.000Z',
  note: 'Most ground held at once.',
  ...overrides
});

describe('season recap, hall of fame and seasons (M2.5, M2.6)', () => {
  it('words a month', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('nonsense')).toBe('nonsense');
  });

  it('shows numbers first in a recap, with the place and any records', () => {
    const view = recapView({
      recap: {
        seasonMonth: '2026-10',
        rank: 3,
        cityTag: 'Mumbai',
        peakAreaSqm: 120_000,
        finalAreaSqm: 90_000,
        claimCount: 4,
        longestHeldDays: 1,
        records: [entry({ recordType: 'largest_claim', valueSqm: 60_000 })]
      }
    });
    expect('empty' in view).toBe(false);
    if ('empty' in view) return;
    expect(view.title).toBe('October 2026 recap');
    expect(view.headline).toMatch(/^#3 in Mumbai with /);
    expect(view.lines).toContain('4 claims');
    expect(view.lines).toContain('Longest held: 1 day');
    expect(view.lines.some((line) => line.startsWith('Record: Biggest single loop'))).toBe(true);
  });

  it('says why there is no recap rather than showing a blank card', () => {
    expect(recapView({ unavailableReason: 'held_nothing' })).toEqual({
      empty: RECAP_EMPTY.held_nothing
    });
    expect(recapView({})).toEqual({ empty: RECAP_EMPTY.no_finished_season });
  });

  it('lists records with their holder and season, or says there are none', () => {
    const response = {
      scope: 'city' as const,
      entries: [entry()],
      note: 'x'
    };
    expect(recordRows(response)[0]).toMatchObject({
      title: expect.stringMatching(/^Most ground held, /),
      detail: 'Ravi · October 2026'
    });
    expect(hallEmptyMessage(response)).toBeUndefined();
    expect(hallEmptyMessage({ ...response, entries: [] })).toBe(HALL_EMPTY.none);
    expect(hallEmptyMessage({ ...response, entries: [], unavailableReason: 'no_place_yet' })).toBe(
      HALL_EMPTY.no_place_yet
    );
  });

  it('lists seasons newest first and marks the running one', () => {
    const list: TerritoryClaimSeasonListResponse = {
      data: [
        {
          seasonMonth: '2026-09',
          startedAt: '2026-09-01T00:00:00.000Z',
          claimsArchived: 1,
          isCurrent: false
        },
        {
          seasonMonth: '2026-11',
          startedAt: '2026-11-01T00:00:00.000Z',
          claimsArchived: 0,
          isCurrent: true
        },
        {
          seasonMonth: '2026-10',
          startedAt: '2026-10-01T00:00:00.000Z',
          claimsArchived: 5,
          isCurrent: false
        }
      ],
      currentSeasonMonth: '2026-11',
      currentSeasonEndsAt: '2026-12-01T00:00:00.000Z'
    };
    const rows = seasonRows(list);
    expect(rows.map((row) => row.title)).toEqual([
      'November 2026',
      'October 2026',
      'September 2026'
    ]);
    expect(rows[0]!.detail).toBe('Running now');
    expect(rows[2]!.detail).toBe('1 claim held at the end');
  });
});
