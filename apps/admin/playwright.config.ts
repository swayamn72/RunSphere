import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks for the admin console. Deliberately not part of `pnpm test`
 * or CI yet: run `pnpm --filter @runsphere/admin test:e2e` after
 * `pnpm exec playwright install chromium`. Every `/v1` call is mocked in the
 * specs, so nothing here needs the API or a database.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Pin the browser to a dark OS so a passing test proves the app is light by
    // default rather than light because the machine was.
    colorScheme: 'dark',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } }],
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
