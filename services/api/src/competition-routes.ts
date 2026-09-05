import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  CompetitionCreateRequestSchema,
  CompetitionEnrollmentRequestSchema,
  CompetitionListResponseSchema,
  CompetitionParamsSchema,
  CompetitionStandingsResponseSchema,
  CompetitionSummarySchema,
  ErrorResponseSchema,
  type CompetitionCreateRequest,
  type CompetitionEnrollmentRequest,
  type CompetitionParams,
  type CompetitionStanding,
  type CompetitionStandingsResponse,
  type CompetitionStatus,
  type CompetitionSummary,
  type Profile
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  canOperateCompetitions,
  challengeModeScore,
  challengeWindow,
  competitionDisputeEndsAt,
  competitionEligible,
  competitionEnrollmentOpen,
  competitionRanking,
  competitionResultsProvisional,
  parseChallengeRule,
  type ChallengeRule
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';
import { notSharingSuspended, requireSharingAllowed } from './sanction-guard.js';

/**
 * Scheduled competitions (Phase 3, milestone 3.6).
 *
 * The most formal contest in the product, and the only one an ordinary member
 * cannot create: staff schedule it, everyone enters themselves. Everything a
 * participant needs in order to decide — mode, window, eligibility, rewards,
 * and how long results stay provisional — is published before they enter, and
 * none of it moves afterwards (`gameplay.md`).
 *
 * Nothing in this file reads or returns location, route, pace, distance, or
 * activity detail. A participant is a `Profile`, a rank, and a score.
 */
export interface CompetitionRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const DEFAULT_COSMETIC: Profile['cosmetic'] = { avatarKey: 'default' };
const DEFAULT_DISPUTE_PERIOD_HOURS = 48;

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

const audit = (
  database: Database,
  accountId: string,
  eventType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {}
): Promise<{ rows: unknown[] }> =>
  database.query(
    `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type,
       resource_id, metadata)
     VALUES ($1, $1, $2, 'competition', $3, $4)`,
    [accountId, eventType, resourceId, JSON.stringify(metadata)]
  );

/** Whether the caller may schedule and run competitions. */
const operatorRoles = async (database: Database, accountId: string): Promise<string[]> => {
  const result = await database.query<{ role: string }>(
    'SELECT role FROM staff_role_assignments WHERE account_id = $1',
    [accountId]
  );
  return result.rows.map((row) => row.role);
};

interface CompetitionRow {
  id: string;
  title: string;
  mode: 'active_minutes' | 'active_days';
  status: CompetitionStatus;
  period_start: Date | string;
  period_end: Date | string;
  min_prior_active_weeks: number;
  rewards: string;
  dispute_period_hours: number;
  rule_version: number;
  created_at: Date;
  closed_at: Date | null;
}

interface CompetitionCountRow {
  participant_count: string;
  enrolled: boolean | null;
}

const asDateString = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

const summaryFrom = (
  row: CompetitionRow,
  counts: { participantCount: number; enrolled: boolean },
  eligible: boolean
): CompetitionSummary => {
  const disputeEndsAt = competitionDisputeEndsAt(
    row.closed_at ?? undefined,
    row.dispute_period_hours
  );
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    periodStart: asDateString(row.period_start),
    periodEnd: asDateString(row.period_end),
    minPriorActiveWeeks: row.min_prior_active_weeks,
    rewards: row.rewards,
    disputePeriodHours: row.dispute_period_hours,
    ...(disputeEndsAt ? { disputeEndsAt: disputeEndsAt.toISOString() } : {}),
    participantCount: counts.participantCount,
    enrolled: counts.enrolled,
    eligible,
    ruleVersion: row.rule_version,
    createdAt: row.created_at.toISOString()
  };
};

const COMPETITION_COLUMNS = `id, title, mode, status, period_start, period_end,
  min_prior_active_weeks, rewards, dispute_period_hours, rule_version, created_at, closed_at`;

const loadCompetition = async (
  database: Database,
  competitionId: string
): Promise<CompetitionRow | undefined> => {
  const result = await database.query<CompetitionRow>(
    `SELECT ${COMPETITION_COLUMNS} FROM competitions WHERE id = $1`,
    [competitionId]
  );
  return result.rows[0];
};

const enrollmentCounts = async (
  database: Database,
  competitionId: string,
  accountId: string
): Promise<{ participantCount: number; enrolled: boolean }> => {
  const result = await database.query<CompetitionCountRow>(
    `SELECT count(*) FILTER (WHERE withdrawn_at IS NULL)::text AS participant_count,
       bool_or(account_id = $2 AND withdrawn_at IS NULL) AS enrolled
     FROM competition_enrollments WHERE competition_id = $1`,
    [competitionId, accountId]
  );
  const row = result.rows[0];
  return {
    participantCount: Number(row?.participant_count ?? 0),
    enrolled: Boolean(row?.enrolled)
  };
};

/**
 * How many earlier Kolkata weeks this account was active in — the only input
 * to published eligibility. A count of weeks, never a score, a pace, or a
 * place, and the same band the global board's divisions use.
 */
const priorActiveWeeks = async (database: Database, accountId: string): Promise<number> => {
  const result = await database.query<{ weeks: string }>(
    `SELECT count(DISTINCT date_trunc('week', processed_at AT TIME ZONE 'Asia/Kolkata'))::text
       AS weeks
     FROM activity_submissions
     WHERE account_id = $1 AND status = 'derived' AND deleted_at IS NULL`,
    [accountId]
  );
  return Number(result.rows[0]?.weeks ?? 0);
};

const loadCompetitionRule = async (
  database: Database,
  version: number
): Promise<ChallengeRule | undefined> => {
  const result = await database.query<{ definition: unknown }>(
    `SELECT definition FROM rule_versions WHERE kind = 'competition' AND version = $1`,
    [version]
  );
  const row = result.rows[0];
  return row ? parseChallengeRule(row.definition) : undefined;
};

const loadActiveCompetitionRule = async (
  database: Database
): Promise<{ version: number; rule: ChallengeRule } | undefined> => {
  const result = await database.query<{ version: number; definition: unknown }>(
    `SELECT version, definition FROM rule_versions
     WHERE kind = 'competition' AND superseded_at IS NULL
     ORDER BY version DESC LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return { version: row.version, rule: parseChallengeRule(row.definition) };
};

export const registerCompetitionRoutes = ({
  routes,
  database,
  authSecret
}: CompetitionRouteDeps): void => {
  /**
   * Everything that has been announced, newest first. A draft is staff-only
   * and never appears here; a cancelled event does, because an event that was
   * announced and then called off is a fact participants are owed rather than
   * something to quietly remove.
   */
  routes.get(
    '/v1/competitions',
    {
      schema: {
        tags: ['competitions'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: CompetitionListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const competitions = await database.query<CompetitionRow & CompetitionCountRow>(
        `SELECT competition.id, competition.title, competition.mode, competition.status,
           competition.period_start, competition.period_end, competition.min_prior_active_weeks,
           competition.rewards, competition.dispute_period_hours, competition.rule_version,
           competition.created_at, competition.closed_at,
           count(enrollment.account_id) FILTER (WHERE enrollment.withdrawn_at IS NULL)::text
             AS participant_count,
           bool_or(enrollment.account_id = $1 AND enrollment.withdrawn_at IS NULL) AS enrolled
         FROM competitions competition
         LEFT JOIN competition_enrollments enrollment
           ON enrollment.competition_id = competition.id
         WHERE competition.status <> 'draft'
         GROUP BY competition.id
         ORDER BY competition.period_start DESC, competition.created_at DESC
         LIMIT 50`,
        [accountId]
      );
      if (!competitions.rows.length) return { data: [] };

      // One history read for the whole list: eligibility is a property of the
      // account, and every published band is measured against the same number.
      const weeks = await priorActiveWeeks(database, accountId);
      return {
        data: competitions.rows.map((row) =>
          summaryFrom(
            row,
            {
              participantCount: Number(row.participant_count),
              enrolled: Boolean(row.enrolled)
            },
            competitionEligible(weeks, row.min_prior_active_weeks)
          )
        )
      };
    }
  );

  /**
   * Enter or leave one competition.
   *
   * Entering publishes your score for the whole window, including any days of
   * it that have already passed, because every participant is scored over the
   * same days. Eligibility is checked here rather than only in the UI, and a
   * `403` says which band was missed rather than pretending the event does not
   * exist — it was announced to this account, so hiding the reason would only
   * be confusing.
   *
   * Withdrawing is not a delete: the row records that you entered and left,
   * and from that moment you are neither scored nor shown.
   */
  routes.put<{ Params: CompetitionParams; Body: CompetitionEnrollmentRequest }>(
    '/v1/competitions/:competitionId/enrollment',
    {
      schema: {
        tags: ['competitions'],
        headers: ActivityAuthorizationHeadersSchema,
        params: CompetitionParamsSchema,
        body: CompetitionEnrollmentRequestSchema,
        response: {
          200: CompetitionSummarySchema,
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

      const competition = await loadCompetition(database, request.params.competitionId);
      // A draft has not been announced, so to everyone but its author it does
      // not exist yet.
      if (!competition || competition.status === 'draft')
        return reply.code(404).send({ message: 'Competition not found' });
      if (!competitionEnrollmentOpen(competition.status))
        return reply.code(409).send({ message: 'That competition is not open for entry' });

      const weeks = await priorActiveWeeks(database, accountId);
      const eligible = competitionEligible(weeks, competition.min_prior_active_weeks);
      if (request.body.enrolled && !eligible)
        return reply.code(403).send({
          message: `This competition is for accounts with at least ${competition.min_prior_active_weeks} earlier active weeks`
        });

      // Entering publishes a score to the other entrants, so a paused account
      // cannot; withdrawing is never guarded.
      if (request.body.enrolled && !(await requireSharingAllowed(database, reply, accountId)))
        return;
      if (request.body.enrolled) {
        await database.query(
          `INSERT INTO competition_enrollments (competition_id, account_id)
           VALUES ($1, $2)
           ON CONFLICT (competition_id, account_id)
           DO UPDATE SET withdrawn_at = NULL, enrolled_at = now()`,
          [competition.id, accountId]
        );
      } else {
        await database.query(
          `UPDATE competition_enrollments SET withdrawn_at = now()
           WHERE competition_id = $1 AND account_id = $2 AND withdrawn_at IS NULL`,
          [competition.id, accountId]
        );
      }
      await audit(
        database,
        accountId,
        request.body.enrolled ? 'competition.entered' : 'competition.withdrawn',
        competition.id
      );
      const counts = await enrollmentCounts(database, competition.id, accountId);
      return summaryFrom(competition, counts, eligible);
    }
  );

  /**
   * The standings of one competition.
   *
   * `enrolled` gates the entry list exactly as every other board's opt-in
   * does. While the window is open the scores are computed live from
   * server-derived validated activity; once it has closed the stored result is
   * read and never recomputed, and `provisional` says out loud that the
   * dispute period is still running, so a result is never presented as final
   * before it is (ADR-0006).
   */
  routes.get<{ Params: CompetitionParams }>(
    '/v1/competitions/:competitionId/standings',
    {
      schema: {
        tags: ['competitions'],
        headers: ActivityAuthorizationHeadersSchema,
        params: CompetitionParamsSchema,
        response: {
          200: CompetitionStandingsResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const competition = await loadCompetition(database, request.params.competitionId);
      if (!competition || competition.status === 'draft')
        return reply.code(404).send({ message: 'Competition not found' });

      const counts = await enrollmentCounts(database, competition.id, accountId);
      const weeks = await priorActiveWeeks(database, accountId);
      const summary = summaryFrom(
        competition,
        counts,
        competitionEligible(weeks, competition.min_prior_active_weeks)
      );
      const live = competition.status === 'open';
      const provisional = competitionResultsProvisional(competition.status);
      if (!counts.enrolled) {
        const response: CompetitionStandingsResponse = {
          competition: summary,
          live,
          provisional,
          entries: []
        };
        return response;
      }

      const participants = await database.query<{
        account_id: string;
        display_name: string | null;
        cosmetic: unknown;
        activity_visibility: 'private' | 'followers';
        blocked_either_way: boolean;
        stored_score: number | null;
        stored_rank: number | null;
      }>(
        `SELECT enrollment.account_id, profile.display_name, profile.cosmetic,
           account.profile_visibility AS activity_visibility,
           EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
             AND ((block.blocker_account_id = $2 AND block.blocked_account_id = enrollment.account_id)
               OR (block.blocker_account_id = enrollment.account_id AND block.blocked_account_id = $2)))
             AS blocked_either_way,
           result.score AS stored_score, result.rank AS stored_rank
         FROM competition_enrollments enrollment
         JOIN accounts account ON account.id = enrollment.account_id
           AND account.deleted_at IS NULL
         LEFT JOIN profiles profile ON profile.account_id = enrollment.account_id
         LEFT JOIN competition_results result
           ON result.competition_id = enrollment.competition_id
           AND result.account_id = enrollment.account_id
         WHERE enrollment.competition_id = $1 AND enrollment.withdrawn_at IS NULL
           AND ${notSharingSuspended('enrollment.account_id')}
         LIMIT 500`,
        [competition.id, accountId]
      );
      // A block hides two accounts from each other here as everywhere else.
      const visible = participants.rows.filter(
        (row) => row.account_id === accountId || !row.blocked_either_way
      );
      const profileOf = (row: (typeof visible)[number]): Profile => ({
        id: row.account_id,
        displayName: row.display_name ?? 'RunSphere member',
        cosmetic: (row.cosmetic as Profile['cosmetic']) ?? DEFAULT_COSMETIC,
        activityVisibility: row.activity_visibility
      });

      if (!live) {
        // Closed, finalized, or cancelled: whatever was stored is what is
        // shown, and a cancelled event simply has nothing stored.
        const entries: CompetitionStanding[] = visible
          .filter((row) => row.stored_score !== null && row.stored_rank !== null)
          .map((row) => ({
            profile: profileOf(row),
            rank: row.stored_rank!,
            score: row.stored_score!,
            isSelf: row.account_id === accountId
          }))
          .sort(
            (left, right) =>
              left.rank - right.rank ||
              left.profile.displayName.localeCompare(right.profile.displayName)
          );
        const response: CompetitionStandingsResponse = {
          competition: summary,
          live,
          provisional,
          entries
        };
        return response;
      }

      const rule = await loadCompetitionRule(database, competition.rule_version);
      if (!rule || !visible.length) {
        const response: CompetitionStandingsResponse = {
          competition: summary,
          live,
          provisional,
          entries: []
        };
        return response;
      }

      const periodStart = asDateString(competition.period_start);
      const lengthDays = Math.round(
        (new Date(`${asDateString(competition.period_end)}T00:00:00.000Z`).getTime() -
          new Date(`${periodStart}T00:00:00.000Z`).getTime()) /
          86_400_000
      );
      const window = challengeWindow(periodStart, lengthDays);
      const activities = await database.query<{
        account_id: string;
        active_duration_seconds: number;
        processed_at: Date;
      }>(
        `SELECT submission.account_id, output.active_duration_seconds, submission.processed_at
         FROM activity_submissions submission
         JOIN activity_validation_outputs output ON output.activity_id = submission.id
         WHERE submission.account_id = ANY($1::uuid[])
           AND submission.status = 'derived'
           AND submission.deleted_at IS NULL
           AND submission.processed_at >= $2
           AND submission.processed_at < $3`,
        [visible.map((row) => row.account_id), window.periodStart, window.periodEnd]
      );
      const byAccount = new Map<string, { activeDurationSeconds: number; endedAt: Date }[]>();
      for (const row of activities.rows) {
        const bucket = byAccount.get(row.account_id) ?? [];
        bucket.push({
          activeDurationSeconds: row.active_duration_seconds,
          endedAt: row.processed_at
        });
        byAccount.set(row.account_id, bucket);
      }

      const scored = visible
        .map((row) => ({
          row,
          score: challengeModeScore(
            competition.mode,
            window,
            byAccount.get(row.account_id) ?? [],
            // No quest completion is recorded anywhere, which is why no rule
            // enables that mode and this list is never the scoring input.
            [],
            rule.dailyCapMinutes,
            rule.minMinutesPerActiveDay
          )
        }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            (left.row.display_name ?? '').localeCompare(right.row.display_name ?? '') ||
            left.row.account_id.localeCompare(right.row.account_id)
        );
      const ranks = competitionRanking(scored.map((entry) => entry.score));
      const response: CompetitionStandingsResponse = {
        competition: summary,
        live,
        provisional,
        entries: scored.map((entry, index) => ({
          profile: profileOf(entry.row),
          rank: ranks[index]!,
          score: entry.score,
          isSelf: entry.row.account_id === accountId
        }))
      };
      return response;
    }
  );

  /**
   * Schedule a competition. Staff work: `season_operator` or `admin`.
   *
   * It is created as a **draft**. An announcement is a commitment — people
   * arrange their weeks around it — so publishing is a second, deliberate act
   * rather than a side effect of typing a title.
   */
  routes.post<{ Body: CompetitionCreateRequest }>(
    '/v1/staff/competitions',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        body: CompetitionCreateRequestSchema,
        response: {
          201: CompetitionSummarySchema,
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
      const roles = await operatorRoles(database, accountId);
      if (!canOperateCompetitions(roles))
        return reply.code(403).send({ message: 'Scheduling a competition needs a staff role' });

      const published = await loadActiveCompetitionRule(database);
      // A `422` rather than a `400`: the request is well-formed, the published
      // rule simply does not allow it — or none is published here at all.
      if (!published) return reply.code(422).send({ message: 'No competition rule is published' });
      if (!published.rule.modes.includes(request.body.mode))
        return reply.code(422).send({ message: `Mode ${request.body.mode} is not enabled` });
      if (!published.rule.lengthDays.includes(request.body.lengthDays))
        return reply.code(422).send({
          message: `A competition must run ${published.rule.lengthDays.join(', ')} days`
        });

      const created = await database.query<CompetitionRow>(
        `INSERT INTO competitions (title, mode, period_start, period_end, min_prior_active_weeks,
           rewards, dispute_period_hours, rule_version, created_by_account_id)
         VALUES ($1, $2, $3::date, $3::date + $4, $5, $6, $7, $8, $9)
         RETURNING ${COMPETITION_COLUMNS}`,
        [
          request.body.title.trim(),
          request.body.mode,
          request.body.periodStart,
          request.body.lengthDays,
          request.body.minPriorActiveWeeks ?? 0,
          request.body.rewards ?? '',
          request.body.disputePeriodHours ?? DEFAULT_DISPUTE_PERIOD_HOURS,
          published.version,
          accountId
        ]
      );
      const row = created.rows[0]!;
      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, 'competition.drafted', 'competition', 1)`,
        [accountId]
      );
      return reply.code(201).send(summaryFrom(row, { participantCount: 0, enrolled: false }, true));
    }
  );

  /**
   * Announce a drafted competition, or call an announced one off.
   *
   * Publishing is one-way: a competition that people have been told about and
   * may already have entered cannot slip back into a draft. Cancelling is
   * available right up to the close, and it writes no result, so nobody is
   * ever ranked in an event that was called off.
   */
  routes.post<{ Params: CompetitionParams; Body: { publish: boolean } }>(
    '/v1/staff/competitions/:competitionId/status',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: CompetitionParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['publish'],
          properties: { publish: { type: 'boolean' } }
        },
        response: {
          200: CompetitionSummarySchema,
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
      const roles = await operatorRoles(database, accountId);
      if (!canOperateCompetitions(roles))
        return reply.code(403).send({ message: 'Running a competition needs a staff role' });

      const changed = request.body.publish
        ? await database.query<CompetitionRow>(
            `UPDATE competitions SET status = 'published', published_at = now()
             WHERE id = $1 AND status = 'draft'
             RETURNING ${COMPETITION_COLUMNS}`,
            [request.params.competitionId]
          )
        : await database.query<CompetitionRow>(
            `UPDATE competitions SET status = 'cancelled', cancelled_at = now()
             WHERE id = $1 AND status IN ('draft', 'published', 'open')
             RETURNING ${COMPETITION_COLUMNS}`,
            [request.params.competitionId]
          );
      const row = changed.rows[0];
      if (!row) {
        const existing = await loadCompetition(database, request.params.competitionId);
        return existing
          ? reply.code(409).send({ message: 'That competition is not in a state for that change' })
          : reply.code(404).send({ message: 'Competition not found' });
      }
      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, $2, 'competition', 1)`,
        [accountId, request.body.publish ? 'competition.published' : 'competition.cancelled']
      );
      const counts = await enrollmentCounts(database, row.id, accountId);
      return summaryFrom(row, counts, true);
    }
  );
};
