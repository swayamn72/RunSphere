import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  LegalConsentRequestSchema,
  LegalConsentStatusSchema,
  type LegalConsentStatus
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { LEGAL_POLICY_VERSION } from '@runsphere/domain';
import { requireAccount } from './auth-routes.js';

/**
 * Agreeing to updated legal text (M9 9.26).
 *
 * Sign-up records the version the runner saw as an `age_assertion` consent;
 * agreeing to a later version adds a `legal_policy` row. Both live in
 * `consent_history`, which is append-only, so the record always says which
 * text a runner agreed to and when. The latest row decides.
 */
const CONSENT_TYPES = ['age_assertion', 'legal_policy'];

export const legalConsentStatus = async (
  database: Pick<Database, 'query'>,
  accountId: string
): Promise<LegalConsentStatus> => {
  const latest = await database.query<{ policy_version: string }>(
    `SELECT policy_version FROM consent_history
     WHERE account_id = $1 AND granted AND consent_type = ANY($2::text[])
     ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [accountId, CONSENT_TYPES]
  );
  const acceptedVersion = latest.rows[0]?.policy_version ?? null;
  return {
    currentVersion: LEGAL_POLICY_VERSION,
    acceptedVersion,
    needsAcceptance: acceptedVersion !== LEGAL_POLICY_VERSION
  };
};

export const registerLegalConsentRoutes = ({
  routes,
  database,
  authSecret
}: {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}): void => {
  routes.get(
    '/v1/legal/consent',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: LegalConsentStatusSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      return legalConsentStatus(database, accountId);
    }
  );

  routes.post<{ Body: { policyVersion: string } }>(
    '/v1/legal/consent',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        body: LegalConsentRequestSchema,
        response: {
          200: LegalConsentStatusSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      // Agreeing to text that is no longer in force would record consent to
      // something the runner wasn't shown; the app reloads and asks again.
      if (request.body.policyVersion !== LEGAL_POLICY_VERSION)
        return reply.code(409).send({ message: 'The terms changed again. Have another look.' });
      const status = await legalConsentStatus(database, accountId);
      if (status.needsAcceptance)
        await database.query(
          `INSERT INTO consent_history (account_id, consent_type, granted, policy_version)
           VALUES ($1, 'legal_policy', true, $2)`,
          [accountId, LEGAL_POLICY_VERSION]
        );
      return legalConsentStatus(database, accountId);
    }
  );
};
