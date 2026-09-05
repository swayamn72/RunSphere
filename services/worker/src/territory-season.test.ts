import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import {
  checkSeasonConcentration,
  finalizeDueTerritoryWeeks,
  processTerritorySeasons,
  recomputeSeasonStandings
} from './territory-season.js';
import { snapshotTerritoryWeek } from './territory-scoring.js';

/**
 * Season upkeep is switched off with the rest of territory, so these tests are
 * about the refusals and about the one rule that can be asserted without the
 * engine: a week is never snapshotted before it has ended.
 *
 * When the Territory gate opens these are the tests that fail first, and what
 * they will then be asserting is the behaviour somebody has to write.
 */
const SEASON = 'season-1';

const fakeDatabase = () => {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return {
    statements,
    query,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    db(): Database {
      return this as unknown as Database;
    }
  };
};

describe('season upkeep while the gate is closed', () => {
  it('refuses the sweep without reading anything', async () => {
    const database = fakeDatabase();

    const outcome = await processTerritorySeasons({ db: database.db() });

    expect(outcome).toEqual({
      refusal: 'capture_disabled',
      weeksFinalized: 0,
      standingsWritten: 0,
      divisionsChecked: 0,
      awardsPausedDivisions: []
    });
    expect(database.statements).toEqual([]);
  });

  it('writes no standing and no concentration observation', async () => {
    const database = fakeDatabase();

    expect(await recomputeSeasonStandings(database.db(), SEASON)).toBe(0);
    expect(await checkSeasonConcentration(database.db(), SEASON, '2026-09-14')).toEqual({
      divisionsChecked: 0,
      awardsPausedDivisions: []
    });
    // A concentration row is an assertion about a division of real people. One
    // written from an empty season would be a fact about nothing.
    expect(database.statements).toEqual([]);
  });

  it('finalizes no week', async () => {
    const database = fakeDatabase();

    const finalized = await finalizeDueTerritoryWeeks(
      { db: database.db() },
      {
        id: SEASON,
        starts_at: new Date('2026-09-07T00:00:00.000Z'),
        ends_at: new Date('2026-10-19T00:00:00.000Z')
      },
      new Date('2026-10-20T00:00:00.000Z')
    );

    expect(finalized).toBe(0);
    expect(database.statements).toEqual([]);
  });
});

describe('what a week snapshot refuses', () => {
  it('will not snapshot a week that is still running', async () => {
    const database = fakeDatabase();

    // The gate answers first today. The check that matters when it opens is
    // the second one, and it is asserted here so the rule is recorded before
    // anything depends on it: a week is immutable once written (ADR-0006), so
    // writing version 1 of a week still in progress would make it wrong.
    const outcome = await snapshotTerritoryWeek(
      { db: database.db() },
      SEASON,
      '2026-09-07',
      new Date('2026-09-10T00:00:00.000Z')
    );

    expect(outcome.refusal).toBe('capture_disabled');
    expect(database.statements).toEqual([]);
  });
});
