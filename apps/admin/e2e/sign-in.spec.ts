import { expect, test } from '@playwright/test';
import { mockApi, signIn } from './mock-api';

test.describe('sign-in and navigation', () => {
  test('signs a staff account in and offers the areas its roles allow', async ({ page }) => {
    await mockApi(page, { roles: ['moderator'] });
    await page.goto('/');
    await signIn(page);

    const nav = page.getByRole('navigation', { name: 'Operations areas' });
    await expect(nav.getByRole('button', { name: 'Moderation' })).toBeVisible();
    // A moderator is not a season operator: the server would refuse these.
    await expect(nav.getByRole('button', { name: 'Competitions' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Campaign email' })).toHaveCount(0);
  });

  test('offers an account with no staff role only the review queue, which the server still gates', async ({
    page
  }) => {
    await mockApi(page, { roles: [] });
    await page.goto('/');
    await signIn(page);
    // Activity review is open to any signed-in account on purpose (areas.ts
    // ANY_STAFF), so NO_ROLES_MESSAGE is never reached today.
    const nav = page.getByRole('navigation', { name: 'Operations areas' });
    await expect(nav.getByRole('button')).toHaveCount(1);
    await expect(nav.getByRole('button', { name: 'Activity review' })).toBeVisible();
  });

  test('shows the reason when sign-in fails, and stays on the form', async ({ page }) => {
    await mockApi(page, { loginFails: true });
    await page.goto('/');
    await signIn(page);
    await expect(page.getByRole('alert')).toContainText('not right');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('moves between areas', async ({ page }) => {
    await mockApi(page, { roles: ['admin'] });
    await page.goto('/');
    await signIn(page);
    const nav = page.getByRole('navigation', { name: 'Operations areas' });
    await nav.getByRole('button', { name: 'Data stewardship' }).click();
    await expect(nav.getByRole('button', { name: 'Data stewardship' })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });
});
