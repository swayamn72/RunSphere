import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R11: the console kept only the 15-minute access token and never refreshed,
 * so staff were signed out mid-task. The fake server rotates like the real one:
 * each refresh token works once, and reusing a spent one revokes the session.
 */
const fakeServer = () => {
  const state = { access: 'access-0', refreshCalls: 0, revoked: false, spent: new Set<string>() };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/v1/auth/login'))
      return new Response(JSON.stringify({ accessToken: 'access-0', refreshToken: 'refresh-0' }));
    if (url.endsWith('/v1/auth/refresh')) {
      state.refreshCalls += 1;
      const { refreshToken } = JSON.parse(String(init?.body)) as { refreshToken: string };
      if (state.spent.has(refreshToken) || state.revoked) {
        state.revoked = true;
        return new Response(JSON.stringify({ message: 'Invalid refresh token' }), { status: 401 });
      }
      state.spent.add(refreshToken);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.access = `access-${state.refreshCalls}`;
      return new Response(
        JSON.stringify({ accessToken: state.access, refreshToken: `refresh-${state.refreshCalls}` })
      );
    }
    const authorization = new Headers(init?.headers).get('authorization');
    return authorization === `Bearer ${state.access}` && !state.revoked
      ? new Response(JSON.stringify({ roles: ['admin'] }))
      : new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
  });
  return { state, fetchMock };
};

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('staff session refresh (R11)', () => {
  it('rotates an expired token once for parallel calls and keeps working', async () => {
    const { state, fetchMock } = fakeServer();
    vi.stubGlobal('fetch', fetchMock);
    const api = await import('./api');
    const { accessToken } = await api.signIn('staff@example.test', 'a-long-password');

    state.access = 'expired-elsewhere'; // the 15 minutes have passed
    const results = await Promise.all(
      Array.from({ length: 4 }, () => api.getStaffRoles(accessToken))
    );

    expect(results).toEqual(Array.from({ length: 4 }, () => ({ roles: ['admin'] })));
    expect(state.refreshCalls).toBe(1);
    expect(state.revoked).toBe(false);
    // Later calls passing the original token still use the rotated one.
    await expect(api.getStaffRoles(accessToken)).resolves.toEqual({ roles: ['admin'] });
    expect(state.refreshCalls).toBe(1);
  });

  it('surfaces the 401 when the session cannot be refreshed', async () => {
    const { state, fetchMock } = fakeServer();
    vi.stubGlobal('fetch', fetchMock);
    const api = await import('./api');
    const { accessToken } = await api.signIn('staff@example.test', 'a-long-password');

    state.access = 'expired-elsewhere';
    state.revoked = true;

    await expect(api.getStaffRoles(accessToken)).rejects.toMatchObject({
      name: 'HttpError',
      status: 401
    });
  });
});
