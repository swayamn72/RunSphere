import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * The friend board against a real PostGIS.
 *
 * Making the board automatic (product decision 2026-09-06; `gameplay.md`)
 * dropped a `JOIN leaderboard_opt_ins` and moved the suspension predicate from
 * that JOIN's `ON` into a `WHERE`. A fake database returns whatever a test says
 * and would pass identically whether the rewritten query selects the right
 * rows, the wrong rows, or fails to parse — and the exclusions it carries are
 * the ones that matter: a block, a suspension, a one-sided friendship.
 *
 * Enable with `RUN_POSTGIS_INTEGRATION=1` and a `DATABASE_URL`.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const SECRET = 'friend-standings-integration-secret';
const app = buildApp({ db, authSecret: SECRET });

let me = '';
let ravi = '';
let stranger = '';

const makeAccount = async (displayName: string): Promise<string> => {
  const created = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
     VALUES ($1, 'x', now(), '2026-01') RETURNING id`,
    [`friends-${randomUUID()}@example.test`]
  );
  const id = created.rows[0]!.id;
  await db.query(
    `INSERT INTO profiles (account_id, display_name, cosmetic)
     VALUES ($1, $2, '{"avatarKey":"orbit-01"}'::jsonb)
     ON CONFLICT (account_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [id, displayName]
  );
  return id;
};

const befriend = async (left: string, right: string, mutual = true): Promise<void> => {
  await db.query(
    `INSERT INTO friendships (account_id, friend_account_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [left, right]
  );
  if (mutual)
    await db.query(
      `INSERT INTO friendships (account_id, friend_account_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [right, left]
    );
};

const read = (accountId: string) =>
  app.inject({
    method: 'GET',
    url: '/v1/friends/standings',
    headers: { authorization: `Bearer ${createAccessToken(accountId, SECRET)}` }
  });

const names = (body: { entries: { profile: { displayName: string } }[] }): string[] =>
  body.entries.map((entry) => entry.profile.displayName).sort();

beforeAll(async () => {
  if (!enabled) return;
  await migrate(db);
  me = await makeAccount('Maya');
  ravi = await makeAccount('Ravi');
  stranger = await makeAccount('Nobody');
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  await app.close();
  if (me) await db.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [[me, ravi, stranger]]);
  await db.end();
});

beforeEach(async () => {
  if (!enabled) return;
  await db.query('DELETE FROM friendships WHERE account_id = ANY($1::uuid[])', [
    [me, ravi, stranger]
  ]);
  await db.query('DELETE FROM blocks WHERE blocker_account_id = ANY($1::uuid[])', [
    [me, ravi, stranger]
  ]);
  await db.query('DELETE FROM sanctions WHERE account_id = ANY($1::uuid[])', [
    [me, ravi, stranger]
  ]);
  await db.query('DELETE FROM leaderboard_opt_ins WHERE account_id = ANY($1::uuid[])', [
    [me, ravi, stranger]
  ]);
});

describePostgis('the friend board on real PostGIS', () => {
  it('shows a mutual friend with nobody having opted in', async () => {
    // The whole point of the change: no rows in `leaderboard_opt_ins` at all,
    // and both accounts are on the board.
    await befriend(me, ravi);

    const body = (await read(me)).json();

    expect(names(body)).toEqual(['Maya', 'Ravi']);
    const optIns = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM leaderboard_opt_ins WHERE account_id = ANY($1::uuid[])`,
      [[me, ravi]]
    );
    expect(Number(optIns.rows[0]!.count)).toBe(0);
  });

  it('includes the reader even with no friends at all', async () => {
    // A board somebody cannot find themselves on tells them nothing.
    const body = (await read(me)).json();

    expect(names(body)).toEqual(['Maya']);
  });

  it('leaves out a one-sided friendship', async () => {
    // Mutual friendship is the gate, and half of one is not it.
    await befriend(me, stranger, false);

    expect(names((await read(me)).json())).toEqual(['Maya']);
  });

  it('leaves out a friend the reader has blocked', async () => {
    await befriend(me, ravi);
    await db.query(
      `INSERT INTO blocks (blocker_account_id, blocked_account_id, reason)
       VALUES ($1, $2, 'other')`,
      [me, ravi]
    );

    expect(names((await read(me)).json())).toEqual(['Maya']);
  });

  it('leaves out a friend who has blocked the reader', async () => {
    // Blocking is symmetric in effect: it removes both from each other's board
    // whichever direction it points (`gameplay.md`).
    await befriend(me, ravi);
    await db.query(
      `INSERT INTO blocks (blocker_account_id, blocked_account_id, reason)
       VALUES ($1, $2, 'other')`,
      [ravi, me]
    );

    expect(names((await read(me)).json())).toEqual(['Maya']);
  });

  it('leaves out a suspended friend', async () => {
    // The exclusion the opt-in removal had to keep. It used to live in the
    // JOIN that was deleted, and now lives in a WHERE — which is exactly the
    // rewrite a fake database cannot check.
    await befriend(me, ravi);
    await db.query(
      `INSERT INTO sanctions (account_id, kind, reason, statement, issued_by_account_id)
       VALUES ($1, 'social_suspension', 'other', 'Paused after a report.', $2)`,
      [ravi, me]
    );

    expect(names((await read(me)).json())).toEqual(['Maya']);
  });

  it('leaves the suspended reader off their own board', async () => {
    await befriend(me, ravi);
    await db.query(
      `INSERT INTO sanctions (account_id, kind, reason, statement, issued_by_account_id)
       VALUES ($1, 'social_suspension', 'other', 'Paused after a report.', $2)`,
      [me, ravi]
    );

    // Their friend is still shown; they are not published to themselves as
    // being on a board they are paused from.
    expect(names((await read(me)).json())).toEqual(['Ravi']);
  });

  it('brings a friend back when the suspension is revoked', async () => {
    await befriend(me, ravi);
    const sanction = await db.query<{ id: string }>(
      `INSERT INTO sanctions (account_id, kind, reason, statement, issued_by_account_id)
       VALUES ($1, 'social_suspension', 'other', 'Paused after a report.', $2) RETURNING id`,
      [ravi, me]
    );
    expect(names((await read(me)).json())).toEqual(['Maya']);

    await db.query('UPDATE sanctions SET revoked_at = now() WHERE id = $1', [sanction.rows[0]!.id]);

    expect(names((await read(me)).json())).toEqual(['Maya', 'Ravi']);
  });

  it('leaves out a friend whose account is deleted', async () => {
    await befriend(me, ravi);
    await db.query('UPDATE accounts SET deleted_at = now() WHERE id = $1', [ravi]);
    try {
      expect(names((await read(me)).json())).toEqual(['Maya']);
    } finally {
      await db.query('UPDATE accounts SET deleted_at = NULL WHERE id = $1', [ravi]);
    }
  });

  it('never publishes a route, a pace, a distance, or a timestamp', async () => {
    // ADR-0007 survives the gate change: an entry is one pace-neutral score.
    await befriend(me, ravi);
    const body = (await read(me)).json();

    expect(JSON.stringify(body)).not.toMatch(
      /pace|speed|distance|latitude|longitude|route|processedAt/i
    );
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
