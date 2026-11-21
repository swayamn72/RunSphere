import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migratesOnBoot, pendingMigrations, prepareSchema, type Database } from './index.js';

/** M4.2 (R10): deployed services check the schema; only the migrate job changes it. */

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'runsphere-migrations-'));
  for (const file of ['001_first.sql', '002_second.sql', '003_third.sql', 'README.md'])
    await writeFile(join(directory, file), 'SELECT 1;');
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const databaseWith = (applied: string[] | 'no ledger') => {
  const query = vi.fn(async () => {
    if (applied === 'no ledger')
      throw Object.assign(new Error('relation "schema_migrations" does not exist'), {
        code: '42P01'
      });
    return { rows: applied.map((version) => ({ version })) };
  });
  return { query, connect: vi.fn(), end: vi.fn() } as unknown as Database & {
    query: typeof query;
    connect: ReturnType<typeof vi.fn>;
  };
};

describe('migratesOnBoot', () => {
  it('migrates in local dev and only checks in a deployed image', () => {
    expect(migratesOnBoot({})).toBe(true);
    expect(migratesOnBoot({ NODE_ENV: 'development' })).toBe(true);
    expect(migratesOnBoot({ NODE_ENV: 'production' })).toBe(false);
  });

  it('lets MIGRATE_ON_BOOT override either default', () => {
    expect(migratesOnBoot({ NODE_ENV: 'production', MIGRATE_ON_BOOT: 'true' })).toBe(true);
    expect(migratesOnBoot({ MIGRATE_ON_BOOT: 'false' })).toBe(false);
  });
});

describe('pendingMigrations', () => {
  it('lists the SQL files the ledger has not recorded, in order', async () => {
    await expect(pendingMigrations(databaseWith(['001_first.sql']), directory)).resolves.toEqual([
      '002_second.sql',
      '003_third.sql'
    ]);
  });

  it('treats a never-migrated database as having everything pending', async () => {
    await expect(pendingMigrations(databaseWith('no ledger'), directory)).resolves.toHaveLength(3);
  });

  it('passes on any other database error', async () => {
    const db = databaseWith([]);
    db.query.mockRejectedValueOnce(
      Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
    );
    await expect(pendingMigrations(db, directory)).rejects.toThrow('connection refused');
  });
});

describe('prepareSchema in a deployed image', () => {
  const production = { NODE_ENV: 'production' };

  it('refuses to start while a migration is pending, naming the first', async () => {
    const db = databaseWith(['001_first.sql']);
    await expect(prepareSchema(db, production, directory)).rejects.toThrow(
      'missing 2 migration(s), starting with 002_second.sql'
    );
    // Checked, never applied: no connection was taken for the migration lock.
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('starts when the schema is current', async () => {
    const db = databaseWith(['001_first.sql', '002_second.sql', '003_third.sql']);
    await expect(prepareSchema(db, production, directory)).resolves.toBeUndefined();
  });

  it('starts on a schema ahead of the build, so rolling back an image works', async () => {
    const db = databaseWith(['001_first.sql', '002_second.sql', '003_third.sql', '004_newer.sql']);
    await expect(prepareSchema(db, production, directory)).resolves.toBeUndefined();
  });
});
