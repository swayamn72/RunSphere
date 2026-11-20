import { createRequire } from 'node:module';
import { createDatabase, defaultDatabaseUrl } from '../packages/db/dist/index.js';

/**
 * Provision a staff account for a local or staging database.
 *
 * Every credential and address comes from the environment. Nothing personal or
 * secret lives in this file, so it is safe to commit and safe to read.
 *
 *   SEED_ADMIN_EMAIL           required. The staff account to create or update.
 *   SEED_ADMIN_PASSWORD        required when the account does not exist yet,
 *                              or when SEED_ADMIN_RESET_PASSWORD=true.
 *                              At least 12 characters (the registration rule).
 *   SEED_ADMIN_ROLES           optional, comma-separated. Defaults to every role.
 *                              One of: admin, data_steward, moderator,
 *                              privacy_officer, campaign_manager,
 *                              season_operator, support.
 *   SEED_ADMIN_RESET_PASSWORD  optional. "true" overwrites an existing
 *                              account's password; otherwise it is left alone.
 *   SEED_STAFF_EMAILS          optional, comma-separated. Existing accounts
 *                              (registered through the app) to grant the same
 *                              roles. Unknown addresses are reported, not created.
 *   SEED_ALLOW_PRODUCTION      must be "true" to run when NODE_ENV=production.
 *
 * Usage (after `pnpm build`, so `packages/db/dist` exists):
 *
 *   SEED_ADMIN_EMAIL=ops@example.test SEED_ADMIN_PASSWORD='…' pnpm seed:admin
 *
 * The output never prints a password or a full address.
 */

const require = createRequire(new URL('../services/api/package.json', import.meta.url));
const argon2 = require('argon2');

const ALL_ROLES = [
  'admin',
  'data_steward',
  'moderator',
  'privacy_officer',
  'campaign_manager',
  'season_operator',
  'support'
];
const MIN_PASSWORD_LENGTH = 12;

const fail = (message) => {
  console.error(`seed-admin: ${message}`);
  process.exit(1);
};

const list = (value) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** `ops@example.test` → `o***@example.test`, so logs never carry a full address. */
const masked = (email) => {
  const [local, domain] = email.split('@');
  return `${local?.[0] ?? '?'}***@${domain ?? '?'}`;
};

const env = process.env;
if (env.NODE_ENV === 'production' && env.SEED_ALLOW_PRODUCTION !== 'true')
  fail('refusing to run with NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true if you mean it.');

const email = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
if (!email || !email.includes('@')) fail('SEED_ADMIN_EMAIL must be set to an email address.');

const password = env.SEED_ADMIN_PASSWORD;
const resetPassword = env.SEED_ADMIN_RESET_PASSWORD === 'true';
if (password !== undefined && password.length < MIN_PASSWORD_LENGTH)
  fail(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);

const roles = list(env.SEED_ADMIN_ROLES);
const grantedRoles = roles.length > 0 ? roles : ALL_ROLES;
const unknownRoles = grantedRoles.filter((role) => !ALL_ROLES.includes(role));
if (unknownRoles.length > 0) fail(`unknown role(s): ${unknownRoles.join(', ')}.`);

const staffEmails = list(env.SEED_STAFF_EMAILS).map((address) => address.toLowerCase());

const grant = (db, accountId) =>
  db.query(
    `INSERT INTO staff_role_assignments (account_id, role)
     SELECT $1, role FROM staff_roles WHERE role = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [accountId, grantedRoles]
  );

const db = createDatabase(defaultDatabaseUrl(env));
try {
  const existing = await db.query(
    'SELECT id FROM accounts WHERE lower(email) = lower($1) AND deleted_at IS NULL',
    [email]
  );
  let adminId = existing.rows[0]?.id;

  if (!adminId) {
    if (!password) fail('SEED_ADMIN_PASSWORD is required to create a new account.');
    const created = await db.query(
      `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
       VALUES ($1, $2, now(), '1.0') RETURNING id`,
      [email, await argon2.hash(password, { type: argon2.argon2id })]
    );
    adminId = created.rows[0].id;
    await db.query(
      `INSERT INTO consent_history (account_id, consent_type, granted, policy_version)
       VALUES ($1, 'age_assertion', true, '1.0')`,
      [adminId]
    );
    console.log(`Created staff account ${masked(email)}.`);
  } else if (resetPassword) {
    if (!password) fail('SEED_ADMIN_RESET_PASSWORD=true needs SEED_ADMIN_PASSWORD.');
    await db.query('UPDATE accounts SET password_hash = $1, updated_at = now() WHERE id = $2', [
      await argon2.hash(password, { type: argon2.argon2id }),
      adminId
    ]);
    // A new password should not leave old sessions alive.
    await db.query(
      `UPDATE refresh_token_families SET revoked_at = coalesce(revoked_at, now())
       WHERE account_id = $1 AND revoked_at IS NULL`,
      [adminId]
    );
    console.log(`Reset the password for ${masked(email)} and signed out its sessions.`);
  } else {
    console.log(`${masked(email)} already exists; password left unchanged.`);
  }

  await grant(db, adminId);
  console.log(`Granted ${grantedRoles.join(', ')} to ${masked(email)}.`);

  for (const staffEmail of staffEmails) {
    const account = await db.query(
      'SELECT id FROM accounts WHERE lower(email) = lower($1) AND deleted_at IS NULL',
      [staffEmail]
    );
    if (!account.rows[0]) {
      console.warn(`No account for ${masked(staffEmail)}; register it in the app first.`);
      continue;
    }
    await grant(db, account.rows[0].id);
    console.log(`Granted ${grantedRoles.join(', ')} to ${masked(staffEmail)}.`);
  }
} catch (error) {
  // The message only: a connection error can carry the connection string.
  console.error(`seed-admin failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
