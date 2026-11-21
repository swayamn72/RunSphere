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

/**
 * Whether the PostGIS integration suites should run.
 *
 * They are gated because the default `pnpm test` must work with no database.
 * The danger in that is quiet: with the gate closed every `describePostgis`
 * becomes `describe.skip`, the run is **green**, and nothing says that the only
 * tests which exercise real SQL did not execute. CI has had a PostGIS service
 * and these variables since the first workflow, so a green run there has always
 * meant they ran — but one typo in the workflow would have turned that off
 * silently and forever.
 *
 * Defined once, here, so `requirePostgisInCi` below can make that failure loud.
 */
export const postgisIntegrationEnabled = (environment: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(environment.RUN_POSTGIS_INTEGRATION) &&
  Boolean(environment.DATABASE_URL ?? environment.POSTGRES_PASSWORD);

/**
 * In CI, a skipped PostGIS suite is a failure rather than a silence.
 *
 * Called from a plain `it` in every integration file, so it runs whether or not
 * the suite itself does. Outside CI it asserts nothing: a developer with no
 * database is the case the gate exists for.
 */
export const requirePostgisInCi = (environment: NodeJS.ProcessEnv = process.env): void => {
  if (environment.CI !== 'true') return;
  if (postgisIntegrationEnabled(environment)) return;
  throw new Error(
    'PostGIS integration tests are gated off in CI. Set RUN_POSTGIS_INTEGRATION=1 and DATABASE_URL, or these suites pass by not running.'
  );
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

/** Migration files in `directory` that the database has not recorded as applied. */
export const pendingMigrations = async (
  db: Database,
  directory = migrationDirectory
): Promise<string[]> => {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  try {
    const applied = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
    const done = new Set(applied.rows.map((row) => row.version));
    return files.filter((file) => !done.has(file));
  } catch (error) {
    // 42P01 undefined_table: a database that has never been migrated.
    if ((error as { code?: string }).code === '42P01') return files;
    throw error;
  }
};

/**
 * Whether a service applies migrations itself when it starts (M4.2, R10).
 *
 * Deployed images (`NODE_ENV=production`) don't: a bad migration applied on
 * boot takes the API and worker down together, and every replica queues on the
 * migration lock. There the deploy runs the one-shot `migrate-cli` first and
 * services only check. Local dev keeps migrating on boot so `pnpm dev:api`
 * still just works. `MIGRATE_ON_BOOT=true|false` overrides either default.
 */
export const migratesOnBoot = (environment: NodeJS.ProcessEnv): boolean => {
  if (environment.MIGRATE_ON_BOOT === 'true') return true;
  if (environment.MIGRATE_ON_BOOT === 'false') return false;
  return environment.NODE_ENV !== 'production';
};

/**
 * Get the schema ready for a starting service: migrate when
 * {@link migratesOnBoot} says so, otherwise refuse to start while any
 * migration is pending, since this build's queries assume them. A database
 * *ahead* of the build is accepted, so a rollback to the previous image works.
 */
export const prepareSchema = async (
  db: Database,
  environment: NodeJS.ProcessEnv,
  directory = migrationDirectory
): Promise<void> => {
  if (migratesOnBoot(environment)) {
    await migrate(db, directory);
    return;
  }
  const pending = await pendingMigrations(db, directory);
  if (pending.length > 0)
    throw new Error(
      `The database is missing ${pending.length} migration(s), starting with ${pending[0]}. ` +
        'Run the migrate job (node packages/db/dist/migrate-cli.js) before starting this service.'
    );
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
