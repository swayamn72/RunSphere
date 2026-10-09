import type { FastifyInstance } from 'fastify';
import { ErrorResponseSchema, StaffReviewAuthorizationHeadersSchema, StaffReviewQueueResponseSchema } from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { requireAccount } from './auth-routes.js';
import { validationErrors, type ActivityState } from './activity-routes.js';

export interface StaffRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
  config: { staffReviewAccountIds: readonly string[] };
}

export const registerStaffRoutes = ({ routes, database, authSecret, config }: StaffRouteDeps) => {
  routes.get(
    '/v1/staff/activity-review-queue',
    {
      schema: {
        tags: ['staff'],
        headers: StaffReviewAuthorizationHeadersSchema,
        response: {
          200: StaffReviewQueueResponseSchema,
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
      if (!config.staffReviewAccountIds.includes(accountId))
        return reply.code(403).send({ message: 'Staff access required' });
      const queue = await database.query<{
        id: string;
        status: Exclude<ActivityState, 'deleted'>;
        created_at: Date;
        rejection_reason: string | null;
        validation_errors: unknown;
      }>(
        `SELECT id, status, created_at, rejection_reason, validation_errors
         FROM activity_submissions
         WHERE deleted_at IS NULL AND status IN ('received', 'validating', 'rejected')
         ORDER BY created_at ASC LIMIT 100`
      );
      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, $2, $3, $4)`,
        [accountId, 'staff.activity_review_queue.read', 'activity_submission', queue.rows.length]
      );
      return {
        data: queue.rows.map((item) => ({
          id: item.id,
          status: item.status,
          submittedAt: item.created_at.toISOString(),
          ...(item.rejection_reason ? { rejectionReason: item.rejection_reason } : {}),
          validationErrors: validationErrors(item.validation_errors)
        }))
      };
    }
  );
};
