import type { CompetitionStatus } from '@runsphere/contracts';

export type { CompetitionStatus };

/**
 * Scheduled competitions (Phase 3, milestone 3.6).
 *
 * A competition is the most formal thing in the product: it is announced in
 * advance, it has a published rule version, stated eligibility, a fixed
 * window, and a dispute period. Every decision about what state it is in, who
 * may enter it, and who may run it is a pure function here, so the route, the
 * worker, the tests, and any later admin surface all give the same answer.
 *
 * Nothing here reads pace, distance, or location. Eligibility is a count of
 * earlier active weeks; a score is capped validated active minutes or active
 * days (ADR-0005).
 */

/** Staff roles that may schedule and run a competition. */
export const COMPETITION_OPERATOR_ROLES = ['admin', 'season_operator'] as const;

export const canOperateCompetitions = (roles: readonly string[]): boolean =>
  roles.some((role) => (COMPETITION_OPERATOR_ROLES as readonly string[]).includes(role));

/**
 * A draft is staff-only. Everything else is announced, including a cancelled
 * event: an event that was announced and then called off is a fact
 * participants are owed, not something to quietly remove.
 */
export const competitionVisibleToMembers = (status: CompetitionStatus): boolean =>
  status !== 'draft';

/**
 * Enrollment is open from the moment a competition is published until its
 * window closes.
 *
 * Joining mid-window is allowed, and the whole window is still scored: every
 * participant is measured over the same days, so a contest cannot reward the
 * moment somebody decided to enter. Once the window closes, the field is what
 * it was — a closed event never gains a participant.
 */
export const competitionEnrollmentOpen = (status: CompetitionStatus): boolean =>
  status === 'published' || status === 'open';

/**
 * Whether an account's history clears the published eligibility band. Zero
 * means open to everyone who enrolls, which is the default.
 */
export const competitionEligible = (
  priorActiveWeeks: number,
  minPriorActiveWeeks: number
): boolean => Math.max(0, Math.trunc(priorActiveWeeks)) >= minPriorActiveWeeks;

/**
 * The status the clock says a competition should be in, given the one it is
 * recorded in. Returns `undefined` when nothing should change.
 *
 * The transitions only ever move forward, and only for an event that is still
 * running its course: a cancelled or finalized competition is never revived by
 * the passage of time, and a draft is never published by it either — that is a
 * staff decision, not a clock one.
 */
export const competitionStatusDue = (
  competition: {
    status: CompetitionStatus;
    /** Start of the scoring window, as an instant. */
    opensAt: Date;
    /** End of the scoring window, as an instant. */
    closesAt: Date;
    disputePeriodHours: number;
    closedAt?: Date | undefined;
  },
  now: Date
): CompetitionStatus | undefined => {
  if (competition.status === 'published' && now >= competition.opensAt) {
    // A window that opened and closed while nobody swept still lands correctly:
    // the next check moves it straight on to `closed`.
    return now >= competition.closesAt ? 'closed' : 'open';
  }
  if (competition.status === 'open' && now >= competition.closesAt) return 'closed';
  if (competition.status === 'closed' && competition.closedAt) {
    const disputeEnds = new Date(
      competition.closedAt.getTime() + competition.disputePeriodHours * 3_600_000
    );
    if (now >= disputeEnds) return 'finalized';
  }
  return undefined;
};

/**
 * When the dispute period ends, or `undefined` while the window is still
 * running. Results exist from the close; this is the point at which they stop
 * being provisional.
 */
export const competitionDisputeEndsAt = (
  closedAt: Date | undefined,
  disputePeriodHours: number
): Date | undefined =>
  closedAt ? new Date(closedAt.getTime() + disputePeriodHours * 3_600_000) : undefined;

/** Results exist but are still open to challenge. */
export const competitionResultsProvisional = (status: CompetitionStatus): boolean =>
  status === 'closed';
