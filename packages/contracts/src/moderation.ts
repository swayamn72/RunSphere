import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, Strict, UuidSchema } from './common.js';

/**
 * Moderation (Phase 3, milestone 3.7).
 *
 * Reporting is the counterpart to blocking: blocking hides two accounts from
 * each other, reporting asks staff to look. A report is about what somebody
 * published — a display name, a profile, a club — and nothing in these
 * contracts carries an activity, a location, or a route.
 */
export const ReportReasonSchema = Type.Union([
  Type.Literal('impersonation'),
  Type.Literal('harassment'),
  Type.Literal('hate_or_violence'),
  Type.Literal('sexual_content'),
  Type.Literal('spam_or_scam'),
  Type.Literal('self_harm'),
  Type.Literal('other')
]);

export const ReportSubjectTypeSchema = Type.Union([Type.Literal('account'), Type.Literal('club')]);

export const ReportCreateRequestSchema = Type.Object(
  {
    subjectType: ReportSubjectTypeSchema,
    subjectId: UuidSchema,
    reason: ReportReasonSchema,
    /** The reporter's own words, in their own account of it. */
    note: Type.Optional(Type.String({ maxLength: 1000 }))
  },
  { ...Strict, $id: 'ReportCreateRequest' }
);

/**
 * What a reporter is told: that the report was received, and nothing else.
 *
 * There is deliberately no outcome, no status, and no reference to the
 * subject's account here. A report that reported back would be a way to probe
 * what happened to somebody else, and the reporter is not owed — and must not
 * have — that.
 */
export const ReportAcknowledgementSchema = Type.Object(
  {
    received: Type.Boolean(),
    /** Said once, plainly, so nobody waits for an update that never comes. */
    message: Type.String({ minLength: 1, maxLength: 300 })
  },
  { $id: 'ReportAcknowledgement' }
);

export const SanctionKindSchema = Type.Union([
  Type.Literal('warning'),
  Type.Literal('social_suspension'),
  Type.Literal('account_suspension')
]);

/**
 * A sanction as the account it landed on sees it. The statement is written by
 * staff for this reader: a sanction nobody can read is not moderation.
 */
export const SanctionSchema = Type.Object(
  {
    id: UuidSchema,
    kind: SanctionKindSchema,
    reason: ReportReasonSchema,
    statement: Type.String({ minLength: 1, maxLength: 1000 }),
    issuedAt: DateTimeSchema,
    /** Absent means indefinite, which only an account suspension may be. */
    expiresAt: Type.Optional(DateTimeSchema),
    /** True while it still applies — neither expired nor revoked. */
    inForce: Type.Boolean(),
    /** Whether this account may still answer it; one appeal per sanction. */
    canAppeal: Type.Boolean(),
    appeal: Type.Optional(
      Type.Object(
        {
          id: UuidSchema,
          status: Type.Union([
            Type.Literal('open'),
            Type.Literal('upheld'),
            Type.Literal('overturned')
          ]),
          createdAt: DateTimeSchema,
          decidedAt: Type.Optional(DateTimeSchema),
          /** Staff's reason, told to the appellant. */
          decisionNote: Type.String({ maxLength: 1000 })
        },
        { $id: 'SanctionAppeal' }
      )
    )
  },
  { $id: 'Sanction' }
);

export const SanctionListResponseSchema = Type.Object(
  { data: Type.Array(SanctionSchema, { maxItems: 100 }) },
  { $id: 'SanctionListResponse' }
);

export const AppealCreateRequestSchema = Type.Object(
  { statement: Type.String({ minLength: 1, maxLength: 2000 }) },
  { ...Strict, $id: 'AppealCreateRequest' }
);

export const SanctionParamsSchema = Type.Object(
  { sanctionId: UuidSchema },
  { ...Strict, $id: 'SanctionParams' }
);

/** One open report, as the staff queue shows it. Staff-only. */
export const StaffReportSchema = Type.Object(
  {
    id: UuidSchema,
    subjectType: ReportSubjectTypeSchema,
    subjectId: UuidSchema,
    /** The published name being reported, so the queue is readable. */
    subjectName: Type.String({ maxLength: 120 }),
    reason: ReportReasonSchema,
    note: Type.String({ maxLength: 1000 }),
    createdAt: DateTimeSchema,
    /** How many open reports this subject has, so a pattern is visible. */
    openReportCount: Type.Integer({ minimum: 1 })
  },
  { $id: 'StaffReport' }
);

export const StaffReportListResponseSchema = Type.Object(
  { data: Type.Array(StaffReportSchema, { maxItems: 100 }) },
  { $id: 'StaffReportListResponse' }
);

/**
 * Resolving a report. Dismissing closes it with a staff-only note; sanctioning
 * closes it and issues the sanction the subject will be shown.
 */
export const StaffReportResolveRequestSchema = Type.Object(
  {
    action: Type.Union([Type.Literal('dismiss'), Type.Literal('sanction')]),
    /** Staff-only; never returned to the reporter or the subject. */
    resolutionNote: Type.Optional(Type.String({ maxLength: 1000 })),
    sanctionKind: Type.Optional(SanctionKindSchema),
    /** Shown to the sanctioned account, so it is required to sanction. */
    statement: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    /** Absent means indefinite; only an account suspension may be. */
    durationHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 8760 }))
  },
  { ...Strict, $id: 'StaffReportResolveRequest' }
);

export const StaffAppealSchema = Type.Object(
  {
    id: UuidSchema,
    sanctionId: UuidSchema,
    accountId: UuidSchema,
    sanctionKind: SanctionKindSchema,
    reason: ReportReasonSchema,
    /** What staff told the account when the sanction was issued. */
    sanctionStatement: Type.String({ maxLength: 1000 }),
    /** The account's own answer. */
    statement: Type.String({ maxLength: 2000 }),
    createdAt: DateTimeSchema
  },
  { $id: 'StaffAppeal' }
);

export const StaffAppealListResponseSchema = Type.Object(
  { data: Type.Array(StaffAppealSchema, { maxItems: 100 }) },
  { $id: 'StaffAppealListResponse' }
);

/**
 * Deciding an appeal. `upheld` means the *sanction* stands and the appeal
 * failed; `overturned` revokes the sanction. The note is told to the
 * appellant, because a decision without a reason is not an answer.
 */
export const StaffAppealDecisionRequestSchema = Type.Object(
  {
    decision: Type.Union([Type.Literal('upheld'), Type.Literal('overturned')]),
    decisionNote: Type.String({ minLength: 1, maxLength: 1000 })
  },
  { ...Strict, $id: 'StaffAppealDecisionRequest' }
);

/**
 * One sanction as staff see it (milestone 3.11).
 *
 * It carries the statement the account was shown and who issued it, because a
 * moderator deciding whether to lift something needs to read what was actually
 * said — but it carries no reporter, because who reported somebody is not part
 * of the decision to lift.
 */
export const StaffSanctionSchema = Type.Object(
  {
    id: UuidSchema,
    accountId: UuidSchema,
    kind: SanctionKindSchema,
    reason: ReportReasonSchema,
    statement: Type.String({ maxLength: 1000 }),
    issuedAt: DateTimeSchema,
    expiresAt: Type.Optional(DateTimeSchema),
    revokedAt: Type.Optional(DateTimeSchema),
    revokedReason: Type.String({ maxLength: 500 }),
    inForce: Type.Boolean(),
    /** Whether an appeal has been filed, so a lift is not a surprise to one. */
    hasOpenAppeal: Type.Boolean()
  },
  { $id: 'StaffSanction' }
);

export const StaffSanctionListResponseSchema = Type.Object(
  { data: Type.Array(StaffSanctionSchema, { maxItems: 100 }) },
  { $id: 'StaffSanctionListResponse' }
);

/**
 * Lifting a sanction early. The reason is required and is kept with the
 * sanction: an action that changes what somebody may do, with no record of
 * why, is the kind of thing an audit exists to catch.
 */
export const StaffSanctionLiftRequestSchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 500 }) },
  { ...Strict, $id: 'StaffSanctionLiftRequest' }
);

export const StaffAccountParamsSchema = Type.Object(
  { accountId: UuidSchema },
  { ...Strict, $id: 'StaffAccountParams' }
);

export const ReportParamsSchema = Type.Object(
  { reportId: UuidSchema },
  { ...Strict, $id: 'ReportParams' }
);

export const AppealParamsSchema = Type.Object(
  { appealId: UuidSchema },
  { ...Strict, $id: 'AppealParams' }
);

export type ReportReason = Static<typeof ReportReasonSchema>;
export type ReportSubjectType = Static<typeof ReportSubjectTypeSchema>;
export type ReportCreateRequest = Static<typeof ReportCreateRequestSchema>;
export type ReportAcknowledgement = Static<typeof ReportAcknowledgementSchema>;
export type SanctionKind = Static<typeof SanctionKindSchema>;
export type Sanction = Static<typeof SanctionSchema>;
export type SanctionListResponse = Static<typeof SanctionListResponseSchema>;
export type AppealCreateRequest = Static<typeof AppealCreateRequestSchema>;
export type SanctionParams = Static<typeof SanctionParamsSchema>;
export type StaffReport = Static<typeof StaffReportSchema>;
export type StaffReportListResponse = Static<typeof StaffReportListResponseSchema>;
export type StaffReportResolveRequest = Static<typeof StaffReportResolveRequestSchema>;
export type StaffAppeal = Static<typeof StaffAppealSchema>;
export type StaffAppealListResponse = Static<typeof StaffAppealListResponseSchema>;
export type StaffAppealDecisionRequest = Static<typeof StaffAppealDecisionRequestSchema>;
export type StaffSanction = Static<typeof StaffSanctionSchema>;
export type StaffSanctionListResponse = Static<typeof StaffSanctionListResponseSchema>;
export type StaffSanctionLiftRequest = Static<typeof StaffSanctionLiftRequestSchema>;
export type StaffAccountParams = Static<typeof StaffAccountParamsSchema>;
export type ReportParams = Static<typeof ReportParamsSchema>;
export type AppealParams = Static<typeof AppealParamsSchema>;
