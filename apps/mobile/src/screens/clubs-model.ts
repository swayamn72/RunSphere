import type { Club, ClubMember, ClubRelaySummary, ClubRole } from '@runsphere/contracts';
import {
  canArchive,
  canChangeRole,
  canLeave,
  canManageRelay,
  canRemoveMember
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
