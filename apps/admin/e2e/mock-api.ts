import type { Page } from '@playwright/test';

/**
 * Answers every `/v1` call without a server. Anything not listed gets an empty
 * collection, so an area that loads extra data still renders.
 */
export const mockApi = async (
  page: Page,
  options: { roles?: string[]; loginFails?: boolean } = {}
) => {
  const { roles = ['admin'], loginFails = false } = options;
  await page.route('**/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const reply = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (pathname === '/v1/auth/login')
      return loginFails
        ? reply(401, { message: 'Email or password is not right.' })
        : reply(200, { accessToken: 'access-token', refreshToken: 'refresh-token' });
    if (pathname === '/v1/staff/roles') return reply(200, { roles });
    return reply(200, { data: [] });
  });
};

export const signIn = async (page: Page) => {
  await page.getByLabel('Email').fill('staff@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Sign in' }).click();
};

/** Perceived lightness of an `rgb()` string, 0 (black) to 1 (white). */
export const lightness = (rgb: string): number => {
  const [r = 0, g = 0, b = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
