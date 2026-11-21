import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';
import { staffRoles } from './staff-roles.js';

const SECRET = 'staff-roles-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';

const fakeDatabase = (roles: { role: string }[]) => {
  const query = vi.fn(async (sql: string) =>
    sql.includes('FROM staff_role_assignments') ? { rows: roles } : { rows: [] }
  );
  return { query, connect: vi.fn(), end: vi.fn(async () => undefined) } as unknown as Database & {
    query: typeof query;
  };
};

describe('staffRoles', () => {
  it('returns the role names for the account with a parameterised query', async () => {
    const database = fakeDatabase([{ role: 'moderator' }, { role: 'operator' }]);

    await expect(staffRoles(database, 'account-1')).resolves.toEqual(['moderator', 'operator']);
    expect(database.query).toHaveBeenCalledWith(
      'SELECT role FROM staff_role_assignments WHERE account_id = $1 ORDER BY role',
      ['account-1']
    );
  });

  it('returns an empty list for an account with no roles', async () => {
    await expect(staffRoles(fakeDatabase([]), 'account-2')).resolves.toEqual([]);
  });
});

describe('GET /v1/staff/roles', () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const get = (database: Database, headers: Record<string, string> = {}) => {
    const app = buildApp({ db: database, authSecret: SECRET });
    apps.push(app);
    return app.inject({ method: 'GET', url: '/v1/staff/roles', headers });
  };
  const auth = { authorization: `Bearer ${createAccessToken(ME, SECRET)}` };

  it('lists the caller’s roles', async () => {
    const response = await get(fakeDatabase([{ role: 'privacy_officer' }]), auth);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ roles: ['privacy_officer'] });
  });

  it('answers an empty list for a runner with no staff roles', async () => {
    const response = await get(fakeDatabase([]), auth);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ roles: [] });
  });

  it('refuses a request with a token it did not sign', async () => {
    const response = await get(fakeDatabase([{ role: 'operator' }]), {
      authorization: `Bearer ${createAccessToken(ME, 'some-other-secret-of-enough-length')}`
    });

    expect(response.statusCode).toBe(401);
  });
});
