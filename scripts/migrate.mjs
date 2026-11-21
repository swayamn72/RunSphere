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
 * It runs the same migrate job a deployment runs (`packages/db/src/migrate-cli.ts`),
 * so this can never disagree with what a deployment does. That is also why it
 * runs after `build`: it imports the built package.
 */
import '../packages/db/dist/migrate-cli.js';
