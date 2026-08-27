import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface Database {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

export const createDatabase = (connectionString: string): Database =>
  new Pool({ connectionString });

export const defaultDatabaseUrl = (environment: NodeJS.ProcessEnv): string => {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;
  const user = encodeURIComponent(environment.POSTGRES_USER ?? 'runsphere');
  const password = encodeURIComponent(environment.POSTGRES_PASSWORD ?? '');
  const database = encodeURIComponent(environment.POSTGRES_DB ?? 'runsphere');
  const port = environment.POSTGRES_HOST_PORT ?? '5432';
  return `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
};

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const migrationDirectory = join(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'infra/postgres/migrations'
);

export const migrate = async (db: Database, directory = migrationDirectory): Promise<void> => {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['runsphere-schema-migrations']);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const applied = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [file]
      );
      if (applied.rows.length > 0) continue;
      try {
        await client.query('BEGIN');
        await client.query(await readFile(join(directory, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['runsphere-schema-migrations']);
    client.release();
  }
};

export const withTransaction = async <T>(
  db: Database,
  work: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
