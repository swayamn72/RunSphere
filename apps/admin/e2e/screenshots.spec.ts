import { test } from '@playwright/test';
import { mockApi, signIn } from './mock-api';

/**
 * Captures the sign-in page and the signed-in console at phone, tablet and
 * desktop widths in both themes, into `test-results/screenshots/`. These are
 * for looking at, not asserting on: the shell is redesigned in the next step,
 * so no baselines are committed yet.
 */
const widths = [
  { name: 'phone', width: 375, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
];

for (const theme of ['light', 'dark'] as const)
  for (const size of widths)
    test(`screenshots: ${theme} ${size.name}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('rs-theme', value), theme);
      await page.setViewportSize({ width: size.width, height: size.height });
      await mockApi(page, { roles: ['admin'] });
      await page.goto('/');
      await page.screenshot({
        path: `test-results/screenshots/sign-in-${theme}-${size.name}.png`,
        fullPage: true
      });
      await signIn(page);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.screenshot({
        path: `test-results/screenshots/console-${theme}-${size.name}.png`,
        fullPage: true
      });
    });
