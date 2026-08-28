import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, type Database } from './index.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

const createDatabase = (): Database & { statements: string[] } => {
  const statements: string[] = [];
  const appliedVersions = new Set<string>();
  const client = {
    query: async (text: string, values?: readonly unknown[]) => {
      statements.push(text);
      if (text.startsWith('SELECT version FROM schema_migrations')) {
        const version = String(values?.[0]);
        return { rows: appliedVersions.has(version) ? [{ version }] : [] };
      }
      if (text.startsWith('INSERT INTO schema_migrations'))
        appliedVersions.add(String(values?.[0]));
      return { rows: [] };
    },
    release: () => undefined
  };
  return {
    statements,
    query: client.query,
    connect: async () => client as never,
    end: async () => undefined
  };
};

describe('migrations', () => {
  it('applies new files once in lexical order and preserves previously applied migrations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runsphere-migrations-'));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(join(directory, '010_later.sql'), 'SELECT 10;'),
      writeFile(join(directory, '002_first.sql'), 'SELECT 2;')
    ]);
    const db = createDatabase();

    await migrate(db, directory);

    expect(db.statements).toContain('SELECT 2;');
    expect(db.statements).toContain('SELECT 10;');
    expect(db.statements.indexOf('SELECT 2;')).toBeLessThan(db.statements.indexOf('SELECT 10;'));
    expect(
      db.statements.filter((statement) => statement.startsWith('INSERT INTO schema_migrations'))
    ).toHaveLength(2);

    await migrate(db, directory);

    expect(db.statements.filter((statement) => statement === 'SELECT 2;')).toHaveLength(1);
    expect(db.statements.filter((statement) => statement === 'SELECT 10;')).toHaveLength(1);
  });
});
