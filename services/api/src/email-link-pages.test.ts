import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { EMAIL_LINK_PAGE_PATHS } from './email-link-pages.js';

/**
 * M3.4 (B7): every link in an account email lands on a page, and no page
 * changes anything on a GET, because mail scanners prefetch links.
 */

const UNSUBSCRIBE_TOKEN = 'u'.repeat(43);

const fakeDatabase = (options: { tokenMatches?: boolean } = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('UPDATE email_unsubscribe_tokens'))
      return { rows: options.tokenMatches ? [{ account_id: 'account-1' }] : [] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return {
    query,
    calls,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    database(): Database {
      return this as unknown as Database;
    }
  };
};

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const appWith = (db: ReturnType<typeof fakeDatabase>) => {
  const app = buildApp({ db: db.database(), authSecret: 'email-link-pages-test-secret' });
  apps.push(app);
  return app;
};

describe('email link pages', () => {
  it.each(EMAIL_LINK_PAGE_PATHS)(
    '%s is a self-contained page that touches no data on GET',
    async (path) => {
      const db = fakeDatabase({ tokenMatches: true });
      const response = await appWith(db).inject({ method: 'GET', url: `${path}?token=abc` });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.body).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\//);
      // The token is read once and then taken out of the address bar.
      expect(response.body).toContain('window.history.replaceState');
      expect(db.calls).toHaveLength(0);
    }
  );

  it.each([
    ['/verify-email', '/v1/account/email-verification/complete'],
    ['/confirm-email-change', '/v1/account/email-change/complete'],
    ['/unsubscribe', '/v1/email/unsubscribe'],
    ['/reset-password', '/v1/account/password-reset/complete']
  ])('%s posts the token in the body to %s', async (path, endpoint) => {
    const response = await appWith(fakeDatabase()).inject({ method: 'GET', url: path });

    expect(response.body).toContain(endpoint);
    expect(response.body).toMatch(/JSON\.stringify\(\{ token(, newPassword)? \}\)/);
    expect(response.body).toMatch(/addEventListener\('(click|submit)'/);
  });

  it('asks for a password the API will accept, twice', async () => {
    const response = await appWith(fakeDatabase()).inject({
      method: 'GET',
      url: '/reset-password'
    });

    expect(response.body).toContain('autocomplete="new-password"');
    expect(response.body.match(/minlength="8"/g)).toHaveLength(2);
  });
});

describe('POST /unsubscribe (RFC 8058 one-click)', () => {
  const oneClick = (db: ReturnType<typeof fakeDatabase>, url: string) =>
    appWith(db).inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click'
    });

  it('switches campaign email off for the token in the link', async () => {
    const db = fakeDatabase({ tokenMatches: true });
    const response = await oneClick(db, `/unsubscribe?token=${UNSUBSCRIBE_TOKEN}`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    const sql = db.calls.map((call) => call.sql).join('\n');
    expect(sql).toContain('UPDATE notification_preferences');
    expect(sql).toContain("'marketing_email', false, 'unsubscribe_link'");
  });

  it('answers the same whether or not the token matched', async () => {
    const matched = await oneClick(
      fakeDatabase({ tokenMatches: true }),
      `/unsubscribe?token=${UNSUBSCRIBE_TOKEN}`
    );
    const unmatched = await oneClick(
      fakeDatabase({ tokenMatches: false }),
      `/unsubscribe?token=${UNSUBSCRIBE_TOKEN}`
    );

    expect(unmatched.statusCode).toBe(200);
    expect(unmatched.body).toBe(matched.body);
  });

  it('refuses a link without a usable token and touches nothing', async () => {
    const db = fakeDatabase({ tokenMatches: true });
    const response = await oneClick(db, '/unsubscribe?token=short');

    expect(response.statusCode).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it('leaves the rest of the API JSON-only', async () => {
    const response = await oneClick(fakeDatabase(), '/v1/email/unsubscribe');

    expect(response.statusCode).toBe(415);
  });
});
