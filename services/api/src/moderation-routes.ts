import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  AppealCreateRequestSchema,
  AppealParamsSchema,
  ErrorResponseSchema,
  ReportAcknowledgementSchema,
  ReportCreateRequestSchema,
  ReportParamsSchema,
  SanctionListResponseSchema,
  SanctionParamsSchema,
  StaffAccountParamsSchema,
  StaffAppealDecisionRequestSchema,
  StaffAppealListResponseSchema,
  StaffReportListResponseSchema,
  StaffReportResolveRequestSchema,
  StaffSanctionListResponseSchema,
  StaffSanctionLiftRequestSchema,
  type AppealCreateRequest,
  type AppealParams,
  type ReportAcknowledgement,
  type ReportCreateRequest,
  type ReportParams,
  type Sanction,
  type SanctionKind,
  type SanctionParams,
  type StaffAccountParams,
  type StaffAppealDecisionRequest,
  type StaffReportResolveRequest,
  type StaffSanctionLiftRequest
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import {
  appealRevokesSanction,
  canAppealSanction,
  canModerate,
  canReport,
  sanctionInForce,
  sanctionMayExpire
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';

/**
 * Moderation (Phase 3, milestone 3.7).
 *
 * Blocking hides two accounts from each other; reporting asks staff to look.
 * The two are independent on purpose, which is what finally lets a blocked
 * account be reported — the gap this milestone existed to close.
 *
 * Three rules run through every route here. A reporter is told their report
 * was received and nothing else, so a report cannot be used to probe what
 * happened to somebody else. A sanction is told to the account it lands on, in
 * words staff wrote for that reader. And every staff decision is attributable
 * and audited.
 *
 * Nothing in this file reads or returns an activity, a location, or a route.
 */
export interface ModerationRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const REPORT_ACKNOWLEDGEMENT =
  'Thanks — this is with our moderators. We will not send you an update about somebody else’s account, but blocking them is always available to you.';

const requireAccount = (
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string
): string | undefined => {
  const value = request.headers.authorization;
  const accountId = value?.startsWith('Bearer ')
    ? verifyAccessToken(value.slice(7), secret)
    : undefined;
  if (!accountId) void reply.code(401).send({ message: 'Unauthorized' });
  return accountId;
};

const staffRoles = async (database: Database, accountId: string): Promise<string[]> => {
  const result = await database.query<{ role: string }>(
    'SELECT role FROM staff_role_assignments WHERE account_id = $1',
    [accountId]
  );
  return result.rows.map((row) => row.role);
};

const staffAudit = (
  database: Database,
  accountId: string,
  action: string
): Promise<{ rows: unknown[] }> =>
  database.query(
    `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
     VALUES ($1, $2, 'moderation', 1)`,
    [accountId, action]
  );

interface SanctionRow {
  id: string;
  kind: SanctionKind;
  reason: Sanction['reason'];
  statement: string;
  issued_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  appeal_id: string | null;
  appeal_status: 'open' | 'upheld' | 'overturned' | null;
  appeal_created_at: Date | null;
  appeal_decided_at: Date | null;
  appeal_decision_note: string | null;
}

const sanctionFrom = (row: SanctionRow, now: Date): Sanction => {
  const state = {
    expiresAt: row.expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined
  };
  return {
    id: row.id,
    kind: row.kind,
    reason: row.reason,
    statement: row.statement,
    issuedAt: row.issued_at.toISOString(),
    ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
    inForce: sanctionInForce(state, now),
    canAppeal: canAppealSanction(state, Boolean(row.appeal_id), now),
    ...(row.appeal_id && row.appeal_status && row.appeal_created_at
      ? {
          appeal: {
            id: row.appeal_id,
            status: row.appeal_status,
            createdAt: row.appeal_created_at.toISOString(),
            ...(row.appeal_decided_at ? { decidedAt: row.appeal_decided_at.toISOString() } : {}),
            decisionNote: row.appeal_decision_note ?? ''
          }
        }
      : {})
  };
};

const SANCTION_SELECT = `
  SELECT sanction.id, sanction.kind, sanction.reason, sanction.statement, sanction.issued_at,
    sanction.expires_at, sanction.revoked_at,
    appeal.id AS appeal_id, appeal.status AS appeal_status, appeal.created_at AS appeal_created_at,
    appeal.decided_at AS appeal_decided_at, appeal.decision_note AS appeal_decision_note
  FROM sanctions sanction
  LEFT JOIN sanction_appeals appeal ON appeal.sanction_id = sanction.id`;

export const registerModerationRoutes = ({
  routes,
  database,
  authSecret
}: ModerationRouteDeps): void => {
  /**
   * Report an account or a club.
   *
   * The answer is the same whether the subject exists, was already reported by
   * somebody else, or is already sanctioned: a report is not a lookup, and an
   * answer that varied would make it one. A second open report on the same
   * subject by the same reporter is folded into the first rather than
   * refused — telling somebody "you already reported this" is both a state
   * disclosure and a discouragement.
   *
   * Reporting works on a blocked account: blocking hides somebody, it does not
   * revoke your ability to raise what they did.
   */
  routes.post<{ Body: ReportCreateRequest }>(
    '/v1/reports',
    {
      schema: {
        tags: ['moderation'],
        headers: ActivityAuthorizationHeadersSchema,
        body: ReportCreateRequestSchema,
        response: {
          202: ReportAcknowledgementSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (
        !canReport({
          reporterAccountId: accountId,
          subjectId: request.body.subjectId,
          reason: request.body.reason
        })
      )
        return reply.code(400).send({ message: 'That report cannot be filed' });

      await database.query(
        `INSERT INTO reports (reporter_account_id, subject_type, subject_id, reason, note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (reporter_account_id, subject_type, subject_id) WHERE status = 'open'
         DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note, created_at = now()`,
        [
          accountId,
          request.body.subjectType,
          request.body.subjectId,
          request.body.reason,
          request.body.note ?? ''
        ]
      );
      // Audited against the reporter's own account: the subject's id is the
      // report's business, not an entry in somebody else's privacy log.
      await database.query(
        `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type,
           resource_id, metadata)
         VALUES ($1, $1, 'report.filed', 'report', NULL, $2)`,
        [accountId, JSON.stringify({ subjectType: request.body.subjectType })]
      );
      const response: ReportAcknowledgement = {
        received: true,
        message: REPORT_ACKNOWLEDGEMENT
      };
      return reply.code(202).send(response);
    }
  );

  /**
   * The account's own sanctions, newest first — every one it has ever been
   * given, not only those in force. A record that disappears when it expires
   * cannot be answered or checked, and an account is owed the history of what
   * was done to it.
   */
  routes.get(
    '/v1/account/sanctions',
    {
      schema: {
        tags: ['moderation'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: SanctionListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const sanctions = await database.query<SanctionRow>(
        `${SANCTION_SELECT}
         WHERE sanction.account_id = $1
         ORDER BY sanction.issued_at DESC
         LIMIT 100`,
        [accountId]
      );
      const now = new Date();
      return { data: sanctions.rows.map((row) => sanctionFrom(row, now)) };
    }
  );

  /**
   * Appeal a sanction. Once, in the account's own words, and only while the
   * sanction is still in force — an expired sanction has already ended, and
   * asking somebody to argue against something that no longer applies is busy
   * work for both sides.
   */
  routes.post<{ Params: SanctionParams; Body: AppealCreateRequest }>(
    '/v1/sanctions/:sanctionId/appeal',
    {
      schema: {
        tags: ['moderation'],
        headers: ActivityAuthorizationHeadersSchema,
        params: SanctionParamsSchema,
        body: AppealCreateRequestSchema,
        response: {
          201: SanctionListResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const found = await database.query<SanctionRow>(
        `${SANCTION_SELECT}
         WHERE sanction.id = $1 AND sanction.account_id = $2`,
        [request.params.sanctionId, accountId]
      );
      const row = found.rows[0];
      // Somebody else's sanction is not found rather than forbidden: its
      // existence is not this account's business.
      if (!row) return reply.code(404).send({ message: 'Sanction not found' });
      const now = new Date();
      if (
        !canAppealSanction(
          { expiresAt: row.expires_at ?? undefined, revokedAt: row.revoked_at ?? undefined },
          Boolean(row.appeal_id),
          now
        )
      )
        return reply.code(409).send({ message: 'That sanction cannot be appealed' });

      await database.query(
        `INSERT INTO sanction_appeals (sanction_id, account_id, statement)
         VALUES ($1, $2, $3) ON CONFLICT (sanction_id) DO NOTHING`,
        [row.id, accountId, request.body.statement]
      );
      const updated = await database.query<SanctionRow>(
        `${SANCTION_SELECT}
         WHERE sanction.id = $1 AND sanction.account_id = $2`,
        [row.id, accountId]
      );
      return reply
        .code(201)
        .send({ data: updated.rows.map((sanction) => sanctionFrom(sanction, now)) });
    }
  );

  /**
   * Every sanction on one account (milestone 3.11).
   *
   * A moderator deciding whether to lift something needs to read what the
   * account was actually told, and to see whether an appeal is already open —
   * lifting under an appeal that is about to be decided is how two staff end
   * up contradicting each other. The response carries no reporter: who
   * reported somebody is not part of the decision to lift.
   */
  routes.get<{ Params: StaffAccountParams }>(
    '/v1/staff/accounts/:accountId/sanctions',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: StaffAccountParamsSchema,
        response: {
          200: StaffSanctionListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canModerate(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Reading sanctions needs a moderator role' });

      const sanctions = await database.query<
        SanctionRow & { account_id: string; revoked_reason: string }
      >(
        `SELECT sanction.id, sanction.account_id, sanction.kind, sanction.reason,
           sanction.statement, sanction.issued_at, sanction.expires_at, sanction.revoked_at,
           sanction.revoked_reason,
           appeal.id AS appeal_id, appeal.status AS appeal_status,
           appeal.created_at AS appeal_created_at, appeal.decided_at AS appeal_decided_at,
           appeal.decision_note AS appeal_decision_note
         FROM sanctions sanction
         LEFT JOIN sanction_appeals appeal ON appeal.sanction_id = sanction.id
         WHERE sanction.account_id = $1
         ORDER BY sanction.issued_at DESC
         LIMIT 100`,
        [request.params.accountId]
      );
      await staffAudit(database, accountId, 'moderation.sanctions.read');
      const now = new Date();
      return {
        data: sanctions.rows.map((row) => ({
          id: row.id,
          accountId: row.account_id,
          kind: row.kind,
          reason: row.reason,
          statement: row.statement,
          issuedAt: row.issued_at.toISOString(),
          ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
          ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
          revokedReason: row.revoked_reason,
          inForce: sanctionInForce(
            { expiresAt: row.expires_at ?? undefined, revokedAt: row.revoked_at ?? undefined },
            now
          ),
          hasOpenAppeal: row.appeal_status === 'open'
        }))
      };
    }
  );

  /**
   * Lift a sanction early.
   *
   * This is the action that had no audited path: before it existed, ending a
   * suspension before its time meant a database change nobody could review.
   * The reason is required and stored with the sanction, the account is told,
   * and the record stays — a lifted sanction is revoked, never deleted.
   *
   * An already-revoked sanction answers `409` rather than silently rewriting
   * the reason it ended for.
   */
  routes.post<{ Params: SanctionParams; Body: StaffSanctionLiftRequest }>(
    '/v1/staff/sanctions/:sanctionId/lift',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: SanctionParamsSchema,
        body: StaffSanctionLiftRequestSchema,
        response: {
          204: { type: 'null' },
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canModerate(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Lifting a sanction needs a moderator role' });

      const lifted = await withTransaction(database, async (client) => {
        const claimed = await client.query<{ account_id: string }>(
          `UPDATE sanctions SET revoked_at = now(), revoked_reason = $2
           WHERE id = $1 AND revoked_at IS NULL
           RETURNING account_id`,
          [request.params.sanctionId, request.body.reason]
        );
        const row = claimed.rows[0];
        if (!row) return undefined;
        // Told in the same transaction, so an account is never left with a
        // sanction lifted and no word of it.
        await client.query(
          `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link)
           VALUES ($1, 'account', 'A moderation decision was lifted',
             'Open your account settings to read what changed.', 'runsphere://account/sanctions')`,
          [row.account_id]
        );
        return row.account_id;
      });
      if (!lifted) {
        const existing = await database.query<{ id: string }>(
          'SELECT id FROM sanctions WHERE id = $1',
          [request.params.sanctionId]
        );
        return existing.rows[0]
          ? reply.code(409).send({ message: 'That sanction has already ended' })
          : reply.code(404).send({ message: 'Sanction not found' });
      }
      await staffAudit(database, accountId, 'moderation.sanction.lifted');
      return reply.code(204).send();
    }
  );

  /**
   * The moderation queue: open reports, oldest first, so nothing waits
   * indefinitely. `openReportCount` shows how many open reports the same
   * subject has, because a pattern is the thing a single report cannot show.
   */
  routes.get(
    '/v1/staff/reports',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: StaffReportListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canModerate(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'The report queue needs a moderator role' });

      const reports = await database.query<{
        id: string;
        subject_type: 'account' | 'club';
        subject_id: string;
        subject_name: string | null;
        reason: Sanction['reason'];
        note: string;
        created_at: Date;
        open_report_count: string;
      }>(
        `SELECT report.id, report.subject_type, report.subject_id, report.reason, report.note,
           report.created_at,
           CASE report.subject_type
             WHEN 'account' THEN (SELECT profile.display_name FROM profiles profile
               WHERE profile.account_id = report.subject_id)
             WHEN 'club' THEN (SELECT club.name FROM clubs club WHERE club.id = report.subject_id)
           END AS subject_name,
           (SELECT count(*) FROM reports peer
             WHERE peer.subject_type = report.subject_type
               AND peer.subject_id = report.subject_id AND peer.status = 'open')::text
             AS open_report_count
         FROM reports report
         WHERE report.status = 'open'
         ORDER BY report.created_at
         LIMIT 100`
      );
      await staffAudit(database, accountId, 'moderation.queue.read');
      return {
        data: reports.rows.map((row) => ({
          id: row.id,
          subjectType: row.subject_type,
          subjectId: row.subject_id,
          subjectName: row.subject_name ?? 'RunSphere member',
          reason: row.reason,
          note: row.note,
          createdAt: row.created_at.toISOString(),
          openReportCount: Number(row.open_report_count)
        }))
      };
    }
  );

  /**
   * Resolve one report: dismiss it, or close it and issue the sanction the
   * subject will be shown.
   *
   * A sanction needs a statement written for the account that receives it, so
   * the route refuses to issue one without it. Only account subjects can be
   * sanctioned this way — a club is moderated by acting on its owner or by
   * archiving it, and inventing a club-wide punishment here would hit every
   * member for one person's name.
   */
  routes.post<{ Params: ReportParams; Body: StaffReportResolveRequest }>(
    '/v1/staff/reports/:reportId/resolve',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ReportParamsSchema,
        body: StaffReportResolveRequestSchema,
        response: {
          204: { type: 'null' },
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canModerate(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Resolving a report needs a moderator role' });

      const found = await database.query<{
        id: string;
        subject_type: 'account' | 'club';
        subject_id: string;
        reason: Sanction['reason'];
        status: string;
      }>('SELECT id, subject_type, subject_id, reason, status FROM reports WHERE id = $1', [
        request.params.reportId
      ]);
      const report = found.rows[0];
      if (!report) return reply.code(404).send({ message: 'Report not found' });
      if (report.status !== 'open')
        return reply.code(409).send({ message: 'That report is already resolved' });

      if (request.body.action === 'sanction') {
        if (!request.body.sanctionKind || !request.body.statement)
          return reply.code(422).send({
            message: 'A sanction needs a kind and a statement the account will be shown'
          });
        if (report.subject_type !== 'account')
          return reply
            .code(422)
            .send({ message: 'Only an account can be sanctioned from a report' });
        if (request.body.durationHours && !sanctionMayExpire(request.body.sanctionKind))
          return reply.code(422).send({ message: 'A warning does not expire' });
      }

      await withTransaction(database, async (client) => {
        const claimed = await client.query<{ id: string }>(
          `UPDATE reports SET status = $2, resolved_at = now(), resolved_by_account_id = $3,
             resolution_note = $4
           WHERE id = $1 AND status = 'open' RETURNING id`,
          [
            report.id,
            request.body.action === 'sanction' ? 'actioned' : 'dismissed',
            accountId,
            request.body.resolutionNote ?? ''
          ]
        );
        if (!claimed.rows[0]) return;
        if (request.body.action !== 'sanction') return;

        const expiresAt = request.body.durationHours
          ? new Date(Date.now() + request.body.durationHours * 3_600_000)
          : null;
        await client.query(
          `INSERT INTO sanctions (account_id, kind, reason, statement, expires_at,
             issued_by_account_id, report_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            report.subject_id,
            request.body.sanctionKind,
            report.reason,
            request.body.statement,
            expiresAt,
            accountId,
            report.id
          ]
        );
        // The account is told, in its inbox, that something happened and where
        // to read it. The body carries no reporter and no reason code: the
        // statement staff wrote is the place for that.
        await client.query(
          `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link)
           VALUES ($1, 'account', 'A moderation decision about your account',
             'Open your account settings to read the decision and how to answer it.',
             'runsphere://account/sanctions')`,
          [report.subject_id]
        );
      });
      await staffAudit(
        database,
        accountId,
        request.body.action === 'sanction'
          ? 'moderation.report.actioned'
          : 'moderation.report.dismissed'
      );
      return reply.code(204).send();
    }
  );

  /** Open appeals, oldest first. */
  routes.get(
    '/v1/staff/appeals',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: StaffAppealListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canModerate(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'The appeal queue needs a moderator role' });

      const appeals = await database.query<{
        id: string;
        sanction_id: string;
        account_id: string;
        kind: SanctionKind;
        reason: Sanction['reason'];
        sanction_statement: string;
        statement: string;
        created_at: Date;
      }>(
        `SELECT appeal.id, appeal.sanction_id, appeal.account_id, appeal.statement,
           appeal.created_at, sanction.kind, sanction.reason,
           sanction.statement AS sanction_statement
         FROM sanction_appeals appeal
         JOIN sanctions sanction ON sanction.id = appeal.sanction_id
         WHERE appeal.status = 'open'
         ORDER BY appeal.created_at
         LIMIT 100`
      );
      await staffAudit(database, accountId, 'moderation.appeals.read');
      return {
        data: appeals.rows.map((row) => ({
          id: row.id,
          sanctionId: row.sanction_id,
          accountId: row.account_id,
          sanctionKind: row.kind,
          reason: row.reason,
          sanctionStatement: row.sanction_statement,
          statement: row.statement,
          createdAt: row.created_at.toISOString()
        }))
      };
    }
  );

  /**
   * Decide an appeal. `upheld` means the sanction stands; `overturned` revokes
   * it in the same transaction, so a lifted sanction is never briefly still in
   * force. The note is required either way, because a decision without a
   * reason is not an answer.
   */
  routes.post<{ Params: AppealParams; Body: StaffAppealDecisionRequest }>(
    '/v1/staff/appeals/:appealId/decision',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: AppealParamsSchema,
        body: StaffAppealDecisionRequestSchema,
        response: {
          204: { type: 'null' },
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canModerate(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Deciding an appeal needs a moderator role' });

      const found = await database.query<{ id: string; sanction_id: string; status: string }>(
        'SELECT id, sanction_id, status FROM sanction_appeals WHERE id = $1',
        [request.params.appealId]
      );
      const appeal = found.rows[0];
      if (!appeal) return reply.code(404).send({ message: 'Appeal not found' });
      if (appeal.status !== 'open')
        return reply.code(409).send({ message: 'That appeal is already decided' });

      const revokes = appealRevokesSanction(request.body.decision);
      await withTransaction(database, async (client) => {
        const claimed = await client.query<{ account_id: string }>(
          `UPDATE sanction_appeals SET status = $2, decided_at = now(),
             decided_by_account_id = $3, decision_note = $4
           WHERE id = $1 AND status = 'open' RETURNING account_id`,
          [appeal.id, request.body.decision, accountId, request.body.decisionNote]
        );
        const decided = claimed.rows[0];
        if (!decided) return;
        if (revokes) {
          await client.query(
            `UPDATE sanctions SET revoked_at = now(), revoked_reason = 'appeal_overturned'
             WHERE id = $1 AND revoked_at IS NULL`,
            [appeal.sanction_id]
          );
        }
        await client.query(
          `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link)
           VALUES ($1, 'account', 'Your appeal has been decided',
             'Open your account settings to read the decision.', 'runsphere://account/sanctions')`,
          [decided.account_id]
        );
      });
      await staffAudit(
        database,
        accountId,
        revokes ? 'moderation.appeal.overturned' : 'moderation.appeal.upheld'
      );
      return reply.code(204).send();
    }
  );
};
