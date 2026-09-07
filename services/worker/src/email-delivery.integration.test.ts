import { createHash, randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareTransactional, unsubscribeUrlFor } from './email-delivery.js';

/**
 * Token rotation against a real PostGIS.
 *
 * Every one of these is an `UPDATE ... RETURNING` with a `WHERE` that has to
 * match exactly one row. A fake database returns whatever the test says, so it
 * would pass identically whether the statement matched the right row, the wrong
 * row, or none — and "none" is the failure mode that matters, because it looks
 * like a token that simply never arrived.
 *
 * The other thing only a real database can check: that the digest this worker
 * computes in Node is byte-identical to the one the API's verification queries
 * compute in SQL. If it were not, every link in every email would be rejected.
 *
 * Enable with `RUN_POSTGIS_INTEGRATION=1` and a `DATABASE_URL`.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));

let account = '';
let accountEmail = '';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

beforeAll(async () => {
  if (!enabled) return;
  await migrate(db);
  accountEmail = `email-${randomUUID()}@example.test`;
  const created = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
     VALUES ($1, 'x', now(), '2026-01') RETURNING id`,
    [accountEmail]
  );
  account = created.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  if (account) await db.query('DELETE FROM accounts WHERE id = $1', [account]);
  await db.end();
});

beforeEach(async () => {
  if (!enabled) return;
  await db.query('DELETE FROM password_reset_tokens WHERE account_id = $1', [account]);
  await db.query('DELETE FROM email_verification_tokens WHERE account_id = $1', [account]);
  await db.query('DELETE FROM email_change_requests WHERE account_id = $1', [account]);
  await db.query('DELETE FROM email_unsubscribe_tokens WHERE account_id = $1', [account]);
});

describePostgis('transactional token rotation on real PostGIS', () => {
  describe('password reset', () => {
    const insert = async (options: { expired?: boolean; consumed?: boolean } = {}) => {
      const created = await db.query<{ id: string }>(
        `INSERT INTO password_reset_tokens (account_id, token_hash, expires_at, consumed_at)
         VALUES ($1, $2, now() + ($3 || ' hours')::interval, $4)
         RETURNING id`,
        [
          account,
          sha256(randomUUID()),
          options.expired ? '-1' : '1',
          options.consumed ? new Date() : null
        ]
      );
      return created.rows[0]!.id;
    };

    it('rotates the hash and resolves the account address', async () => {
      const id = await insert();

      const prepared = await prepareTransactional(db, 'password_reset', id);

      expect(prepared?.to).toBe(accountEmail);
      expect(prepared?.secret).toBeDefined();
      // The stored hash is the digest of the secret that went into the email,
      // computed in Node. If these disagreed the link would never validate.
      const stored = await db.query<{ token_hash: string }>(
        'SELECT token_hash FROM password_reset_tokens WHERE id = $1',
        [id]
      );
      expect(stored.rows[0]!.token_hash).toBe(sha256(prepared!.secret!));
    });

    it('produces a digest PostgreSQL agrees with', async () => {
      const id = await insert();
      const prepared = await prepareTransactional(db, 'password_reset', id);

      // The API verifies by hashing in SQL. Both sides must produce the same
      // 64 lowercase hex characters or no token in the product would work.
      const matched = await db.query<{ id: string }>(
        `SELECT id FROM password_reset_tokens
         WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
        [prepared!.secret!]
      );
      expect(matched.rows.map((row) => row.id)).toEqual([id]);
    });

    it('refuses a token that is already consumed', async () => {
      const id = await insert({ consumed: true });

      expect(await prepareTransactional(db, 'password_reset', id)).toBeUndefined();
    });

    it('refuses a token that has expired', async () => {
      const id = await insert({ expired: true });

      expect(await prepareTransactional(db, 'password_reset', id)).toBeUndefined();
    });

    it('refuses a row that is not there', async () => {
      expect(await prepareTransactional(db, 'password_reset', randomUUID())).toBeUndefined();
    });

    it('refuses to write to a deleted account', async () => {
      const id = await insert();
      await db.query('UPDATE accounts SET deleted_at = now() WHERE id = $1', [account]);
      try {
        // Nobody to write to. The `RETURNING` subquery is what makes this
        // one statement rather than a read the row could change under.
        expect(await prepareTransactional(db, 'password_reset', id)).toBeUndefined();
      } finally {
        await db.query('UPDATE accounts SET deleted_at = NULL WHERE id = $1', [account]);
      }
    });
  });

  describe('email verification', () => {
    it('rotates and resolves, and refuses a consumed token', async () => {
      const created = await db.query<{ id: string }>(
        `INSERT INTO email_verification_tokens (account_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '24 hours') RETURNING id`,
        [account, sha256(randomUUID())]
      );
      const id = created.rows[0]!.id;

      const prepared = await prepareTransactional(db, 'email_verification', id);
      expect(prepared?.to).toBe(accountEmail);

      await db.query('UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1', [
        id
      ]);
      expect(await prepareTransactional(db, 'email_verification', id)).toBeUndefined();
    });

    it('has a producer, which `014` never gave it', async () => {
      // `039` added the trigger. Without it these rows were written from `010`
      // onward with nothing to carry them anywhere.
      await db.query('DELETE FROM outbox_events WHERE topic = $1', ['email.transactional']);
      await db.query(
        `INSERT INTO email_verification_tokens (account_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '24 hours')`,
        [account, sha256(randomUUID())]
      );

      const queued = await db.query<{ payload: { kind: string } }>(
        `SELECT payload FROM outbox_events WHERE topic = 'email.transactional'`
      );
      expect(queued.rows.map((row) => row.payload.kind)).toEqual(['email_verification']);
    });
  });

  describe('email change', () => {
    const request = async () => {
      const created = await db.query<{ id: string }>(
        `INSERT INTO email_change_requests (account_id, old_email, new_email, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '24 hours') RETURNING id`,
        [account, accountEmail, `new-${randomUUID()}@example.test`, sha256(randomUUID())]
      );
      return created.rows[0]!.id;
    };

    it('sends the verification to the new address', async () => {
      const id = await request();

      const prepared = await prepareTransactional(db, 'change_verify', id);

      expect(prepared?.to).toMatch(/^new-/);
      expect(prepared?.secret).toBeDefined();
    });

    it('sends the alert to the old address, with no token minted', async () => {
      const id = await request();
      const before = await db.query<{ token_hash: string }>(
        'SELECT token_hash FROM email_change_requests WHERE id = $1',
        [id]
      );

      const prepared = await prepareTransactional(db, 'change_alert_old', id);

      expect(prepared?.to).toBe(accountEmail);
      expect(prepared?.secret).toBeUndefined();
      expect(prepared?.newEmail).toMatch(/^new-/);
      // A message with no link needs no secret, so nothing was rotated — which
      // also means the alert cannot invalidate the verification sent alongside.
      const after = await db.query<{ token_hash: string }>(
        'SELECT token_hash FROM email_change_requests WHERE id = $1',
        [id]
      );
      expect(after.rows[0]!.token_hash).toBe(before.rows[0]!.token_hash);
    });

    it('refuses a request that is no longer pending', async () => {
      const id = await request();
      await db.query("UPDATE email_change_requests SET status = 'cancelled' WHERE id = $1", [id]);

      expect(await prepareTransactional(db, 'change_verify', id)).toBeUndefined();
    });

    it('still describes a cancelled request for the alert', async () => {
      // The old address is told a move was *attempted*, and whether it was
      // later cancelled does not change that it happened.
      const id = await request();
      await db.query("UPDATE email_change_requests SET status = 'cancelled' WHERE id = $1", [id]);

      expect((await prepareTransactional(db, 'change_alert_old', id))?.to).toBe(accountEmail);
    });
  });

  describe('the unsubscribe link', () => {
    it('mints one token per account and does not rotate it afterwards', async () => {
      const first = await unsubscribeUrlFor(db, account, 'https://runsphere.test');

      expect(first).toContain('/unsubscribe?token=');
      const secret = /token=(.+)$/.exec(first!)?.[1];
      const stored = await db.query<{ token_hash: string }>(
        'SELECT token_hash FROM email_unsubscribe_tokens WHERE account_id = $1',
        [account]
      );
      expect(stored.rows[0]!.token_hash).toBe(sha256(secret!));

      // A second send must not rotate it: links in mail already delivered have
      // to keep working (`027`).
      const second = await unsubscribeUrlFor(db, account, 'https://runsphere.test');
      expect(second).toBeUndefined();
      const unchanged = await db.query<{ token_hash: string }>(
        'SELECT token_hash FROM email_unsubscribe_tokens WHERE account_id = $1',
        [account]
      );
      expect(unchanged.rows[0]!.token_hash).toBe(stored.rows[0]!.token_hash);
    });

    it('produces a link the API can verify', async () => {
      const url = await unsubscribeUrlFor(db, account, 'https://runsphere.test/');
      const secret = /token=(.+)$/.exec(url!)?.[1];

      const matched = await db.query<{ account_id: string }>(
        `SELECT account_id FROM email_unsubscribe_tokens
         WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
        [secret!]
      );
      expect(matched.rows.map((row) => row.account_id)).toEqual([account]);
      // No double slash from a base that ended in one.
      expect(url).not.toContain('test//unsubscribe');
    });
  });
});

/**
 * A gated suite that quietly does not run is a green tick that means nothing.
 * This is the one test in the file that always runs, and in CI it fails if the
 * rest were skipped.
 */
describe('the PostGIS gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
