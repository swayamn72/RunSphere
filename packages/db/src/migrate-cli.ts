import { createDatabase, defaultDatabaseUrl, migrate } from './index.js';

/**
 * The one-shot migrate job (M4.2): apply every pending migration against
 * `DATABASE_URL` (or `POSTGRES_*`), then exit. A deploy runs it once, before
 * rolling out API and worker images that only check the schema. It ships in both
 * images: `node packages/db/dist/migrate-cli.js`. `pnpm migrate` runs the same
 * file, so CI, local dev and a deployment can't disagree about the order.
 */
const db = createDatabase(defaultDatabaseUrl(process.env));
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
