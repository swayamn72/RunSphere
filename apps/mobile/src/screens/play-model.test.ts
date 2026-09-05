import { describe, expect, it } from 'vitest';
import type {
  ChallengeSummary,
  CompetitionSummary,
  FriendStandingsResponse,
  GlobalBoardResponse,
  Profile
} from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure.js';
import { ApiFailure } from '../api-client.js';
import {
  COMPETITION_ENTRY_CONSEQUENCE,
  GLOBAL_BOARD_JOIN_CONSEQUENCE,
  challengeListState,
  challengeOutcomeLine,
  challengeWindowLabel,
  createChallengeFailure,
  daysRemaining,
  groupChallenges,
  invitableFriends,
  playErrorState,
  respondChallengeFailure,
  competitionFailureNotice,
  competitionProvisionalNotice,
  competitionRows,
  competitionStandingRows,
  currentCompetition,
  globalBoardEmptyMessage,
  globalBoardRows,
  globalBoardState,
  globalDivisionLabel,
  globalSelfLabel,
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

describe('global board rows', () => {
  const board = (overrides: Partial<GlobalBoardResponse> = {}): GlobalBoardResponse => ({
    periodStart: '2026-08-31',
    periodEnd: '2026-09-07',
    participating: true,
    division: 'rising',
    ruleVersion: 1,
    me: { rank: 2, cappedActiveMinutes: 120 },
    entries: [
      {
        profile: {
          id: 'account-ravi',
          displayName: 'Ravi',
          cosmetic: { avatarKey: 'loop-1' },
          activityVisibility: 'private'
        },
        rank: 1,
        cappedActiveMinutes: 200,
        isSelf: false
      },
      {
        profile: {
          id: 'account-me',
          displayName: 'Maya',
          cosmetic: { avatarKey: 'loop-1' },
          activityVisibility: 'private'
        },
        rank: 2,
        cappedActiveMinutes: 120,
        isSelf: true
      }
    ],
    ...overrides
  });

  it('renders the served ranks and marks the reader, without renumbering', () => {
    const rows = globalBoardRows(board());

    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(rows[1]?.nameLabel).toBe('Maya (you)');
    expect(rows[0]?.accessibilityLabel).toBe('Rank 1, Ravi, 200 counted active minutes');
  });

  it('keeps a gap when a blocked account is missing from the page', () => {
    const rows = globalBoardRows(
      board({ entries: [board().entries[0]!, { ...board().entries[1]!, rank: 4 }] })
    );

    // The rank is a fact about the period, not about who is looking.
    expect(rows.map((row) => row.rank)).toEqual([1, 4]);
  });

  it('names a division in words rather than showing its key', () => {
    expect(globalDivisionLabel('newcomer')).toBe('Newcomers');
    expect(globalDivisionLabel('rising')).toBe('Rising');
    expect(globalDivisionLabel('established')).toBe('Established');
    // A division published later is shown as it comes rather than dropped.
    expect(globalDivisionLabel('veteran')).toBe('veteran');
    expect(globalDivisionLabel(undefined)).toBe('');
  });

  /** An unranked reader has no `me` at all, rather than a `me` of undefined. */
  const unranked = (overrides: Partial<GlobalBoardResponse> = {}): GlobalBoardResponse => {
    const next = { ...board(overrides) };
    delete next.me;
    return next;
  };

  it('shows the reader own standing only once the server has ranked them', () => {
    expect(globalSelfLabel(board())).toBe('You are #2 with 120 min');
    expect(globalSelfLabel(unranked())).toBeUndefined();
  });

  it('separates "nobody else yet" from "you are not ranked yet"', () => {
    expect(globalBoardEmptyMessage(board({ entries: [] }))).toContain(
      'Nobody else in your division'
    );
    expect(globalBoardEmptyMessage(unranked({ entries: [] }))).toContain(
      'Your first counted minutes'
    );
  });

  it('treats an unloaded board as loading and an unjoined one as empty', () => {
    expect(globalBoardState(undefined)).toBe('loading');
    expect(globalBoardState(board({ participating: false, entries: [] }))).toBe('empty');
    expect(globalBoardState(board({ entries: [] }))).toBe('empty');
    expect(globalBoardState(board())).toBe('ready');
  });

  it('says what joining publishes and what it never does', () => {
    expect(GLOBAL_BOARD_JOIN_CONSEQUENCE).toContain('display name');
    expect(GLOBAL_BOARD_JOIN_CONSEQUENCE).toContain('Never your route, pace, distance');
    expect(GLOBAL_BOARD_JOIN_CONSEQUENCE).toContain('leave at any time');
  });
});

describe('scheduled competitions', () => {
  const summary = (overrides: Partial<CompetitionSummary> = {}): CompetitionSummary => ({
    id: 'competition-1',
    title: 'September steady week',
    mode: 'active_minutes',
    status: 'published',
    periodStart: '2026-09-07',
    periodEnd: '2026-09-14',
    minPriorActiveWeeks: 0,
    rewards: 'A cosmetic badge',
    disputePeriodHours: 48,
    participantCount: 12,
    enrolled: false,
    eligible: true,
    ruleVersion: 1,
    createdAt: '2026-09-01T04:00:00.000Z',
    ...overrides
  });

  it('states the window, the field, and the published rewards', () => {
    const [row] = competitionRows([summary()]);

    expect(row?.statusLabel).toBe('Announced');
    expect(row?.windowLabel).toBe('2026-09-07 to 2026-09-14');
    expect(row?.participantLabel).toBe('12 entrants');
    expect(row?.rewardsLabel).toBe('A cosmetic badge');
    expect(row?.canEnter).toBe(true);
  });

  it('states an eligibility band whether or not the reader clears it', () => {
    const clears = competitionRows([summary({ minPriorActiveWeeks: 4, eligible: true })])[0];
    const misses = competitionRows([summary({ minPriorActiveWeeks: 4, eligible: false })])[0];

    expect(clears?.eligibilityLabel).toContain('4 or more earlier active weeks');
    expect(clears?.eligibilityLabel).not.toContain('not you yet');
    expect(misses?.eligibilityLabel).toContain('not you yet');
    // An account that cannot enter is not offered a control that would fail.
    expect(misses?.canEnter).toBe(false);
    // An open competition states no band at all rather than an empty one.
    expect(competitionRows([summary()])[0]?.eligibilityLabel).toBeUndefined();
  });

  it('keeps an entrant able to leave even if they would no longer qualify', () => {
    const row = competitionRows([
      summary({ minPriorActiveWeeks: 8, eligible: false, enrolled: true })
    ])[0];

    expect(row?.canEnter).toBe(true);
  });

  it('offers no entry once the window has closed', () => {
    expect(competitionRows([summary({ status: 'closed' })])[0]?.canEnter).toBe(false);
    expect(competitionRows([summary({ status: 'finalized' })])[0]?.canEnter).toBe(false);
    expect(competitionRows([summary({ status: 'cancelled' })])[0]?.canEnter).toBe(false);
  });

  it('names each state in the words a member reads', () => {
    expect(competitionRows([summary({ status: 'open' })])[0]?.statusLabel).toBe('Running');
    expect(competitionRows([summary({ status: 'closed' })])[0]?.statusLabel).toBe(
      'Provisional result'
    );
    expect(competitionRows([summary({ status: 'finalized' })])[0]?.statusLabel).toBe(
      'Final result'
    );
  });

  it('leads with the event that is open, and otherwise the last one with a result', () => {
    const finished = summary({ id: 'old', status: 'finalized' });
    const running = summary({ id: 'live', status: 'open' });

    expect(currentCompetition([finished, running])?.id).toBe('live');
    expect(currentCompetition([finished])?.id).toBe('old');
    expect(currentCompetition([summary({ status: 'cancelled' })])).toBeUndefined();
    expect(currentCompetition([])).toBeUndefined();
  });

  it('labels a standing in the unit the competition is scored in', () => {
    const entry = (score: number) => ({
      profile: {
        id: ME,
        displayName: 'Maya',
        cosmetic: { avatarKey: 'loop-1' },
        activityVisibility: 'private' as const
      },
      rank: 1,
      score,
      isSelf: true
    });

    expect(competitionStandingRows([entry(120)], 'active_minutes')[0]?.scoreLabel).toBe('120 min');
    expect(competitionStandingRows([entry(1)], 'active_days')[0]?.scoreLabel).toBe('1 active day');
    expect(competitionStandingRows([entry(1)], 'active_days')[0]?.accessibilityLabel).toBe(
      'Rank 1, Maya (you), 1 active day'
    );
  });

  it('says a closed result is provisional until the published deadline', () => {
    expect(
      competitionProvisionalNotice(
        summary({ status: 'closed', disputeEndsAt: '2026-09-16T00:00:00.000Z' })
      )
    ).toContain('2026-09-16T00:00:00.000Z');
    expect(competitionProvisionalNotice(summary({ status: 'finalized' }))).toBeUndefined();
    expect(competitionProvisionalNotice(summary({ status: 'open' }))).toBeUndefined();
  });

  it('says what entering publishes, including that the whole window counts', () => {
    expect(COMPETITION_ENTRY_CONSEQUENCE).toContain('however late you enter');
    expect(COMPETITION_ENTRY_CONSEQUENCE).toContain('leave at any time');
  });

  it('passes the published eligibility message through and says nothing changed otherwise', () => {
    expect(
      competitionFailureNotice(
        new ApiFailure(403, 'This competition is for accounts with at least 8 earlier active weeks')
      )
    ).toContain('8 earlier active weeks');
    expect(competitionFailureNotice(new ApiFailure(409, 'closed'))).toContain('not open for entry');
    expect(competitionFailureNotice(new AuthFailure('network'))).toContain('Nothing changed');
    expect(competitionFailureNotice(new Error('boom'))).toContain('Nothing changed');
  });
});
