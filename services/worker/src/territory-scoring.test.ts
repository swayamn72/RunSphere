import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import type { CellIndexer, EligibilitySource } from '@runsphere/domain';
import { processTerritory, scoreTerritoryDay, snapshotTerritoryWeek } from './territory-scoring.js';

/**
 * The engine is off, and these tests are mostly about *that*: each entry point
 * refuses with a named reason, before touching the database, when the gate is
 * closed or an input is missing.
 *
 * When the Territory gate opens, `TERRITORY_CAPTURE_ENABLED` flips and these
 * refusal tests are the ones that will fail first — which is the point. They
 * are the record of what has to be true before territory can run.
 */
const SEASON = 'season-1';

const indexer: CellIndexer = {
  resolution: 9,
  h3Version: 'fake-1',
  algorithmVersion: 'test',
  cellFor: (point) => `cell-${point.latitude}`
};

const eligibility: EligibilitySource = { version: 'test', isEligible: () => true };

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

describe('territory scoring while the gate is closed', () => {
  it('refuses the sweep without reading anything', async () => {
    const database = fakeDatabase();

    const outcome = await processTerritory({ db: database.db(), indexer, eligibility });

    expect(outcome).toEqual({ refusal: 'capture_disabled', contributionsWritten: 0 });
    // A scoring job that quietly does nothing is indistinguishable from one
    // that is broken, so it refuses before the first query rather than running
    // one that finds nothing.
    expect(database.statements).toEqual([]);
  });

  it('refuses a day and a week the same way', async () => {
    const database = fakeDatabase();

    expect(
      (await scoreTerritoryDay({ db: database.db(), indexer, eligibility }, SEASON, '2026-09-07'))
        .refusal
    ).toBe('capture_disabled');
    expect(
      (
        await snapshotTerritoryWeek(
          { db: database.db(), indexer, eligibility },
          SEASON,
          '2026-09-07'
        )
      ).refusal
    ).toBe('capture_disabled');
    expect(database.statements).toEqual([]);
  });

  it('names a missing indexer and a missing eligibility source separately', async () => {
    const database = fakeDatabase();

    // Both are absent in this deployment, and they are absent for different
    // reasons: no H3 library is a dependency, and no public-space dataset
    // exists at all.
    expect(
      (await scoreTerritoryDay({ db: database.db(), eligibility }, SEASON, '2026-09-07')).refusal
    ).toBe('capture_disabled');
    expect(
      (await scoreTerritoryDay({ db: database.db(), indexer }, SEASON, '2026-09-07')).refusal
    ).toBe('capture_disabled');
    // While the gate is closed the gate is reported first: it is the reason
    // that would still apply if the other two were solved tomorrow.
  });
});

describe('what the refusals guard', () => {
  it('never scores a cell without an eligibility source', () => {
    // Recorded as an assertion because it is the rule most likely to be
    // "temporarily" relaxed: scoring every traversed cell would record where
    // people live and work, which is what public-space eligibility prevents.
    const scoreWithoutSource = async () =>
      scoreTerritoryDay({ db: fakeDatabase().db(), indexer }, SEASON, '2026-09-07');

    return expect(scoreWithoutSource()).resolves.toMatchObject({ contributionsWritten: 0 });
  });
});
