import { defineConfig } from 'vitest/config';

/**
 * `testTimeout` is raised well above vitest's 5-second default.
 *
 * Every route test file builds a whole Fastify app — every route in the
 * product, with its schema compilation — and since the PostGIS suites actually
 * started running, this package also opens real database connections while the
 * worker package runs its own suites concurrently. Seven unrelated route tests
 * were failing with "Test timed out in 5000ms" purely from that load, which
 * reads as a broken product and is not one.
 *
 * A generous timeout is the right trade here: a genuinely hung test still
 * fails, just later, while a slow one on a loaded runner stops being a
 * coin-flip.
 */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 120_000 }
});
