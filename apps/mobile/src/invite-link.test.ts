import { describe, expect, it } from 'vitest';
import { inviteTokenFromUrl } from './invite-link';

const TOKEN = 'Xk3_-abcdefghijklmnopqrstuvwxyz012';

describe('invite links', () => {
  it('reads the token from a RunSphere invite link', () => {
    expect(inviteTokenFromUrl(`runsphere://invite/${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFromUrl(` runsphere://invite/${TOKEN}/ `)).toBe(TOKEN);
  });

  it('ignores anything else, including other schemes and short tokens', () => {
    expect(inviteTokenFromUrl(null)).toBeUndefined();
    expect(inviteTokenFromUrl('exp+runsphere://expo-development-client/?url=x')).toBeUndefined();
    expect(inviteTokenFromUrl('runsphere://invite/short')).toBeUndefined();
    expect(inviteTokenFromUrl(`https://example.com/invite/${TOKEN}`)).toBeUndefined();
    expect(inviteTokenFromUrl(`runsphere://other/${TOKEN}`)).toBeUndefined();
    expect(inviteTokenFromUrl(`runsphere://invite/${TOKEN}?x=1`)).toBeUndefined();
  });
});
