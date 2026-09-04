import type { ClubRole } from '@runsphere/contracts';
import { cappedWeeklyActiveMinutes, type ScoredActivity } from './gamification.js';

export type { ClubRole };

/**
 * Club authority (Phase 3, milestone 3.1).
 *
 * Every rule here is a pure predicate over two roles, so the same answer is
 * given by the route, by a test, and by any later admin surface. Clubs are
 * isolated by club id and visible only to active members
 * (`safety-and-privacy.md`), and none of these rules can widen that: they only
 * decide what an *already active member* may do inside one club.
 *
 * The shape of the ladder: exactly one owner, who can do anything except leave
 * a club that still has other members; admins moderate members but not each
 * other; members act only on themselves.
 */

export const CLUB_ROLES: readonly ClubRole[] = ['owner', 'admin', 'member'];

const RANK: Readonly<Record<ClubRole, number>> = { owner: 3, admin: 2, member: 1 };

/** Strictly greater authority. Equal roles deliberately cannot act on each other. */
export const outranks = (actor: ClubRole, target: ClubRole): boolean => RANK[actor] > RANK[target];

/**
 * Removal needs strictly greater authority, so an admin cannot remove a fellow
 * admin and no one can remove the owner. Removing yourself is leaving, which
 * has its own rule.
 */
export const canRemoveMember = (
  actor: ClubRole,
  target: ClubRole,
  options: { self: boolean }
): boolean => !options.self && outranks(actor, target);

/**
 * Only the owner grants or withdraws `admin`, and never on their own row: a
 * club with no owner has nobody who can archive it or appoint an admin.
 */
export const canChangeRole = (
  actor: ClubRole,
  target: ClubRole,
  options: { self: boolean }
): boolean => actor === 'owner' && !options.self && target !== 'owner';

/**
 * The owner may leave only once they are the last member. Otherwise a club
 * would be left with members and no authority over it, and there is no
 * automatic succession: promoting someone silently would hand a stranger
 * moderation powers.
 */
export const canLeave = (role: ClubRole, activeMemberCount: number): boolean =>
  role !== 'owner' || activeMemberCount <= 1;

/** Archiving ends access for everyone, so it stays with the owner alone. */
export const canArchive = (role: ClubRole): boolean => role === 'owner';

/** Invites are a moderation surface: who may hand out access to the club. */
export const canInvite = (role: ClubRole): boolean => role === 'owner' || role === 'admin';

/**
 * Invite-code alphabet. Discovery is by exact code only — there is no public
 * club list or search (`gameplay.md`) — so a code is the entire access path
 * and is generated server-side, never chosen. Visually ambiguous characters
 * are excluded so a code read aloud or off a screen cannot be mistyped into
 * someone else's club.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 10;

/** Codes are compared case-insensitively; this is the stored/compared form. */
export const normalizeInviteCode = (code: string): string =>
  code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

export const isPlausibleInviteCode = (code: string): boolean => {
  const normalized = normalizeInviteCode(code);
  return (
    normalized.length >= 6 &&
    normalized.length <= 32 &&
    [...normalized].every((character) => INVITE_CODE_ALPHABET.includes(character))
  );
};

/**
 * Whether one member's profile may be shown to another inside a club member
 * list. A block hides two accounts from each other everywhere, and a club roster
 * is not an exception; the club's own member *count* is still reported in full,
 * because the size of a club is a fact about the club, not about a person.
 */
export const visibleToMember = (options: { blockedEitherWay: boolean; self: boolean }): boolean =>
  options.self || !options.blockedEitherWay;

/**
 * The published club-relay rule (`rule_versions.kind = 'club'`). A relay is
 * pace-neutral and cooperative: it sums capped validated active minutes toward
 * one shared club target, and it can never weight pace, speed, distance, or
 * location (ADR-0005).
 *
 * `memberWeeklyCapMinutes` is what makes a relay cooperative rather than a
 * race: one very active member cannot carry the whole target, so the club
 * needs several people to move rather than one person to move a lot.
 */
export interface ClubRelayRule {
  dailyCapMinutes: number;
  memberWeeklyCapMinutes: number;
  minTargetUnits: number;
  maxTargetUnits: number;
}

/** Throws on a malformed published rule rather than scoring a relay wrongly. */
export function parseClubRelayRule(definition: unknown): ClubRelayRule {
  if (typeof definition !== 'object' || definition === null) {
    throw new Error('Club relay rule must be a JSON object');
  }
  const rule = definition as Record<string, unknown>;
  const readInteger = (key: string, minimum: number): number => {
    const value = rule[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
      throw new Error(`Club relay rule field '${key}' must be an integer >= ${minimum}`);
    }
    return value;
  };
  const dailyCapMinutes = readInteger('dailyCapMinutes', 1);
  const memberWeeklyCapMinutes = readInteger('memberWeeklyCapMinutes', 1);
  const minTargetUnits = readInteger('minTargetUnits', 1);
  const maxTargetUnits = readInteger('maxTargetUnits', 1);
  if (maxTargetUnits < minTargetUnits) {
    throw new Error("Club relay rule 'maxTargetUnits' must be at least 'minTargetUnits'");
  }
  return { dailyCapMinutes, memberWeeklyCapMinutes, minTargetUnits, maxTargetUnits };
}

/** Managing a relay is a club-wide act, so it sits with the owner and admins. */
export const canManageRelay = (role: ClubRole): boolean => role === 'owner' || role === 'admin';

export const relayTargetAllowed = (rule: ClubRelayRule, targetUnits: number): boolean =>
  Number.isInteger(targetUnits) &&
  targetUnits >= rule.minTargetUnits &&
  targetUnits <= rule.maxTargetUnits;

/**
 * One member's relay units: their capped weekly active minutes, capped again
 * by the per-member weekly ceiling. Both caps come from the published rule, and
 * the input is server-derived validated activity only — never a client total.
 */
export const relayMemberUnits = (
  activities: readonly ScoredActivity[],
  weekStart: Date,
  rule: ClubRelayRule
): number =>
  Math.min(
    cappedWeeklyActiveMinutes(activities, weekStart, rule.dailyCapMinutes),
    rule.memberWeeklyCapMinutes
  );

/**
 * Relay progress as a whole percentage, clamped to 100. A relay that passes its
 * target is met, not "over": there is no leaderboard of clubs and no reward for
 * exceeding it, so an unclamped number would only invite comparison.
 */
export const relayProgressPercent = (totalUnits: number, targetUnits: number): number => {
  if (targetUnits <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((totalUnits / targetUnits) * 100)));
};

export const relayGoalMet = (totalUnits: number, targetUnits: number): boolean =>
  targetUnits > 0 && totalUnits >= targetUnits;
