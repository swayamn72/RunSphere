import type {
  ChallengeMode,
  ChallengeSummary,
  FriendStandingsResponse,
  Profile
} from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import { ApiFailure } from '../api-client';

/**
 * Play tab presentation. Every score shown here is copied from the server; this
 * module never accumulates or projects one. In particular an in-progress
 * challenge shows no score at all: the worker computes scores when the window
 * closes, and `GET /v1/challenges/:id/result` answers `409` until it has, so
 * any number shown mid-window would be invented.
 */
export type PlayRemoteState =
  'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'configuration' | 'session-expired';

export interface ChallengeGroups {
  /** Invites this account must answer. */
  readonly incoming: readonly ChallengeSummary[];
  /** Invites this account sent and is waiting on. */
  readonly outgoing: readonly ChallengeSummary[];
  readonly active: readonly ChallengeSummary[];
  readonly finished: readonly ChallengeSummary[];
}

export const CHALLENGE_MODE_LABEL: Record<ChallengeMode, string> = {
  active_minutes: 'Active minutes',
  active_days: 'Active days',
  quest_completion: 'Quest completions'
};

export const playErrorState = (
  error: unknown
): Extract<PlayRemoteState, 'offline' | 'error' | 'configuration' | 'session-expired'> => {
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'invalid-credentials') return 'session-expired';
  return 'error';
};

/**
 * Only the invited side of an open invite may answer it, so the server's `role`
 * is what separates an invite to accept from one that is merely pending.
 * Declined and cancelled challenges are dropped rather than shown as history:
 * nothing was scored, so there is nothing truthful to report about them.
 */
export const groupChallenges = (challenges: readonly ChallengeSummary[]): ChallengeGroups => ({
  incoming: challenges.filter(
    (challenge) => challenge.status === 'invited' && challenge.role === 'opponent'
  ),
  outgoing: challenges.filter(
    (challenge) => challenge.status === 'invited' && challenge.role === 'challenger'
  ),
  active: challenges.filter(
    (challenge) => challenge.status === 'active' || challenge.status === 'accepted'
  ),
  finished: challenges.filter((challenge) => challenge.status === 'finished')
});

export const challengeListState = (groups: ChallengeGroups): PlayRemoteState =>
  groups.incoming.length || groups.outgoing.length || groups.active.length || groups.finished.length
    ? 'ready'
    : 'empty';

/** Whole days from `today` until the window closes; never negative. */
export const daysRemaining = (periodEnd: string, today: string): number => {
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((end - now) / 86_400_000));
};

export const challengeWindowLabel = (challenge: ChallengeSummary, today: string): string => {
  if (challenge.status === 'invited') return `${challenge.lengthDays}-day challenge`;
  if (challenge.status === 'finished') return `Ended ${challenge.periodEnd}`;
  const remaining = daysRemaining(challenge.periodEnd, today);
  if (remaining === 0) return 'Counting the final results';
  return `${remaining} ${remaining === 1 ? 'day' : 'days'} left`;
};

export interface ChallengeResultLine {
  readonly label: string;
  readonly detail: string;
}

/**
 * A finished challenge's outcome, from the stored result only. `undefined`
 * means the worker has not scored the window yet (`409`), which is reported as
 * pending rather than as a zero or a loss.
 */
export const challengeOutcomeLine = (
  challenge: ChallengeSummary,
  result:
    | { participants: readonly { accountId: string; score: number }[]; winnerAccountId?: string }
    | undefined,
  accountId: string | undefined
): ChallengeResultLine => {
  if (!result) return { label: 'Counting', detail: 'The final scores are still being counted.' };
  const mine = result.participants.find((participant) => participant.accountId === accountId);
  const theirs = result.participants.find((participant) => participant.accountId !== accountId);
  const scores =
    mine && theirs
      ? `${mine.score} to ${theirs.score}`
      : result.participants.map((participant) => participant.score).join(' to ');
  const unit = CHALLENGE_MODE_LABEL[challenge.mode].toLowerCase();
  if (!result.winnerAccountId) return { label: 'Tied', detail: `${scores} ${unit}.` };
  if (accountId && result.winnerAccountId === accountId)
    return { label: 'You finished ahead', detail: `${scores} ${unit}.` };
  return {
    label: `${challenge.opponent.displayName} finished ahead`,
    detail: `${scores} ${unit}.`
  };
};

/**
 * Creating a challenge is refused by the server (`422`) for a mode or length
 * its published rule does not enable, and `409` when one is already open with
 * that friend. Both are product states with their own copy, never a generic
 * failure.
 */
export const createChallengeFailure = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    if (error.status === 422) return error.message;
    if (error.status === 409) return 'You already have a challenge open with this friend.';
    if (error.status === 404) return 'That friend is no longer available for a challenge.';
    if (error.status === 503) return 'Challenges are not available on this server yet.';
  }
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'You are offline. Try again when connected.';
  return 'The challenge could not be created.';
};

export const respondChallengeFailure = (error: unknown): string => {
  if (error instanceof ApiFailure && error.status === 409) return 'This invite is no longer open.';
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'You are offline. Try again when connected.';
  return 'That response could not be saved.';
};

export interface StandingRow {
  readonly accountId: string;
  readonly rank: number;
  readonly displayName: string;
  /** Display name with the self marker already applied, so the row is one text node. */
  readonly nameLabel: string;
  readonly minutesLabel: string;
  readonly isSelf: boolean;
  readonly accessibilityLabel: string;
}

/**
 * Standings are rendered from the served entries only. An account that has not
 * joined the board receives no entries at all, which is presented as an
 * explicit invitation to join rather than as an empty leaderboard.
 */
export const standingRows = (standings: FriendStandingsResponse): readonly StandingRow[] =>
  standings.entries.map((entry) => {
    const minutesLabel = `${entry.cappedActiveMinutes} min`;
    const nameLabel = entry.isSelf
      ? `${entry.profile.displayName} (you)`
      : entry.profile.displayName;
    return {
      accountId: entry.profile.id,
      rank: entry.rank,
      displayName: entry.profile.displayName,
      nameLabel,
      minutesLabel,
      isSelf: entry.isSelf,
      accessibilityLabel:
        `Rank ${entry.rank}, ${nameLabel}, ` + `${entry.cappedActiveMinutes} counted active minutes`
    };
  });

export const standingsState = (standings: FriendStandingsResponse | undefined): PlayRemoteState => {
  if (!standings) return 'loading';
  return standings.participating && standings.entries.length ? 'ready' : 'empty';
};

/** Friends who already have an open challenge cannot receive a second one. */
export const invitableFriends = (
  friends: readonly Profile[],
  challenges: readonly ChallengeSummary[]
): readonly Profile[] => {
  const busy = new Set(
    challenges
      .filter(
        (challenge) =>
          challenge.status === 'invited' ||
          challenge.status === 'accepted' ||
          challenge.status === 'active'
      )
      .map((challenge) => challenge.opponent.id)
  );
  return friends.filter((friend) => !busy.has(friend.id));
};
