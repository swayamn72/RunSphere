import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  CampaignCreateRequestSchema,
  CampaignListResponseSchema,
  CampaignParamsSchema,
  CampaignPreviewResponseSchema,
  CampaignScheduleRequestSchema,
  CampaignSummarySchema,
  EmailTemplateCreateRequestSchema,
  EmailTemplateListResponseSchema,
  EmailTemplateSchema,
  ErrorResponseSchema,
  UnsubscribeRequestSchema,
  UnsubscribeResponseSchema,
  type CampaignAudience,
  type CampaignCreateRequest,
  type CampaignParams,
  type CampaignScheduleRequest,
  type CampaignStatus,
  type CampaignSummary,
  type EmailTemplate,
  type EmailTemplateCreateRequest,
  type UnsubscribeRequest,
  type UnsubscribeResponse
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import {
  audienceRefusalReason,
  campaignCancellable,
  campaignSchedulable,
  canManageCampaigns,
  cappedRecipientCount,
  scheduleTooSoon
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';

/**
 * Consented campaign email (Phase 3, milestone 3.9).
 *
 * Two audiences, two shapes of route. Staff draft, preview, schedule, and
 * cancel; anybody holding an unsubscribe token can switch marketing email off
 * without signing in, because an unsubscribe that needs a password is not an
 * unsubscribe.
 *
 * The rule that shapes the staff side: **a campaign manager sees counts, never
 * people.** No route here returns an account id, a display name, or an email
 * address, so the campaign tool cannot become an export of who consented.
 */
export interface CampaignRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const UNSUBSCRIBE_ANSWER =
  'If that link was still valid, campaign email is now off for the account it belongs to. You will still receive messages about your own account.';

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
     VALUES ($1, $2, 'campaign', 1)`,
    [accountId, action]
  );

interface CampaignRow {
  id: string;
  template_key: string;
  template_version: number | null;
  audience: unknown;
  status: CampaignStatus;
  send_cap: number;
  scheduled_for: Date | null;
  created_at: Date;
  queued_count: string;
  sent_count: string;
  skipped_count: string;
}

const summaryFrom = (row: CampaignRow): CampaignSummary => ({
  id: row.id,
  templateKey: row.template_key,
  ...(row.template_version ? { templateVersion: row.template_version } : {}),
  audience: row.audience as CampaignAudience,
  status: row.status,
  sendCap: row.send_cap,
  ...(row.scheduled_for ? { scheduledFor: row.scheduled_for.toISOString() } : {}),
  queuedCount: Number(row.queued_count ?? 0),
  sentCount: Number(row.sent_count ?? 0),
  skippedCount: Number(row.skipped_count ?? 0),
  createdAt: row.created_at.toISOString()
});

const CAMPAIGN_SELECT = `
  SELECT campaign.id, campaign.template_key, campaign.template_version, campaign.audience,
    campaign.status, campaign.send_cap, campaign.scheduled_for, campaign.created_at,
    count(recipient.account_id) FILTER (WHERE recipient.status = 'queued')::text AS queued_count,
    count(recipient.account_id) FILTER (WHERE recipient.status = 'sent')::text AS sent_count,
    count(recipient.account_id) FILTER (WHERE recipient.status = 'skipped')::text AS skipped_count
  FROM email_campaigns campaign
  LEFT JOIN email_campaign_recipients recipient ON recipient.campaign_id = campaign.id`;

/**
 * How many accounts an audience matches *right now*.
 *
 * Consent is all three switches: the `marketing_consent` flag, the `marketing`
 * category, and the `email` channel. Requiring all three means no single
 * forgotten toggle can put mail in somebody's inbox, and it is why an account
 * that never opted in matches nothing however the audience is drawn.
 *
 * The only other dimension this deployment can answer is a broad recency band
 * — "moved at all in the last N days", with N at least 7 — which reads whether
 * an activity exists and never what it was: no distance, no pace, no place, no
 * quest. Locale, app version, and feature cohort are refused by the domain
 * until something records them.
 */
export const audienceMatchCount = async (
  database: Database,
  audience: CampaignAudience
): Promise<number> => {
  const result = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM notification_preferences preference
     JOIN accounts account ON account.id = preference.account_id
       AND account.deleted_at IS NULL AND account.email_verified_at IS NOT NULL
     WHERE preference.marketing_consent = true
       AND coalesce((preference.categories ->> 'marketing')::boolean, false) = true
       AND coalesce((preference.channels ->> 'email')::boolean, false) = true
       AND ($1::int IS NULL OR EXISTS (
         SELECT 1 FROM activity_submissions recent
         WHERE recent.account_id = account.id AND recent.status = 'derived'
           AND recent.deleted_at IS NULL
           AND recent.processed_at >= now() - make_interval(days => $1)))`,
    [audience.recencyBandDays ?? null]
  );
  return Number(result.rows[0]?.count ?? 0);
};

export const registerCampaignRoutes = ({
  routes,
  database,
  authSecret
}: CampaignRouteDeps): void => {
  /**
   * Unsubscribe from an email link.
   *
   * No session, no account id in the request, and the same answer whatever the
   * token was: an endpoint that said "no such token" would let somebody test
   * tokens, and one that said "you are already unsubscribed" would confirm an
   * address belongs to an account. Switching all three consent switches off is
   * what makes this an unsubscribe rather than a pause.
   */
  routes.post<{ Body: UnsubscribeRequest }>(
    '/v1/email/unsubscribe',
    {
      schema: {
        tags: ['campaigns'],
        body: UnsubscribeRequestSchema,
        response: { 200: UnsubscribeResponseSchema, 503: ErrorResponseSchema }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const tokenHash = createHash('sha256').update(request.body.token).digest('hex');
      const matched = await database.query<{ account_id: string }>(
        `UPDATE email_unsubscribe_tokens SET last_used_at = now()
         WHERE token_hash = $1 RETURNING account_id`,
        [tokenHash]
      );
      const accountId = matched.rows[0]?.account_id;
      if (accountId) {
        await withTransaction(database, async (client) => {
          await client.query(
            `UPDATE notification_preferences
             SET marketing_consent = false,
               categories = jsonb_set(categories, '{marketing}', 'false'::jsonb),
               channels = jsonb_set(channels, '{email}', 'false'::jsonb),
               updated_at = now()
             WHERE account_id = $1`,
            [accountId]
          );
          // Withdrawal is recorded exactly where consent was granted, so the
          // history reads as one story rather than two.
          await client.query(
            `INSERT INTO consent_history (account_id, consent_type, granted, policy_version)
             VALUES ($1, 'marketing_email', false, 'unsubscribe_link')`,
            [accountId]
          );
        });
      }
      const response: UnsubscribeResponse = { message: UNSUBSCRIBE_ANSWER };
      return response;
    }
  );

  /** Campaigns, newest first, with what they actually reached. */
  routes.get(
    '/v1/staff/campaigns',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: CampaignListResponseSchema,
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
      if (!canManageCampaigns(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Campaigns need a campaign manager role' });

      const campaigns = await database.query<CampaignRow>(
        `${CAMPAIGN_SELECT}
         GROUP BY campaign.id
         ORDER BY campaign.created_at DESC
         LIMIT 100`
      );
      return { data: campaigns.rows.map(summaryFrom) };
    }
  );

  /**
   * Draft a campaign. It is created as a draft with no schedule: nothing here
   * sends anything, and the audience is checked before it is stored so a
   * refused shape never becomes a saved one.
   */
  routes.post<{ Body: CampaignCreateRequest }>(
    '/v1/staff/campaigns',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        body: CampaignCreateRequestSchema,
        response: {
          201: CampaignSummarySchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          422: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canManageCampaigns(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Campaigns need a campaign manager role' });

      const refusal = audienceRefusalReason(request.body.audience);
      if (refusal) return reply.code(422).send({ message: refusal });

      const created = await database.query<CampaignRow>(
        `INSERT INTO email_campaigns (template_key, audience, send_cap, created_by_account_id)
         VALUES ($1, $2::jsonb, $3, $4)
         RETURNING id, template_key, template_version, audience, status, send_cap, scheduled_for,
           created_at, '0' AS queued_count, '0' AS sent_count, '0' AS skipped_count`,
        [
          request.body.templateKey,
          JSON.stringify(request.body.audience),
          request.body.sendCap,
          accountId
        ]
      );
      await staffAudit(database, accountId, 'campaign.drafted');
      return reply.code(201).send(summaryFrom(created.rows[0]!));
    }
  );

  /**
   * What a draft would reach: two counts and the cap. Deliberately not a list
   * — see the file header.
   */
  routes.get<{ Params: CampaignParams }>(
    '/v1/staff/campaigns/:campaignId/preview',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: CampaignParamsSchema,
        response: {
          200: CampaignPreviewResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canManageCampaigns(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Campaigns need a campaign manager role' });

      const found = await database.query<{ audience: unknown; send_cap: number }>(
        'SELECT audience, send_cap FROM email_campaigns WHERE id = $1',
        [request.params.campaignId]
      );
      const campaign = found.rows[0];
      if (!campaign) return reply.code(404).send({ message: 'Campaign not found' });

      const matchingCount = await audienceMatchCount(
        database,
        campaign.audience as CampaignAudience
      );
      await staffAudit(database, accountId, 'campaign.previewed');
      return {
        matchingCount,
        cappedCount: cappedRecipientCount(matchingCount, campaign.send_cap),
        sendCap: campaign.send_cap
      };
    }
  );

  /**
   * Schedule a draft.
   *
   * The live template version is resolved and recorded here, so editing the
   * template afterwards cannot change what a scheduled campaign sends. A
   * template that does not exist is a `422`: the request is well-formed, there
   * is simply nothing approved to send.
   */
  routes.post<{ Params: CampaignParams; Body: CampaignScheduleRequest }>(
    '/v1/staff/campaigns/:campaignId/schedule',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: CampaignParamsSchema,
        body: CampaignScheduleRequestSchema,
        response: {
          200: CampaignSummarySchema,
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
      if (!canManageCampaigns(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Campaigns need a campaign manager role' });

      const found = await database.query<{ status: CampaignStatus; template_key: string }>(
        'SELECT status, template_key FROM email_campaigns WHERE id = $1',
        [request.params.campaignId]
      );
      const campaign = found.rows[0];
      if (!campaign) return reply.code(404).send({ message: 'Campaign not found' });
      if (!campaignSchedulable(campaign.status))
        return reply.code(409).send({ message: 'Only a draft can be scheduled' });

      const scheduledFor = new Date(request.body.scheduledFor);
      if (scheduleTooSoon(scheduledFor, new Date()))
        return reply.code(422).send({
          message: 'Schedule a campaign at least 15 minutes ahead, so it can still be cancelled'
        });

      const template = await database.query<{ version: number }>(
        `SELECT version FROM email_templates
         WHERE key = $1 AND superseded_at IS NULL
         ORDER BY version DESC LIMIT 1`,
        [campaign.template_key]
      );
      const version = template.rows[0]?.version;
      if (!version)
        return reply
          .code(422)
          .send({ message: `No approved template is published for ${campaign.template_key}` });

      const scheduled = await database.query<CampaignRow>(
        `UPDATE email_campaigns
         SET status = 'scheduled', scheduled_for = $2, template_version = $3
         WHERE id = $1 AND status = 'draft'
         RETURNING id, template_key, template_version, audience, status, send_cap, scheduled_for,
           created_at, '0' AS queued_count, '0' AS sent_count, '0' AS skipped_count`,
        [request.params.campaignId, scheduledFor, version]
      );
      const row = scheduled.rows[0];
      if (!row) return reply.code(409).send({ message: 'Only a draft can be scheduled' });
      await staffAudit(database, accountId, 'campaign.scheduled');
      return summaryFrom(row);
    }
  );

  /**
   * Cancel a campaign, right up until the send finishes. A campaign that has
   * already gone out cannot be recalled, and the route says so rather than
   * pretending: `409` on a `sent` campaign.
   */
  routes.post<{ Params: CampaignParams }>(
    '/v1/staff/campaigns/:campaignId/cancel',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: CampaignParamsSchema,
        response: {
          200: CampaignSummarySchema,
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
      if (!canManageCampaigns(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Campaigns need a campaign manager role' });

      const found = await database.query<{ status: CampaignStatus }>(
        'SELECT status FROM email_campaigns WHERE id = $1',
        [request.params.campaignId]
      );
      const campaign = found.rows[0];
      if (!campaign) return reply.code(404).send({ message: 'Campaign not found' });
      if (!campaignCancellable(campaign.status))
        return reply
          .code(409)
          .send({ message: 'That campaign has already been sent and cannot be recalled' });

      const cancelled = await database.query<CampaignRow>(
        `UPDATE email_campaigns SET status = 'cancelled', cancelled_at = now()
         WHERE id = $1 AND status <> 'sent' AND status <> 'cancelled'
         RETURNING id, template_key, template_version, audience, status, send_cap, scheduled_for,
           created_at, '0' AS queued_count, '0' AS sent_count, '0' AS skipped_count`,
        [request.params.campaignId]
      );
      const row = cancelled.rows[0];
      if (!row)
        return reply.code(409).send({ message: 'That campaign can no longer be cancelled' });
      // Anything still queued is dropped rather than left to a later sweep: a
      // cancelled campaign must not keep sending.
      await database.query(
        `UPDATE email_campaign_recipients SET status = 'skipped', skip_reason = 'campaign_cancelled'
         WHERE campaign_id = $1 AND status = 'queued'`,
        [request.params.campaignId]
      );
      await staffAudit(database, accountId, 'campaign.cancelled');
      return summaryFrom(row);
    }
  );

  /**
   * Publish a template version (milestone 3.10).
   *
   * Publishing new copy *is* the approval, so it is a staff act with the same
   * role as sending. A new version supersedes the live one rather than editing
   * it: a campaign that already went out under version 1 stays readable as
   * version 1 forever, and a scheduled campaign keeps the version it resolved.
   */
  routes.post<{ Body: EmailTemplateCreateRequest }>(
    '/v1/staff/email-templates',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        body: EmailTemplateCreateRequestSchema,
        response: {
          201: EmailTemplateSchema,
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
      if (!canManageCampaigns(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Templates need a campaign manager role' });

      const published = await withTransaction(database, async (client) => {
        // Supersede first, inside the transaction, so the partial unique index
        // on "one live version per key" is never briefly violated.
        await client.query(
          `UPDATE email_templates SET superseded_at = now()
           WHERE key = $1 AND superseded_at IS NULL`,
          [request.body.key]
        );
        const created = await client.query<{
          key: string;
          version: number;
          subject: string;
          body: string;
          created_at: Date;
        }>(
          `INSERT INTO email_templates (key, version, subject, body, created_by_account_id)
           VALUES (
             $1,
             coalesce((SELECT max(version) FROM email_templates WHERE key = $1), 0) + 1,
             $2, $3, $4
           )
           RETURNING key, version, subject, body, created_at`,
          [request.body.key, request.body.subject, request.body.body, accountId]
        );
        return created.rows[0]!;
      });
      await staffAudit(database, accountId, 'campaign.template_published');
      const template: EmailTemplate = {
        key: published.key,
        version: published.version,
        subject: published.subject,
        body: published.body,
        live: true,
        createdAt: published.created_at.toISOString()
      };
      return reply.code(201).send(template);
    }
  );

  /** Every template version, newest first, with which one is live. */
  routes.get(
    '/v1/staff/email-templates',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: EmailTemplateListResponseSchema,
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
      if (!canManageCampaigns(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Templates need a campaign manager role' });

      const templates = await database.query<{
        key: string;
        version: number;
        subject: string;
        body: string;
        superseded_at: Date | null;
        created_at: Date;
      }>(
        `SELECT key, version, subject, body, superseded_at, created_at
         FROM email_templates
         ORDER BY key, version DESC
         LIMIT 200`
      );
      return {
        data: templates.rows.map((row) => ({
          key: row.key,
          version: row.version,
          subject: row.subject,
          body: row.body,
          live: row.superseded_at === null,
          createdAt: row.created_at.toISOString()
        }))
      };
    }
  );

  /**
   * The account's own unsubscribe link, issued once and stable afterwards, so
   * every email can carry the same one and it keeps working after the campaign
   * is over. Returned only to the signed-in owner; the stored form is a hash.
   */
  routes.post(
    '/v1/email/unsubscribe-link',
    {
      schema: {
        tags: ['campaigns'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: UnsubscribeResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const token = randomBytes(32).toString('hex');
      const stored = await database.query<{ existing: boolean }>(
        `INSERT INTO email_unsubscribe_tokens (account_id, token_hash)
         VALUES ($1, $2)
         ON CONFLICT (account_id) DO NOTHING
         RETURNING true AS existing`,
        [accountId, createHash('sha256').update(token).digest('hex')]
      );
      // An account that already has a token keeps it: reissuing would break
      // the link in every email already sent.
      const response: UnsubscribeResponse = {
        message: stored.rows[0]
          ? token
          : 'An unsubscribe link already exists for this account and is still valid.'
      };
      return response;
    }
  );
};
