import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ErrorResponseSchema } from '@runsphere/contracts';
import type { Database } from '@runsphere/db';

/**
 * The email provider's bounce and complaint webhook (`gameplay.md`: "provider
 * authentication, signed webhook handling").
 *
 * `email_suppressions` has existed since `011` and nothing has ever written to
 * it, because nothing was sending. That is not a cosmetic gap: a sender that
 * ignores bounces loses its domain reputation, and a domain with a bad
 * reputation stops delivering **password resets** — so the people it fails are
 * the ones locked out of their accounts. Consuming these events is part of
 * email working, not a refinement to add later.
 *
 * **This is the only unauthenticated write in the product**, so it is narrow on
 * purpose:
 *
 *   * It refuses everything unless the request carries a valid HMAC over the
 *     exact bytes received.
 *   * It accepts three event types and ignores every other field.
 *   * It can add an address to the suppression list and nothing else. It cannot
 *     read an account, change a preference, or remove a suppression.
 *   * It answers 204 to a duplicate rather than an error, because providers
 *     redeliver and a retry storm is worse than a no-op.
 */
export interface EmailWebhookRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  /** Shared secret from the provider console. Absent disables the route. */
  webhookSecret: string | undefined;
}

const EmailWebhookBodySchema = {
  type: 'object',
  required: ['id', 'type', 'email'],
  additionalProperties: true,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    type: { type: 'string', enum: ['bounce', 'complaint', 'delivered'] },
    email: { type: 'string', minLength: 3, maxLength: 320 },
    /** Providers distinguish a dead address from a full mailbox. */
    permanent: { type: 'boolean' }
  }
} as const;

interface EmailWebhookBody {
  id: string;
  type: 'bounce' | 'complaint' | 'delivered';
  email: string;
  permanent?: boolean;
}

/**
 * Compared over the raw body, not over a re-serialised object.
 *
 * A signature is over bytes. Verifying it against `JSON.stringify(parsed)`
 * would pass for a forged payload whose key order or whitespace happened to
 * round-trip, and fail for an honest one whose did not.
 */
export const verifyWebhookSignature = (
  rawBody: string,
  signature: string | undefined,
  secret: string
): boolean => {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
  } catch {
    return false;
  }
  // Length is checked first because `timingSafeEqual` throws on a mismatch,
  // and a thrown comparison is a timing signal of its own.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
};

/** Where the parser below stashes the bytes for the handler above it. */
const rawBodies = new WeakMap<object, string>();

export const registerEmailWebhookRoutes = ({
  routes,
  database,
  webhookSecret
}: EmailWebhookRouteDeps): void => {
  /**
   * An encapsulated scope with its own JSON parser.
   *
   * The signature is over the bytes as sent, and Fastify has parsed and
   * discarded them by the time a handler runs. Rather than add a raw-body
   * plugin for one route, this scope keeps its own parser — and because Fastify
   * encapsulates it, every other route in the product keeps the default one.
   */
  void routes.register((scope, _options, done) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (request, body: string, next) => {
        rawBodies.set(request, body);
        try {
          next(null, JSON.parse(body));
        } catch {
          next(new Error('Invalid JSON'), undefined);
        }
      }
    );

    scope.post<{ Body: EmailWebhookBody }>(
      '/v1/email/provider-events',
      {
        schema: {
          tags: ['email'],
          body: EmailWebhookBodySchema,
          response: {
            204: { type: 'null' },
            401: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database || !webhookSecret)
          return reply.code(503).send({ message: 'Service unavailable' });

        // The bytes as received. Falling back to a re-serialisation would let a
        // forged payload pass whenever its key order happened to round-trip, so
        // a missing raw body is a refusal instead.
        const raw = rawBodies.get(request);
        if (raw === undefined) return reply.code(401).send({ message: 'Unauthorized' });
        const signature = request.headers['x-webhook-signature'];
        if (
          !verifyWebhookSignature(
            raw,
            typeof signature === 'string' ? signature : undefined,
            webhookSecret
          )
        ) {
          // No detail: an unsigned caller learns nothing about why.
          return reply.code(401).send({ message: 'Unauthorized' });
        }

        const { id, type, email, permanent } = request.body;

        // Recorded first, and by the provider's own event id, so a redelivery is
        // not counted twice. The address is hashed here — the suppression list
        // below needs it in the clear to be checked against, this audit row does
        // not.
        const accepted = await database.query<{ id: string }>(
          `INSERT INTO email_provider_events (provider_event_id, event_type, email_hash)
           VALUES ($1, $2, encode(digest(lower($3), 'sha256'), 'hex'))
           ON CONFLICT (provider_event_id) DO NOTHING
           RETURNING id`,
          [id, type, email]
        );
        if (!accepted.rows[0]) return reply.code(204).send();

        // A complaint always suppresses: somebody pressed "this is spam", and
        // continuing to write to them is both rude and ruinous for the domain.
        // A bounce suppresses only when the provider calls it permanent — a full
        // mailbox or a temporary outage is not a dead address, and suppressing on
        // one would lock somebody out of their own password reset.
        if (type === 'complaint' || (type === 'bounce' && permanent === true)) {
          await database.query(
            `INSERT INTO email_suppressions (email, reason) VALUES (lower($1), $2)
             ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason,
               suppressed_at = now(), unsuppressed_at = NULL`,
            [email, type === 'complaint' ? 'complaint' : 'bounce']
          );
        }

        return reply.code(204).send();
      }
    );

    done();
  });
};
