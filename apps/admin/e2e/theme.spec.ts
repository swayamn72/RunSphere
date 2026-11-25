import { expect, test } from '@playwright/test';
import { lightness, mockApi } from './mock-api';

test.beforeEach(async ({ page }) => mockApi(page));

const canvas = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('theme (ADR-0016)', () => {
  test('is light by default, even on a dark device', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(lightness(await canvas(page))).toBeGreaterThan(0.85);
  });

  test('follows the device only when asked to', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('rs-theme', 'system'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(lightness(await canvas(page))).toBeLessThan(0.15);

    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('applies a saved dark choice before the app has loaded, so nothing flashes', async ({
    page
  }) => {
    await page.addInitScript(() => localStorage.setItem('rs-theme', 'dark'));
    // Stop the React bundle: the theme must come from the page head alone.
    await page.route('**/src/main.tsx*', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(lightness(await canvas(page))).toBeLessThan(0.15);
    // The browser chrome colour follows the theme, from the canvas token.
    const chrome = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(chrome).toBeTruthy();
  });

  test('falls back to light when the saved value is junk', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('rs-theme', 'sepia'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('loads Inter rather than a system face', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() =>
      [...document.fonts].some((face) => face.family.includes('Inter') && face.status === 'loaded')
    );
    expect(loaded).toBe(true);
  });
});
