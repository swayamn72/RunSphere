import { expect, test } from '@playwright/test';
import { goTo, lightness, mockApi, nav, openAccountMenu, signIn } from './mock-api';

test.describe('console frame', () => {
  test('switches theme from the account menu and remembers it across a reload', async ({
    page
  }) => {
    await mockApi(page);
    await page.goto('/');
    await signIn(page);

    await openAccountMenu(page);
    await expect(page.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('rs-theme'))).toBe('dark');
    expect(
      lightness(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    ).toBeLessThan(0.15);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('"Match device" follows the OS and changes with it while open', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await signIn(page);
    await openAccountMenu(page);
    await page.getByRole('menuitemradio', { name: 'Match device' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('keeps the open area in the address bar, and Back returns to the one before', async ({
    page
  }) => {
    await mockApi(page);
    await page.goto('/');
    await signIn(page);
    await expect(page).toHaveURL(/area=review/);

    await goTo(page, 'Quests');
    await expect(page).toHaveURL(/area=quests/);
    await expect(page.getByRole('heading', { level: 1, name: 'Quests' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/area=review/);
    await expect(page.getByRole('heading', { level: 1, name: 'Activity review' })).toBeVisible();
  });

  test('opens the area a link names after sign-in, but never one the role does not allow', async ({
    page
  }) => {
    await mockApi(page, { roles: ['admin'] });
    await page.goto('/?area=moderation');
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
  });

  test('ignores a linked area the account may not open', async ({ page }) => {
    await mockApi(page, { roles: ['moderator'] });
    await page.goto('/?area=campaigns');
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Activity review' })).toBeVisible();
    await expect(
      nav(page).getByRole('button', { name: 'Campaign email', exact: true })
    ).toHaveCount(0);
  });

  test('signs out and shows the sign-in form again with nothing left behind', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await signIn(page);
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to review' })).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveValue('');
  });

  test('has a skip link and a single level-one heading', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await signIn(page);
    await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main'
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 800 } });

    test('keeps the areas behind a menu and closes it after a choice', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await signIn(page);
      await expect(nav(page)).toBeHidden();

      const menu = page.getByRole('button', { name: 'Menu' });
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await goTo(page, 'Quests');
      await expect(nav(page)).toBeHidden();
      await expect(page.getByRole('heading', { level: 1, name: 'Quests' })).toBeVisible();
    });

    test('never scrolls the page sideways', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await signIn(page);
      for (const area of ['Moderation', 'Competitions', 'Campaign email', 'Quests']) {
        await goTo(page, area);
        await expect(page.getByRole('heading', { level: 1, name: area })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, area).toBeLessThanOrEqual(0);
      }
    });
  });
});
