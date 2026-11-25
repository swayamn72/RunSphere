import type { Page } from '@playwright/test';

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Answers every `/v1` call without a server and records what was sent, so a
 * spec can assert the exact request a form makes. Anything not listed gets an
 * empty collection, so an area that loads extra data still renders.
 */
export const mockApi = async (
  page: Page,
  options: {
    roles?: string[];
    loginFails?: boolean;
    /** Response bodies by `${METHOD} ${path}`. */
    responses?: Record<string, unknown>;
    /** Calls the server refuses, by `${METHOD} ${path}`. */
    refusals?: Record<string, string>;
  } = {}
) => {
  const { roles = ['admin'], loginFails = false, responses = {}, refusals = {} } = options;
  const calls: RecordedCall[] = [];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const reply = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method !== 'GET' && method !== 'OPTIONS')
      calls.push({ method, path: pathname, body: request.postDataJSON() });

    if (pathname === '/v1/auth/login')
      return loginFails
        ? reply(401, { message: 'Email or password is not right.' })
        : reply(200, { accessToken: 'access-token', refreshToken: 'refresh-token' });
    if (pathname === '/v1/staff/roles') return reply(200, { roles });
    const refusal = refusals[`${method} ${pathname}`];
    if (refusal !== undefined) return reply(409, { message: refusal });
    const custom = responses[`${method} ${pathname}`];
    if (custom !== undefined) return reply(200, custom);
    return method === 'GET' ? reply(200, { data: [] }) : reply(200, {});
  });
  return { calls, last: () => calls[calls.length - 1] };
};

export const signIn = async (page: Page) => {
  await page.getByLabel('Email').fill('staff@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Sign in' }).click();
};

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Operations areas' });

/** Opens an area by its exact name, opening the menu first where the sidebar is collapsed. */
export const goTo = async (page: Page, area: string) => {
  // Wait for the signed-in shell: the Menu button doesn't exist before it.
  // A CSS locator: getByRole can't see a nav that is collapsed with display: none.
  await page.locator('nav[aria-label="Operations areas"]').waitFor({ state: 'attached' });
  const menu = page.getByRole('button', { name: 'Menu' });
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) !== 'true')
    await menu.click();
  await nav(page).getByRole('button', { name: area, exact: true }).click();
};

/** Opens the account menu at the foot of the sidebar, opening the phone menu first if needed. */
export const openAccountMenu = async (page: Page) => {
  await page.locator('nav[aria-label="Operations areas"]').waitFor({ state: 'attached' });
  const menu = page.getByRole('button', { name: 'Menu' });
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) !== 'true')
    await menu.click();
  await page.getByRole('button', { name: 'Account' }).click();
};

/** Perceived lightness of an `rgb()` string, 0 (black) to 1 (white). */
export const lightness = (rgb: string): number => {
  const [r = 0, g = 0, b = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
