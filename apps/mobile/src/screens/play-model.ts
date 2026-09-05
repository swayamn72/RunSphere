import type {
  ChallengeMode,
  ChallengeSummary,
  CompetitionStanding,
  CompetitionStatus,
  CompetitionSummary,
  FriendStandingsResponse,
  GlobalBoardResponse,
  Profile,
  TerritorySeasonView
} from '@runsphere/contracts';
import { competitionEnrollmentOpen } from '@runsphere/domain';
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

/**
 * The opt-in global board (milestone 3.5). Everything here is copied from the
 * server: divisions, ranks, and scores are all decided by the worker under a
 * published rule, so this module labels them and never derives one.
 */
export interface GlobalBoardRow {
  readonly accountId: string;
  readonly rank: number;
  readonly nameLabel: string;
  readonly minutesLabel: string;
  readonly isSelf: boolean;
  readonly accessibilityLabel: string;
}

export const globalBoardRows = (board: GlobalBoardResponse): readonly GlobalBoardRow[] =>
  board.entries.map((entry) => {
    const nameLabel = entry.isSelf
      ? `${entry.profile.displayName} (you)`
      : entry.profile.displayName;
    return {
      accountId: entry.profile.id,
      rank: entry.rank,
      nameLabel,
      minutesLabel: `${entry.cappedActiveMinutes} min`,
      isSelf: entry.isSelf,
      accessibilityLabel: `Rank ${entry.rank}, ${nameLabel}, ${entry.cappedActiveMinutes} counted active minutes`
    };
  });

/**
 * What a division is, in the words a member needs: who you are ranked with,
 * decided by how long you have been active rather than by how well you did.
 */
export const GLOBAL_DIVISION_LABEL: Readonly<Record<string, string>> = {
  newcomer: 'Newcomers',
  rising: 'Rising',
  established: 'Established'
};

export const globalDivisionLabel = (division: string | undefined): string =>
  division ? (GLOBAL_DIVISION_LABEL[division] ?? division) : '';

/**
 * The reader's own line, shown whether or not their rank fits on the page.
 * Absent until the worker has ranked them, which is the honest state for
 * somebody who has not moved yet this week.
 */
export const globalSelfLabel = (board: GlobalBoardResponse): string | undefined =>
  board.me ? `You are #${board.me.rank} with ${board.me.cappedActiveMinutes} min` : undefined;

export const globalBoardState = (board: GlobalBoardResponse | undefined): PlayRemoteState => {
  if (!board) return 'loading';
  return board.participating && board.entries.length ? 'ready' : 'empty';
};

/**
 * Why an opted-in reader can see an empty board: the week's scores are
 * materialized by the worker, and an account that has not moved is not ranked
 * at all rather than ranked at zero.
 */
export const globalBoardEmptyMessage = (board: GlobalBoardResponse): string =>
  board.me
    ? 'Nobody else in your division has counted minutes this week yet.'
    : 'You are on the board. Your first counted minutes this week put you on it.';

/**
 * Said before joining. The global board is the widest audience in the product,
 * so what it publishes — and what it never does — is stated in full.
 */
export const GLOBAL_BOARD_JOIN_CONSEQUENCE =
  'Joining shows your display name, one weekly number, and a rank to other people who have joined. Never your route, pace, distance, or where you went. You are ranked only against people with a similar length of time on RunSphere, and you can leave at any time.';

/**
 * Scheduled competitions (milestone 3.6). Everything a participant needs to
 * decide is published before they enter, so this module labels what the server
 * announced and never infers a rule of its own.
 */
export const COMPETITION_STATUS_LABEL: Readonly<Record<CompetitionStatus, string>> = {
  draft: 'Draft',
  published: 'Announced',
  open: 'Running',
  closed: 'Provisional result',
  finalized: 'Final result',
  cancelled: 'Cancelled'
};

export interface CompetitionRow {
  readonly id: string;
  readonly title: string;
  readonly statusLabel: string;
  readonly windowLabel: string;
  readonly participantLabel: string;
  readonly rewardsLabel: string;
  readonly eligibilityLabel: string | undefined;
  readonly enrolled: boolean;
  readonly canEnter: boolean;
  readonly accessibilityLabel: string;
}

const competitionParticipantLabel = (count: number): string =>
  count === 1 ? '1 entrant' : `${count} entrants`;

export const competitionRows = (
  competitions: readonly CompetitionSummary[]
): readonly CompetitionRow[] =>
  competitions.map((competition) => {
    const statusLabel = COMPETITION_STATUS_LABEL[competition.status];
    const windowLabel = `${competition.periodStart} to ${competition.periodEnd}`;
    const participantLabel = competitionParticipantLabel(competition.participantCount);
    // The band is stated whether or not the reader clears it: an eligibility
    // rule that only appears when it excludes you reads as a rejection.
    const eligibilityLabel =
      competition.minPriorActiveWeeks > 0
        ? `Open to accounts with ${competition.minPriorActiveWeeks} or more earlier active weeks${
            competition.eligible ? '' : ' — not you yet'
          }`
        : undefined;
    return {
      id: competition.id,
      title: competition.title,
      statusLabel,
      windowLabel,
      participantLabel,
      rewardsLabel: competition.rewards,
      eligibilityLabel,
      enrolled: competition.enrolled,
      canEnter:
        competitionEnrollmentOpen(competition.status) &&
        (competition.eligible || competition.enrolled),
      accessibilityLabel: `${competition.title}. ${statusLabel}. ${windowLabel}. ${participantLabel}.${
        competition.enrolled ? ' You are entered.' : ''
      }`
    };
  });

/**
 * The competition the tab leads with: one that is announced or running, or
 * failing that the most recent one with a result.
 */
export const currentCompetition = (
  competitions: readonly CompetitionSummary[]
): CompetitionSummary | undefined =>
  competitions.find((competition) => competitionEnrollmentOpen(competition.status)) ??
  competitions.find(
    (competition) => competition.status === 'closed' || competition.status === 'finalized'
  );

export interface CompetitionStandingRow {
  readonly accountId: string;
  readonly rank: number;
  readonly nameLabel: string;
  readonly scoreLabel: string;
  readonly isSelf: boolean;
  readonly accessibilityLabel: string;
}

export const competitionStandingRows = (
  entries: readonly CompetitionStanding[],
  mode: CompetitionSummary['mode']
): readonly CompetitionStandingRow[] =>
  entries.map((entry) => {
    const nameLabel = entry.isSelf
      ? `${entry.profile.displayName} (you)`
      : entry.profile.displayName;
    const scoreLabel =
      mode === 'active_minutes'
        ? `${entry.score} min`
        : entry.score === 1
          ? '1 active day'
          : `${entry.score} active days`;
    return {
      accountId: entry.profile.id,
      rank: entry.rank,
      nameLabel,
      scoreLabel,
      isSelf: entry.isSelf,
      accessibilityLabel: `Rank ${entry.rank}, ${nameLabel}, ${scoreLabel}`
    };
  });

/**
 * Said before entering. A competition scores the whole window however late you
 * enter, and what it publishes is the same single number every other board
 * shows.
 */
export const COMPETITION_ENTRY_CONSEQUENCE =
  'Entering shows your counted active minutes for this window, and a rank, to the other entrants. The whole window is scored however late you enter, because everyone is measured over the same days. You can leave at any time.';

/** Why a result can be shown and still change. */
export const competitionProvisionalNotice = (
  competition: CompetitionSummary
): string | undefined =>
  competition.status === 'closed'
    ? `These results are provisional until ${competition.disputeEndsAt ?? 'the dispute period ends'}.`
    : undefined;

export const competitionFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    // A 403 names the published band that was missed; it is a product state.
    if (error.status === 403) return error.message;
    if (error.status === 409) return 'That competition is not open for entry any more.';
    if (error.status === 404) return 'That competition is no longer available. Reload to refresh.';
  }
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'That change needs a connection. Nothing changed.';
  return 'That change could not be saved. Nothing changed.';
};

/**
 * The territory season (milestone 4.1).
 *
 * `product.md` asks for three honest states: no season, a season you have not
 * joined, and one you have. It also says, for a live season somebody has not
 * joined: show the rules, explain division assignment, offer an explicit join,
 * and **do not calculate or display a rank**. There is no rank here to display
 * — capture is off — and this module has no notion of one.
 */
export interface TerritorySeasonRow {
  readonly titleLabel: string;
  readonly statusLabel: string;
  readonly windowLabel: string;
  readonly participantLabel: string;
  /** The reader's own division, when they have joined. */
  readonly divisionLabel: string | undefined;
  /** How the division was decided, in the words of the rule. */
  readonly divisionExplanation: string | undefined;
  readonly enrolled: boolean;
  readonly canJoin: boolean;
  readonly accessibilityLabel: string;
}

const TERRITORY_STATUS_LABEL: Readonly<Record<TerritorySeasonView['status'], string>> = {
  announced: 'Announced',
  open: 'Open to join',
  live: 'Running',
  ended: 'Ended'
};

const seasonDate = (iso: string): string => iso.slice(0, 10);

export const territorySeasonRow = (season: TerritorySeasonView): TerritorySeasonRow => {
  const statusLabel = TERRITORY_STATUS_LABEL[season.status];
  const windowLabel = `${seasonDate(season.startsAt)} to ${seasonDate(season.endsAt)}`;
  const participantLabel =
    season.participantCount === 1
      ? '1 person taking part'
      : `${season.participantCount} taking part`;
  return {
    titleLabel: season.title,
    statusLabel,
    windowLabel,
    participantLabel,
    divisionLabel: season.enrollment
      ? (DIVISION_LABEL[season.enrollment.division] ?? season.enrollment.division)
      : undefined,
    divisionExplanation: season.enrollment
      ? `You are in this group because you have been active in ${season.enrollment.priorActiveWeeks} earlier ${
          season.enrollment.priorActiveWeeks === 1 ? 'week' : 'weeks'
        }. It is decided once, when you join, and nothing you do later moves you.`
      : undefined,
    enrolled: Boolean(season.enrollment),
    canJoin: season.joinable,
    accessibilityLabel: `${season.title}. ${statusLabel}. ${windowLabel}. ${participantLabel}.${
      season.enrollment ? ' You are taking part.' : ''
    }`
  };
};

/** Division keys in the words a member reads. */
export const DIVISION_LABEL: Readonly<Record<string, string>> = {
  newcomer: 'Newcomers',
  returning: 'Returning',
  established: 'Established'
};

/**
 * Said before joining. Two things have to be true and clear: what taking part
 * records right now, and that it is nothing like what "territory" sounds like
 * — because the name promises a map, and the map does not exist yet.
 */
export const TERRITORY_JOIN_CONSEQUENCE =
  'Taking part records that you joined and which group you are in — decided by how many weeks you have been active, never by pace or distance. Nothing about where you go is read, no area is claimed, and there is no rank. You can leave at any time.';

/** Said when there is no season. A season is not a permanent fixture. */
export const TERRITORY_NO_SEASON_MESSAGE =
  'No season is running. Quests and your weekly goal are the way to play in the meantime.';

export const territoryFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    if (error.status === 409) return 'That season is not open to join. Reload to refresh.';
    if (error.status === 404) return 'That season is no longer listed. Reload to refresh.';
    if (error.status === 422) return error.message;
  }
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'That change needs a connection. Nothing changed.';
  return 'That change could not be saved. Nothing changed.';
};
