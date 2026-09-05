import { canManageCampaigns, canModerate, canOperateCompetitions } from '@runsphere/domain';

/**
 * The role-gated operations areas (Phase 3, milestone 3.10).
 *
 * Five milestones added staff routes with no interface in front of them, so
 * running a competition or working a report meant an HTTP client. This is the
 * map from a staff role to what that person can actually do.
 *
 * Two rules shape it. **Gating reuses the server's own predicates** — the same
 * `canModerate`, `canOperateCompetitions`, and `canManageCampaigns` the routes
 * enforce — so the console can never offer an action the API will refuse, nor
 * hide one it would allow. And **an area with no API yet says so** rather than
 * rendering a screen that looks operational: a console that appears to work
 * and quietly does nothing is worse than one that admits the gap.
 */

export type AreaKey =
  | 'review'
  | 'moderation'
  | 'competitions'
  | 'seasons'
  | 'campaigns'
  | 'privacy'
  | 'data'
  | 'support';

export interface AreaDefinition {
  readonly key: AreaKey;
  readonly title: string;
  /** What this area is for, in one line, for somebody who has just signed in. */
  readonly summary: string;
  /** Whether the account's roles admit them, given what the API enforces. */
  readonly permitted: (roles: readonly string[]) => boolean;
  /**
   * Absent when the area is backed by real routes. Present when it is not, and
   * then it is the honest reason shown in place of the screen.
   */
  readonly unbuiltReason?: string;
  /** Named so a reader can check the gate against the route that enforces it. */
  readonly roleNote: string;
}

/**
 * The activity review queue predates role-based access: it is allow-listed by
 * account id in API config (`staffReviewAccountIds`), not by a staff role. The
 * console therefore offers it to any signed-in staff account and lets the
 * server decide, which is the only honest gate available from here.
 */
const ANY_STAFF = () => true;

export const AREAS: readonly AreaDefinition[] = [
  {
    key: 'review',
    title: 'Activity review',
    summary: 'Submissions that failed or are awaiting validation. Never raw GPS.',
    permitted: ANY_STAFF,
    roleNote: 'Allow-listed by account id in API config, not by a staff role.'
  },
  {
    key: 'moderation',
    title: 'Moderation',
    summary: 'Open reports and the appeals against decisions already made.',
    permitted: canModerate,
    roleNote: 'moderator or admin, matching /v1/staff/reports.'
  },
  {
    key: 'competitions',
    title: 'Competitions',
    summary: 'Schedule, announce, and cancel time-boxed events.',
    permitted: canOperateCompetitions,
    roleNote: 'season_operator or admin, matching /v1/staff/competitions.'
  },
  {
    key: 'seasons',
    title: 'Territory seasons',
    summary: 'Division sizes, concentration monitoring, and week rollback for a season.',
    permitted: canOperateCompetitions,
    roleNote: 'season_operator or admin, matching /v1/staff/territory/seasons.'
  },
  {
    key: 'campaigns',
    title: 'Campaign email',
    summary: 'Templates, audience counts, scheduling, and cancellation.',
    permitted: canManageCampaigns,
    roleNote: 'campaign_manager or admin, matching /v1/staff/campaigns.'
  },
  {
    key: 'privacy',
    title: 'Privacy requests',
    summary: 'Export and erasure requests, and whether they are still moving.',
    permitted: (roles) => roles.includes('privacy_officer') || roles.includes('admin'),
    roleNote: 'privacy_officer or admin, matching /v1/staff/privacy/requests.'
  },
  {
    key: 'data',
    title: 'Data stewardship',
    summary: 'Which rule version is live for each kind, and since when.',
    permitted: (roles) => roles.includes('data_steward') || roles.includes('admin'),
    roleNote: 'data_steward or admin, matching /v1/staff/rules.'
  },
  {
    key: 'support',
    title: 'Support',
    summary: 'Look up an account by its own reference to answer a question.',
    permitted: (roles) => roles.includes('support') || roles.includes('admin'),
    unbuiltReason:
      'No staff route exists for account lookup yet. Building one needs a privacy review first: a support console that can find any account by email is the single most sensitive surface in this product.',
    roleNote: 'support or admin. No route to gate yet.'
  }
];

/** The areas this account may open, in a stable order. */
export const permittedAreas = (roles: readonly string[]): readonly AreaDefinition[] =>
  AREAS.filter((area) => area.permitted(roles));

/**
 * What to open first: the first permitted area that is actually built, so
 * somebody with a single role lands on their work rather than on an apology.
 */
export const initialArea = (roles: readonly string[]): AreaKey | undefined =>
  permittedAreas(roles).find((area) => !area.unbuiltReason)?.key ?? permittedAreas(roles)[0]?.key;

/**
 * Said to a signed-in account with no staff role at all. Signing in worked —
 * they simply have no operations access — and saying so plainly beats an empty
 * console that reads as a failure.
 */
export const NO_ROLES_MESSAGE =
  'This account has no staff role, so there is nothing to operate here. Ask an admin to grant one.';

/** A role list, in the order the catalogue defines them, for display. */
export const STAFF_ROLE_LABEL: Readonly<Record<string, string>> = {
  admin: 'Admin',
  data_steward: 'Data steward',
  moderator: 'Moderator',
  privacy_officer: 'Privacy officer',
  campaign_manager: 'Campaign manager',
  season_operator: 'Season operator',
  support: 'Support'
};

export const roleLabels = (roles: readonly string[]): readonly string[] =>
  [...roles].sort().map((role) => STAFF_ROLE_LABEL[role] ?? role);

/**
 * Every read and write in this console is audited server-side, including the
 * reads. Saying so where staff can see it is part of the deal: the people
 * using it should know their own use is recorded.
 */
export const AUDIT_NOTICE =
  'Every queue read and every decision here is recorded against your staff account.';

/**
 * The sanction kinds a moderator may issue, in ascending severity, with what
 * each one actually does (milestone 3.11).
 *
 * Written for the person choosing, not for the schema: somebody deciding
 * between these needs to know that a social suspension leaves recording and
 * history alone, and that an account suspension stops the account entirely.
 */
export const SANCTION_CHOICES = [
  {
    kind: 'warning' as const,
    label: 'Warning',
    effect: 'Changes nothing. It is a record, and it never expires.'
  },
  {
    kind: 'social_suspension' as const,
    label: 'Pause sharing',
    effect:
      'Boards, clubs, challenges, and competitions stop for them. Recording, history, and export are untouched.'
  },
  {
    kind: 'account_suspension' as const,
    label: 'Suspend the account',
    effect: 'They cannot sign in at all while it applies.'
  }
];

/**
 * Said above the statement field. The statement is the only thing the
 * sanctioned account reads, so it is the whole of what they are told.
 */
export const SANCTION_STATEMENT_HINT =
  'This is shown to the account, and it is all they are told. Write what they did and what changes, in words they can act on.';

/** Said above the reason field when lifting. */
export const SANCTION_LIFT_HINT =
  'Kept with the sanction as the record of why it ended early. The account is told the decision was lifted, not this reason.';

/** Whether a sanction can still be ended early. */
export const sanctionLiftable = (sanction: { inForce: boolean }): boolean => sanction.inForce;

/**
 * Warned about before lifting under an open appeal: two staff deciding the
 * same thing in different directions is how a decision stops being one.
 */
export const OPEN_APPEAL_WARNING =
  'An appeal on this sanction is still open. Decide the appeal instead, so the account gets one answer rather than two.';

/**
 * Both governance areas are read-only, and the console says why rather than
 * leaving somebody hunting for a button that was never built (milestone 3.12).
 */
export const PRIVACY_READ_ONLY_NOTE =
  'Read-only. The worker performs erasure; a console that deleted an account outside that path would be a second way to destroy data, with none of the worker’s ordering guarantees. What matters here is that nothing has stopped moving.';

export const RULES_READ_ONLY_NOTE =
  'Read-only. Rules are published by migration, so what is live here is what a reviewed change put there.';

/**
 * A request nobody has serviced for this long is the thing a privacy officer is
 * looking for. Not a rule the server enforces — an erasure is not late in any
 * legal sense at 48 hours — but the point at which a human should look.
 */
export const PRIVACY_ATTENTION_HOURS = 48;

export const privacyNeedsAttention = (request: { openForHours: number }): boolean =>
  request.openForHours >= PRIVACY_ATTENTION_HOURS;

/**
 * The winner-concentration baselines a season operator is watching
 * (`product.md`, milestone 4.6). Repeated here as display copy rather than
 * imported as numbers, because what an operator needs is the sentence: the
 * limit, and what happens when it is missed for a week.
 */
export const CONCENTRATION_NOTE =
  'In any division the top 10% should hold no more than 35% of season points, and the top participant no more than 8%. Seven consecutive breached days pauses awards analysis and starts an investigation into cell scarcity and validation abuse.';

/**
 * Said where a division is too small for those limits to be reachable. In a
 * division of twelve an exactly even split already exceeds 8%, so a breach
 * there is arithmetic rather than a finding, and the console says which it is.
 */
export const CONCENTRATION_NOT_APPLICABLE_NOTE =
  'This division is too small for the limits to be reachable, so they are not evaluated. That is a reason to merge it at the next season start, not a concentration problem.';

/** Said above the rollback reason field. */
export const ROLLBACK_REASON_HINT =
  'Kept with the week as the record of why its numbers changed. A participant asking why their week moved is answered with this.';

/**
 * Nothing here recalculates or edits a week. A rollback points the week at a
 * snapshot that already exists, and the console says so before somebody asks
 * for the button that would rewrite one.
 */
export const ROLLBACK_NOTE =
  'A rollback shows an earlier snapshot of the week. No snapshot is edited or deleted, and rolling forward is a recomputation rather than a rollback. Standings follow on the next sweep.';
