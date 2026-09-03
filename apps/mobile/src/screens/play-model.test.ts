import { describe, expect, it } from 'vitest';
import type { ChallengeSummary, FriendStandingsResponse, Profile } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure.js';
import { ApiFailure } from '../api-client.js';
import {
  challengeListState,
  challengeOutcomeLine,
  challengeWindowLabel,
  createChallengeFailure,
  daysRemaining,
  groupChallenges,
  invitableFriends,
  playErrorState,
  respondChallengeFailure,
  standingRows,
  standingsState
} from './play-model.js';

const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';

const profile = (id: string, displayName: string): Profile => ({
  id,
  displayName,
  cosmetic: { avatarKey: 'loop-1' },
  activityVisibility: 'private'
});

const challenge = (overrides: Partial<ChallengeSummary> = {}): ChallengeSummary => ({
  id: 'challenge-1',
  mode: 'active_minutes',
  lengthDays: 3,
  status: 'invited',
  role: 'opponent',
  periodStart: '2026-08-31',
  periodEnd: '2026-09-03',
  opponent: profile(RAVI, 'Ravi'),
  ruleVersion: '1',
  createdAt: '2026-08-31T04:00:00.000Z',
  ...overrides
});

describe('groupChallenges', () => {
  it('separates invites to answer from invites that are merely pending', () => {
    const groups = groupChallenges([
      challenge({ id: 'incoming', role: 'opponent' }),
      challenge({ id: 'outgoing', role: 'challenger' })
    ]);
    expect(groups.incoming.map((entry) => entry.id)).toEqual(['incoming']);
    expect(groups.outgoing.map((entry) => entry.id)).toEqual(['outgoing']);
  });

  it('treats accepted and active as in progress and keeps finished separate', () => {
    const groups = groupChallenges([
      challenge({ id: 'a', status: 'accepted' }),
      challenge({ id: 'b', status: 'active' }),
      challenge({ id: 'c', status: 'finished' })
    ]);
    expect(groups.active.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(groups.finished.map((entry) => entry.id)).toEqual(['c']);
  });

  it('drops declined and cancelled challenges rather than reporting them as history', () => {
    const groups = groupChallenges([
      challenge({ id: 'a', status: 'declined' }),
      challenge({ id: 'b', status: 'cancelled' })
    ]);
    expect([...groups.incoming, ...groups.outgoing, ...groups.active, ...groups.finished]).toEqual(
      []
    );
    expect(challengeListState(groups)).toBe('empty');
  });

  it('is ready as soon as any group has an entry', () => {
    expect(challengeListState(groupChallenges([challenge()]))).toBe('ready');
    expect(challengeListState(groupChallenges([]))).toBe('empty');
  });
});

describe('challenge window labels', () => {
  it('counts whole days left and never goes negative', () => {
    expect(daysRemaining('2026-09-03', '2026-08-31')).toBe(3);
    expect(daysRemaining('2026-09-03', '2026-09-03')).toBe(0);
    expect(daysRemaining('2026-09-03', '2026-09-10')).toBe(0);
    expect(daysRemaining('not-a-date', '2026-09-03')).toBe(0);
  });

  it('describes an invite by its length, not by a window that has not started', () => {
    expect(challengeWindowLabel(challenge({ status: 'invited' }), '2026-09-01')).toBe(
      '3-day challenge'
    );
  });

  it('says the result is being counted once an active window has closed', () => {
    expect(challengeWindowLabel(challenge({ status: 'active' }), '2026-09-03')).toBe(
      'Counting the final results'
    );
    expect(challengeWindowLabel(challenge({ status: 'active' }), '2026-09-02')).toBe('1 day left');
    expect(challengeWindowLabel(challenge({ status: 'active' }), '2026-08-31')).toBe('3 days left');
  });

  it('dates a finished challenge instead of counting down', () => {
    expect(challengeWindowLabel(challenge({ status: 'finished' }), '2026-09-05')).toBe(
      'Ended 2026-09-03'
    );
  });
});

describe('challengeOutcomeLine', () => {
  const finished = challenge({ status: 'finished' });

  it('reports the stored scores and the winner from the reader’s side', () => {
    expect(
      challengeOutcomeLine(
        finished,
        {
          participants: [
            { accountId: ME, score: 120 },
            { accountId: RAVI, score: 45 }
          ],
          winnerAccountId: ME
        },
        ME
      )
    ).toEqual({ label: 'You finished ahead', detail: '120 to 45 active minutes.' });
  });

  it('names the opponent when they finished ahead', () => {
    expect(
      challengeOutcomeLine(
        finished,
        {
          participants: [
            { accountId: ME, score: 45 },
            { accountId: RAVI, score: 120 }
          ],
          winnerAccountId: RAVI
        },
        ME
      ).label
    ).toBe('Ravi finished ahead');
  });

  it('reports a tie as a tie rather than a loss', () => {
    expect(
      challengeOutcomeLine(
        finished,
        {
          participants: [
            { accountId: ME, score: 60 },
            { accountId: RAVI, score: 60 }
          ]
        },
        ME
      )
    ).toEqual({ label: 'Tied', detail: '60 to 60 active minutes.' });
  });

  it('reports an unscored window as counting, never as a zero or a loss', () => {
    const line = challengeOutcomeLine(finished, undefined, ME);
    expect(line.label).toBe('Counting');
    expect(line.detail).not.toMatch(/\b0\b|lost|behind/i);
  });
});

describe('failure copy', () => {
  it('turns a refused mode or length into the server’s own reason', () => {
    expect(
      createChallengeFailure(
        new ApiFailure(422, "Challenge mode 'quest_completion' is not available yet")
      )
    ).toMatch(/quest_completion/);
    expect(createChallengeFailure(new ApiFailure(409, 'conflict'))).toMatch(/already have/);
    expect(createChallengeFailure(new ApiFailure(404, 'gone'))).toMatch(/no longer available/);
    expect(createChallengeFailure(new ApiFailure(503, 'unavailable'))).toMatch(/not available/);
    expect(createChallengeFailure(new AuthFailure('network'))).toMatch(/offline/);
    expect(createChallengeFailure(new Error('boom'))).toMatch(/could not be created/);
  });

  it('explains a closed invite instead of reporting a generic failure', () => {
    expect(respondChallengeFailure(new ApiFailure(409, 'conflict'))).toMatch(/no longer open/);
    expect(respondChallengeFailure(new AuthFailure('tls'))).toMatch(/offline/);
    expect(respondChallengeFailure(new Error('boom'))).toMatch(/could not be saved/);
  });

  it('separates offline, unconfigured, and expired sessions', () => {
    expect(playErrorState(new AuthFailure('network'))).toBe('offline');
    expect(playErrorState(new AuthFailure('configuration'))).toBe('configuration');
    expect(playErrorState(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(playErrorState(new Error('boom'))).toBe('error');
  });
});

describe('standings', () => {
  const standings: FriendStandingsResponse = {
    periodStart: '2026-08-31',
    periodEnd: '2026-09-07',
    participating: true,
    ruleVersion: '1',
    entries: [
      { profile: profile(RAVI, 'Ravi'), rank: 1, cappedActiveMinutes: 200, isSelf: false },
      { profile: profile(ME, 'Maya'), rank: 2, cappedActiveMinutes: 120, isSelf: true }
    ]
  };

  it('renders served ranks and scores with a self-identifying label', () => {
    const rows = standingRows(standings);
    expect(rows.map((row) => [row.rank, row.nameLabel, row.minutesLabel])).toEqual([
      [1, 'Ravi', '200 min'],
      [2, 'Maya (you)', '120 min']
    ]);
    expect(rows[1]?.isSelf).toBe(true);
    expect(rows[1]?.accessibilityLabel).toBe('Rank 2, Maya (you), 120 counted active minutes');
    // A board row is one score: never pace, distance, or where anyone went.
    expect(JSON.stringify(rows)).not.toMatch(/pace|speed|distance|km|route|latitude|longitude/i);
  });

  it('is empty rather than ready when the account has not joined the board', () => {
    expect(standingsState({ ...standings, participating: false, entries: [] })).toBe('empty');
    expect(standingsState({ ...standings, entries: [] })).toBe('empty');
    expect(standingsState(standings)).toBe('ready');
    expect(standingsState(undefined)).toBe('loading');
  });
});

describe('invitableFriends', () => {
  it('hides friends who already have an open challenge in any live state', () => {
    const friends = [profile(RAVI, 'Ravi'), profile('friend-2', 'Ana')];
    for (const status of ['invited', 'accepted', 'active'] as const) {
      expect(invitableFriends(friends, [challenge({ status })]).map((entry) => entry.id)).toEqual([
        'friend-2'
      ]);
    }
  });

  it('offers a friend again once the challenge is finished, declined, or cancelled', () => {
    const friends = [profile(RAVI, 'Ravi')];
    for (const status of ['finished', 'declined', 'cancelled'] as const) {
      expect(invitableFriends(friends, [challenge({ status })])).toHaveLength(1);
    }
  });
});
