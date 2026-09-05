import type {
  Club,
  ClubBoardEntry,
  ClubChallengeMode,
  ClubChallengeStanding,
  ClubChallengeSummary,
  ClubMember,
  ClubRelaySummary,
  ClubRole
} from '@runsphere/contracts';
import {
  canArchive,
  canChangeRole,
  canLeave,
  canManageClubChallenge,
  canManageRelay,
  canRemoveMember,
  clubChallengeOpen
} from '@runsphere/domain';
import { AuthFailure } from '../auth-failure';
import { ApiFailure } from '../api-client';

/**
 * The Clubs tab (milestone 3.1).
 *
 * Authority is not re-derived here: every gate calls the same predicate in
 * `@runsphere/domain` that the route enforces, so the UI can never offer an
 * action the server will refuse, and it can never hide one the server allows.
 *
 * A club is private and invite-code-only. There is nothing to browse, so this
 * model has no search, no suggestions, and no notion of a nearby club.
 */

export type ClubsRemoteState =
  'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'configuration' | 'session-expired';

export const clubsErrorState = (error: unknown): ClubsRemoteState => {
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'invalid-credentials') return 'session-expired';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  return 'error';
};

export const clubListState = (clubs: readonly Club[]): ClubsRemoteState =>
  clubs.length ? 'ready' : 'empty';

export const CLUB_ROLE_LABEL: Readonly<Record<ClubRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member'
};

export interface ClubRow {
  readonly id: string;
  readonly name: string;
  readonly roleLabel: string;
  readonly memberLabel: string;
  readonly inviteCode: string;
  readonly accessibilityLabel: string;
}

const memberLabel = (count: number): string => (count === 1 ? '1 member' : `${count} members`);

export const clubRows = (clubs: readonly Club[]): readonly ClubRow[] =>
  clubs.map((club) => ({
    id: club.id,
    name: club.name,
    roleLabel: CLUB_ROLE_LABEL[club.role],
    memberLabel: memberLabel(club.memberCount),
    inviteCode: club.inviteCode,
    accessibilityLabel: `${club.name}. ${CLUB_ROLE_LABEL[club.role]}. ${memberLabel(
      club.memberCount
    )}.`
  }));

export interface ClubMemberRow {
  readonly accountId: string;
  readonly nameLabel: string;
  readonly roleLabel: string;
  readonly isSelf: boolean;
  readonly canRemove: boolean;
  /** The role this member would be moved to, or undefined when not permitted. */
  readonly nextRole: 'admin' | 'member' | undefined;
  readonly accessibilityLabel: string;
}

/**
 * Owner first, then admins, then members: the list reads as the authority
 * ladder, which is the thing a moderator is looking for.
 */
const ROLE_ORDER: Readonly<Record<ClubRole, number>> = { owner: 0, admin: 1, member: 2 };

export const clubMemberRows = (
  members: readonly ClubMember[],
  viewer: { accountId: string | undefined; role: ClubRole }
): readonly ClubMemberRow[] =>
  [...members]
    .sort(
      (left, right) =>
        ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
        left.profile.displayName.localeCompare(right.profile.displayName)
    )
    .map((member) => {
      const isSelf = member.profile.id === viewer.accountId;
      const nameLabel = member.profile.displayName || 'RunSphere member';
      const promotable = member.role === 'member' ? 'admin' : 'member';
      return {
        accountId: member.profile.id,
        nameLabel,
        roleLabel: CLUB_ROLE_LABEL[member.role],
        isSelf,
        canRemove: canRemoveMember(viewer.role, member.role, { self: isSelf }),
        nextRole: canChangeRole(viewer.role, member.role, { self: isSelf })
          ? (promotable as 'admin' | 'member')
          : undefined,
        accessibilityLabel: `${nameLabel}. ${CLUB_ROLE_LABEL[member.role]}${
          isSelf ? '. This is you' : ''
        }.`
      };
    });

export interface ClubActions {
  readonly canLeave: boolean;
  readonly canArchive: boolean;
  /** Why leaving is unavailable, for a caller that must explain it. */
  readonly leaveBlockedReason: string | undefined;
}

export const clubActions = (club: Club): ClubActions => {
  const leavable = canLeave(club.role, club.memberCount);
  return {
    canLeave: leavable,
    canArchive: canArchive(club.role),
    leaveBlockedReason: leavable
      ? undefined
      : 'You own this club. Hand it to an admin or archive it before leaving.'
  };
};

export const validateClubName = (
  raw: string
): { ok: true; name: string } | { ok: false; message: string } => {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'Give the club a name its members will recognise.' };
  if (name.length > 80) return { ok: false, message: 'Keep the name to 80 characters or fewer.' };
  return { ok: true, name };
};

export const joinFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    // A wrong code and an archived club are the same answer on purpose: the
    // route will not confirm which, so neither will this.
    if (error.status === 404) return 'No club matches that code. Check it with whoever sent it.';
    if (error.status === 409) return 'You are already a member of that club.';
  }
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'Joining a club needs a connection. Nothing changed.';
  return 'That club could not be joined. Nothing changed.';
};

export const leaveFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure && error.status === 409)
    return 'You own this club. Hand it to an admin or archive it before leaving.';
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'Leaving a club needs a connection. Nothing changed.';
  return 'You could not be removed from that club. Nothing changed.';
};

export const moderationFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    if (error.status === 403) return 'Your role in this club does not allow that.';
    if (error.status === 404) return 'That member is no longer in the club. Reload to refresh.';
  }
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'That change needs a connection. Nothing changed.';
  return 'That change could not be saved. Nothing changed.';
};

export const createFailureNotice = (error: unknown): string =>
  error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls')
    ? 'Creating a club needs a connection. Nothing was created.'
    : 'That club could not be created. Nothing was created.';

/**
 * What archiving actually does, said before it is done. It is the one action
 * in this tab that cannot be undone from the app.
 */
export const ARCHIVE_CONSEQUENCE =
  'Archiving ends access for every member, including you. The club and its history are kept, but nobody can open it again from the app.';

export const clubsStatusMessage = (
  state: ClubsRemoteState,
  notice: string,
  clubCount: number
): string => {
  if (notice) return notice;
  if (state === 'configuration') return 'Clubs are unavailable until RunSphere is configured.';
  if (state === 'loading') return 'Loading your clubs.';
  if (state === 'offline') return 'Clubs are unavailable offline.';
  if (state === 'error') return 'Clubs are unavailable.';
  if (state === 'ready') return clubCount === 1 ? 'One club.' : `${clubCount} clubs.`;
  return '';
};

/**
 * A relay week as the tab presents it. Every number is the club's aggregate or
 * the reader's own: there is no per-member breakdown, and none can be derived
 * from these fields either.
 */
export interface RelayRow {
  readonly id: string;
  readonly weekLabel: string;
  readonly progressPercent: number;
  readonly totalLabel: string;
  readonly myLabel: string;
  readonly contributorLabel: string;
  readonly statusLabel: string;
  readonly current: boolean;
  readonly accessibilityLabel: string;
}

const minuteLabel = (units: number): string => (units === 1 ? '1 minute' : `${units} minutes`);

export const relayRows = (relays: readonly ClubRelaySummary[]): readonly RelayRow[] =>
  relays.map((relay) => {
    const statusLabel = relay.goalMet
      ? 'Target met'
      : relay.current
        ? 'In progress'
        : 'Target not met';
    const contributorLabel =
      relay.contributorCount === 1
        ? '1 member contributed'
        : `${relay.contributorCount} members contributed`;
    return {
      id: relay.id,
      weekLabel: relay.current ? 'This week' : `Week of ${relay.periodStart}`,
      progressPercent: relay.progressPercent,
      totalLabel: `${minuteLabel(relay.totalUnits)} of ${relay.targetUnits}`,
      myLabel: `You added ${minuteLabel(relay.myUnits)}`,
      contributorLabel,
      statusLabel,
      current: relay.current,
      accessibilityLabel: `${relay.current ? 'This week' : `Week of ${relay.periodStart}`}. ${
        relay.progressPercent
      } percent of the club target. ${minuteLabel(relay.totalUnits)} of ${
        relay.targetUnits
      }. ${contributorLabel}. You added ${minuteLabel(relay.myUnits)}. ${statusLabel}.`
    };
  });

export const currentRelay = (relays: readonly ClubRelaySummary[]): ClubRelaySummary | undefined =>
  relays.find((relay) => relay.current);

export const canSetRelayTarget = (role: ClubRole): boolean => canManageRelay(role);

/**
 * The published rule bounds the target, and the API answers `422` when it is
 * out of range. Validating locally only spares a round trip; the message names
 * the same limits the migration seeds.
 */
export const RELAY_TARGET_MIN = 60;
export const RELAY_TARGET_MAX = 20_000;

export const validateRelayTarget = (
  raw: string
): { ok: true; targetUnits: number } | { ok: false; message: string } => {
  if (!/^\d{1,6}$/.test(raw.trim()))
    return { ok: false, message: 'Enter the target as a whole number of minutes.' };
  const targetUnits = Number(raw.trim());
  if (targetUnits < RELAY_TARGET_MIN || targetUnits > RELAY_TARGET_MAX)
    return {
      ok: false,
      message: `A weekly target must be between ${RELAY_TARGET_MIN} and ${RELAY_TARGET_MAX} minutes.`
    };
  return { ok: true, targetUnits };
};

export const relayFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    // A 422 is a product state: the published rule does not allow that target,
    // or relays are not enabled on this deployment.
    if (error.status === 422) return error.message;
    if (error.status === 403) return 'Only a club owner or admin can set the relay target.';
  }
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'Setting the target needs a connection. Nothing changed.';
  return 'That target could not be saved. Nothing changed.';
};

/**
 * What a relay is, said once where it is shown. It has to be explicit that a
 * club sees totals rather than individuals, and that pace plays no part.
 */
export const RELAY_EXPLANATION =
  'A relay adds up the counted active minutes of everyone in the club toward one weekly target. Each member counts up to a published weekly ceiling, so it takes several people rather than one. Nobody sees another member’s minutes — only the club total.';

/**
 * A club-board entry as the tab presents it (milestone 3.3). An entry carries
 * a display name, one published pace-neutral score, and a rank — the same
 * projection the friend board shows, because a board entry means the same
 * thing wherever it is read.
 */
export interface ClubBoardRow {
  readonly accountId: string;
  readonly rankLabel: string;
  readonly nameLabel: string;
  readonly minutesLabel: string;
  readonly isSelf: boolean;
  readonly accessibilityLabel: string;
}

export const clubBoardRows = (entries: readonly ClubBoardEntry[]): readonly ClubBoardRow[] =>
  entries.map((entry) => {
    const nameLabel = entry.profile.displayName || 'RunSphere member';
    const minutesLabel = minuteLabel(entry.cappedActiveMinutes);
    return {
      accountId: entry.profile.id,
      rankLabel: `#${entry.rank}`,
      nameLabel,
      minutesLabel,
      isSelf: entry.isSelf,
      accessibilityLabel: `Rank ${entry.rank}. ${nameLabel}${
        entry.isSelf ? ', you' : ''
      }. ${minutesLabel}.`
    };
  });

/**
 * What the board is, said where it is shown. Two things have to be explicit:
 * the score is counted minutes rather than pace or distance, and only members
 * who joined the board appear on it.
 */
export const CLUB_BOARD_EXPLANATION =
  'The board ranks this week’s counted active minutes of the club members who joined it. Pace, distance, and where you moved play no part, and a member who has not joined does not appear.';

/**
 * Said before joining. Joining publishes your weekly minutes to every club you
 * are in — the switch is one decision, not one per club — and it is revocable.
 */
export const CLUB_BOARD_JOIN_CONSEQUENCE =
  'Joining shows your weekly counted minutes to the members of every club you are in, and shows you theirs. It is off until you turn it on, and you can leave at any time.';

/** Why an opted-out member sees no names: reading a board means being on it. */
export const CLUB_BOARD_OFF_EXPLANATION =
  'You are not on club boards, so there is nothing to show. Members who joined are ranked by counted active minutes; reading their scores means publishing yours.';

export const clubBoardEmptyMessage = (ruleVersion: string | undefined): string =>
  ruleVersion === undefined
    ? 'Club boards are unavailable until scoring is published on this deployment.'
    : 'Nobody else in this club has joined the board yet.';

export const clubBoardFailureNotice = (error: unknown): string => {
  // A `403` is a moderation decision carrying the statement staff wrote.
  if (error instanceof ApiFailure && error.status === 403) return error.message;
  if (error instanceof ApiFailure && error.status === 404)
    return 'That club is no longer available to you. Reload to refresh.';
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'That change needs a connection. Nothing changed.';
  return 'That change could not be saved. Nothing changed.';
};

/**
 * Club challenges (milestone 3.4). A contest inside one club: an owner or
 * admin opens it, each member joins for themselves, and the standings show
 * only the members who are in it.
 */
export const CLUB_CHALLENGE_MODE_LABEL: Readonly<Record<ClubChallengeMode, string>> = {
  active_minutes: 'Counted minutes',
  active_days: 'Active days'
};

export const CLUB_CHALLENGE_LENGTHS: readonly number[] = [7, 14];

export interface ClubChallengeRow {
  readonly id: string;
  readonly modeLabel: string;
  readonly windowLabel: string;
  readonly statusLabel: string;
  readonly participantLabel: string;
  readonly joined: boolean;
  readonly open: boolean;
  readonly accessibilityLabel: string;
}

const participantLabel = (count: number): string =>
  count === 1 ? '1 member in it' : `${count} members in it`;

const CLUB_CHALLENGE_STATUS_LABEL: Readonly<Record<ClubChallengeSummary['status'], string>> = {
  active: 'Running',
  finished: 'Finished',
  cancelled: 'Cancelled'
};

export const clubChallengeRows = (
  challenges: readonly ClubChallengeSummary[]
): readonly ClubChallengeRow[] =>
  challenges.map((challenge) => {
    const modeLabel = CLUB_CHALLENGE_MODE_LABEL[challenge.mode];
    const windowLabel = `${challenge.lengthDays} days from ${challenge.periodStart}`;
    const statusLabel = CLUB_CHALLENGE_STATUS_LABEL[challenge.status];
    return {
      id: challenge.id,
      modeLabel,
      windowLabel,
      statusLabel,
      participantLabel: participantLabel(challenge.participantCount),
      joined: challenge.joined,
      open: clubChallengeOpen(challenge.status),
      accessibilityLabel: `${modeLabel}. ${windowLabel}. ${statusLabel}. ${participantLabel(
        challenge.participantCount
      )}.${challenge.joined ? ' You are in it.' : ''}`
    };
  });

/**
 * The contest the tab leads with: the one that is running, or failing that the
 * most recent one that closed. A club runs one at a time, so this is never a
 * choice between two live contests.
 */
export const currentClubChallenge = (
  challenges: readonly ClubChallengeSummary[]
): ClubChallengeSummary | undefined =>
  challenges.find((challenge) => clubChallengeOpen(challenge.status)) ??
  challenges.find((challenge) => challenge.status === 'finished');

export interface ClubChallengeStandingRow {
  readonly accountId: string;
  readonly rankLabel: string;
  readonly nameLabel: string;
  readonly scoreLabel: string;
  readonly isSelf: boolean;
  readonly accessibilityLabel: string;
}

const scoreLabel = (mode: ClubChallengeMode, score: number): string =>
  mode === 'active_minutes'
    ? minuteLabel(score)
    : score === 1
      ? '1 active day'
      : `${score} active days`;

export const clubChallengeStandingRows = (
  entries: readonly ClubChallengeStanding[],
  mode: ClubChallengeMode
): readonly ClubChallengeStandingRow[] =>
  entries.map((entry) => {
    const nameLabel = entry.profile.displayName || 'RunSphere member';
    const label = scoreLabel(mode, entry.score);
    return {
      accountId: entry.profile.id,
      rankLabel: `#${entry.rank}`,
      nameLabel,
      scoreLabel: label,
      isSelf: entry.isSelf,
      accessibilityLabel: `Rank ${entry.rank}. ${nameLabel}${
        entry.isSelf ? ', you' : ''
      }. ${label}.`
    };
  });

/** Opening a contest is a club-wide act; joining one is not. */
export const canOpenClubChallenge = (role: ClubRole): boolean => canManageClubChallenge(role);

/**
 * What a club challenge is, said where it is shown: it counts the same
 * pace-neutral minutes as everything else, and only the members who joined it
 * appear in it.
 */
export const CLUB_CHALLENGE_EXPLANATION =
  'A club challenge ranks the members who joined it over one fixed window. It counts the same validated active minutes as the rest of RunSphere — pace, distance, and where you moved play no part.';

/**
 * Said before joining, because joining is retroactive within the window: it is
 * the one part of this that a member could otherwise be surprised by.
 */
export const CLUB_CHALLENGE_JOIN_CONSEQUENCE =
  'Joining shows your score for this challenge to the other members in it, including the days of the window that have already passed — everyone is scored over the same days. You can leave at any time, and you stop being counted and shown from that moment.';

/** Why a non-participant sees no names: the same rule the club board follows. */
export const CLUB_CHALLENGE_OFF_EXPLANATION =
  'You are not in this challenge, so there is nothing to show. Reading the other members’ scores means publishing your own.';

export const clubChallengeEmptyMessage = (canOpen: boolean): string =>
  canOpen
    ? 'No challenge is running. Open one below.'
    : 'No challenge is running. An owner or admin can open one.';

export const clubChallengeFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    // A 422 is a product state: the published rule does not allow that
    // contest, or club challenges are not enabled on this deployment.
    if (error.status === 422) return error.message;
    // The server's own words: either the role limit or a moderation
    // decision, and both are more use than a fixed sentence here.
    if (error.status === 403) return error.message;
    if (error.status === 409) return 'That challenge is no longer running. Reload to refresh.';
    if (error.status === 404) return 'That challenge is no longer available. Reload to refresh.';
  }
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'That change needs a connection. Nothing changed.';
  return 'That change could not be saved. Nothing changed.';
};

/** What cancelling does, said before it is done. */
export const CLUB_CHALLENGE_CANCEL_CONSEQUENCE =
  'Cancelling ends the challenge for everyone in it. Nothing is scored and no result is kept, so nobody is ranked in it.';
