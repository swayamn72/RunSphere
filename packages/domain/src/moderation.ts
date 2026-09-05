/**
 * Moderation rules (Phase 3, milestone 3.7).
 *
 * Blocking is a personal act; reporting asks staff to look; a sanction is what
 * staff may do about it. Every rule about who may do which, what a sanction
 * takes away, and when it stops applying is a pure function here, so the route,
 * the worker, the tests, and any later admin surface all give the same answer.
 *
 * Nothing here reads activity, location, or route. A report is about what
 * somebody published — a name, a profile, a club — never about where they were.
 */

export const REPORT_REASONS = [
  'impersonation',
  'harassment',
  'hate_or_violence',
  'sexual_content',
  'spam_or_scam',
  'self_harm',
  'other'
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const SANCTION_KINDS = ['warning', 'social_suspension', 'account_suspension'] as const;

export type SanctionKind = (typeof SANCTION_KINDS)[number];

/** Staff roles that may work the report queue and decide appeals. */
export const MODERATOR_ROLES = ['admin', 'moderator'] as const;

export const canModerate = (roles: readonly string[]): boolean =>
  roles.some((role) => (MODERATOR_ROLES as readonly string[]).includes(role));

export const isReportReason = (value: string): value is ReportReason =>
  (REPORT_REASONS as readonly string[]).includes(value);

/**
 * A sanction is in force when it has not been revoked and has not expired.
 * Revoking is what an upheld appeal does; expiry is the clock doing it.
 */
export const sanctionInForce = (
  sanction: { expiresAt?: Date | undefined; revokedAt?: Date | undefined },
  now: Date
): boolean => {
  if (sanction.revokedAt) return false;
  return !sanction.expiresAt || sanction.expiresAt > now;
};

/**
 * What a sanction takes away.
 *
 * A `social_suspension` removes the surfaces where an account is published to
 * other people — boards, clubs, challenges, competitions — and leaves
 * recording, history, and export untouched. Somebody's own activity data is
 * theirs; withholding it would be a punishment aimed at the wrong thing.
 *
 * An `account_suspension` additionally stops the account being used at all. A
 * `warning` takes nothing away and exists so a first problem can be answered
 * without one.
 */
export const sanctionBlocksSharing = (kind: SanctionKind): boolean =>
  kind === 'social_suspension' || kind === 'account_suspension';

export const sanctionBlocksSignIn = (kind: SanctionKind): boolean => kind === 'account_suspension';

/** A sanction that takes nothing away still needs no end date. */
export const sanctionMayExpire = (kind: SanctionKind): boolean => kind !== 'warning';

/**
 * Whether an account may appeal a sanction: it must be in force, and it must
 * not already have been appealed. One appeal per sanction — a second attempt
 * is not a new fact, and an unlimited appeal is a way to occupy staff rather
 * than to be heard.
 */
export const canAppealSanction = (
  sanction: { expiresAt?: Date | undefined; revokedAt?: Date | undefined },
  hasExistingAppeal: boolean,
  now: Date
): boolean => !hasExistingAppeal && sanctionInForce(sanction, now);

/**
 * An upheld appeal means the sanction stands; an overturned one revokes it.
 * The words are the appellant's-eye view: "upheld" is the *appeal* failing,
 * so the route and the UI must never present it as a win.
 */
export const appealRevokesSanction = (decision: 'upheld' | 'overturned'): boolean =>
  decision === 'overturned';

/**
 * Whether a report may be filed at all. Reporting yourself is not a moderation
 * action, and a subject the reporter cannot name is not one either.
 */
export const canReport = (options: {
  reporterAccountId: string;
  subjectId: string;
  reason: string;
}): boolean => options.reporterAccountId !== options.subjectId && isReportReason(options.reason);

/**
 * The sanction kinds that pause an account's published presence. Kept as a
 * derived list rather than a second hand-written one, so adding a kind cannot
 * leave the enforcement paths behind.
 */
export const SHARING_SUSPENDED_KINDS: readonly SanctionKind[] =
  SANCTION_KINDS.filter(sanctionBlocksSharing);

export interface SanctionState {
  kind: SanctionKind;
  statement: string;
  expiresAt?: Date | undefined;
  revokedAt?: Date | undefined;
}

/**
 * What an account is currently restricted from, and the statement to show for
 * it. Derived from every sanction on the account rather than from one, because
 * two overlapping sanctions must not cancel each other out.
 *
 * The statement returned is the one belonging to the strictest restriction in
 * force, so an account under both a warning and a suspension reads the words
 * that explain what it cannot do.
 */
export interface AccountRestrictions {
  sharingPaused: boolean;
  signInBlocked: boolean;
  statement: string | undefined;
}

export const restrictionsFor = (
  sanctions: readonly SanctionState[],
  now: Date
): AccountRestrictions => {
  const live = sanctions.filter((sanction) => sanctionInForce(sanction, now));
  const blockingSignIn = live.find((sanction) => sanctionBlocksSignIn(sanction.kind));
  const blockingSharing = live.find((sanction) => sanctionBlocksSharing(sanction.kind));
  return {
    sharingPaused: Boolean(blockingSharing),
    signInBlocked: Boolean(blockingSignIn),
    statement: (blockingSignIn ?? blockingSharing)?.statement
  };
};
