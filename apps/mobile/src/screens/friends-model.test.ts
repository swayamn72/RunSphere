import { describe, expect, it } from 'vitest';
import type { BlockedAccount, FriendRequest, Profile } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import { AuthFailure } from '../auth-failure';
import {
  answerableRequests,
  blockFailureNotice,
  blockRows,
  friendListState,
  friendRows,
  friendsErrorState,
  friendsStatusMessage,
  inviteFailureNotice,
  INVITE_RECORDED_NOTICE,
  requestRows,
  respondFailureNotice,
  validateInviteEmail
} from './friends-model';

const profile = (id: string, displayName: string): Profile => ({
  id,
  displayName,
  cosmetic: { avatarKey: 'loop-1' },
  activityVisibility: 'private'
});

const request = (
  id: string,
  from: Profile,
  status: FriendRequest['status'] = 'pending'
): FriendRequest => ({
  id,
  accountId: from.id,
  counterpartProfile: from,
  status,
  createdAt: '2026-09-03T10:00:00.000Z'
});

const blocked = (id: string, displayName: string): BlockedAccount => ({
  profile: profile(id, displayName),
  blockedAt: '2026-09-03T10:00:00.000Z'
});

describe('invite validation', () => {
  it('accepts a normal address, trimmed and lowercased', () => {
    expect(validateInviteEmail('  Ravi@Example.COM ')).toEqual({
      ok: true,
      email: 'ravi@example.com'
    });
  });

  it('rejects what cannot be an address before spending a rate-limited attempt', () => {
    expect(validateInviteEmail('')).toMatchObject({ ok: false });
    expect(validateInviteEmail('ravi')).toMatchObject({ ok: false });
    expect(validateInviteEmail('ravi@example')).toMatchObject({ ok: false });
    expect(validateInviteEmail('a b@example.com')).toMatchObject({ ok: false });
    expect(validateInviteEmail(`${'a'.repeat(320)}@example.com`)).toMatchObject({ ok: false });
  });
});

describe('invite confirmation', () => {
  it('never claims the request reached anyone', () => {
    // The route answers 202 for a missing account, an existing friend, a
    // pending request, and a block alike, so the copy cannot imply delivery.
    expect(INVITE_RECORDED_NOTICE).toContain('If that address belongs to');
    expect(INVITE_RECORDED_NOTICE).not.toMatch(/\bsent\b|\bdelivered\b|\bnot found\b|\bexists\b/i);
  });

  it('names the rate limit rather than reporting a generic failure', () => {
    expect(inviteFailureNotice(new ApiFailure(429, 'Too many requests'))).toContain(
      'Try again in a minute'
    );
  });

  it('says nothing was sent on a transport failure', () => {
    expect(inviteFailureNotice(new AuthFailure('network'))).toContain('Nothing was sent');
    expect(inviteFailureNotice(new Error('boom'))).toContain('Nothing was sent');
  });
});

describe('answering a request', () => {
  it('reports a request that is no longer open as refreshable, not as an error', () => {
    expect(respondFailureNotice(new ApiFailure(404, 'Friend request not found'))).toContain(
      'no longer open'
    );
  });

  it('says nothing changed when the answer could not be recorded', () => {
    expect(respondFailureNotice(new AuthFailure('network'))).toContain('Nothing changed');
    expect(respondFailureNotice(new Error('boom'))).toContain('Nothing changed');
  });

  it('offers only pending requests, since the route returns incoming pending only', () => {
    const rows = answerableRequests([
      request('r1', profile('a', 'Ravi')),
      request('r2', profile('b', 'Ana'), 'accepted'),
      request('r3', profile('c', 'Dev'), 'revoked')
    ]);
    expect(rows.map((row) => row.id)).toEqual(['r1']);
  });
});

describe('blocking', () => {
  it('says nothing changed when a block could not be saved', () => {
    expect(blockFailureNotice(new AuthFailure('network'))).toContain('Nothing changed');
    expect(blockFailureNotice(new ApiFailure(404, 'Account not found'))).toContain(
      'no longer available'
    );
  });
});

describe('rows', () => {
  it('sorts friends by name and labels each one for a screen reader', () => {
    const rows = friendRows([profile('b', 'Ravi'), profile('a', 'Ana')]);
    expect(rows.map((row) => row.nameLabel)).toEqual(['Ana', 'Ravi']);
    expect(rows[0]!.accessibilityLabel).toBe('Ana. Friend.');
  });

  it('keeps an account with no display name addressable', () => {
    const rows = friendRows([{ ...profile('a', ''), displayName: '' }]);
    expect(rows[0]!.nameLabel).toBe('RunSphere member');
  });

  it('labels a request by who is waiting on an answer', () => {
    const rows = requestRows([request('r1', profile('a', 'Ravi'))]);
    expect(rows[0]!.accessibilityLabel).toBe('Ravi sent you a friend request.');
  });

  it('labels a blocked account as blocked', () => {
    const rows = blockRows([blocked('a', 'Ravi')]);
    expect(rows[0]).toEqual({
      accountId: 'a',
      nameLabel: 'Ravi',
      accessibilityLabel: 'Ravi. Blocked.'
    });
  });
});

describe('state', () => {
  it('is empty only when there is neither a friend nor a request', () => {
    expect(friendListState([], [])).toBe('empty');
    expect(friendListState([profile('a', 'Ana')], [])).toBe('ready');
    expect(friendListState([], [request('r1', profile('a', 'Ana'))])).toBe('ready');
  });

  it('maps transport failures the way every other screen does', () => {
    expect(friendsErrorState(new AuthFailure('network'))).toBe('offline');
    expect(friendsErrorState(new AuthFailure('tls'))).toBe('offline');
    expect(friendsErrorState(new AuthFailure('configuration'))).toBe('configuration');
    expect(friendsErrorState(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(friendsErrorState(new Error('boom'))).toBe('error');
  });
});

describe('status message', () => {
  it('speaks a notice ahead of anything else', () => {
    expect(friendsStatusMessage('ready', 'Request recorded.', 3)).toBe('Request recorded.');
  });

  it('counts waiting requests in words a screen reader can use', () => {
    expect(friendsStatusMessage('ready', '', 1)).toBe(
      'One friend request is waiting on your answer.'
    );
    expect(friendsStatusMessage('ready', '', 2)).toBe(
      '2 friend requests are waiting on your answer.'
    );
    expect(friendsStatusMessage('ready', '', 0)).toBe('');
  });

  it('announces an unavailable surface rather than staying silent', () => {
    expect(friendsStatusMessage('offline', '', 0)).toContain('offline');
    expect(friendsStatusMessage('configuration', '', 0)).toContain('configured');
    expect(friendsStatusMessage('loading', '', 0)).toBe('Loading friends.');
  });
});
