import { createDatabase, defaultDatabaseUrl, migrate } from '../packages/db/dist/index.js';

/**
 * Apply every migration, in order, against `DATABASE_URL`.
 *
 * The integration suites already call `migrate()` in their own `beforeAll`, so
 * this is not what makes them work. It exists to make a schema failure **its
 * own red step**: applied from inside a test, a migration that will not run
 * surfaces as whichever assertion happened to come first in whichever suite
 * happened to start first, which is a confusing way to learn that the schema is
 * broken.
 *
 * It uses the same `migrate()` the services use rather than reimplementing the
 * ordering and the ledger, so this can never disagree with what a deployment
 * does. That is also why it runs after `build`: it imports the built package.
 */
const url = defaultDatabaseUrl(process.env);
const db = createDatabase(url);
try {
  await migrate(db);
  console.log('Migrations applied.');
} catch (error) {
  // The message only. A connection string carries a password.
  console.error(`Migrations failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
