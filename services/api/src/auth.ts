import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { Database } from '@runsphere/db';

const accessLifetimeSeconds = 15 * 60;
const refreshLifetimeDays = 30;
const selectorBytes = 18;

interface AccessClaims {
  sub: string;
  exp: number;
}
interface RefreshTokenRecord {
  id: string;
  family_id: string;
  account_id: string;
  token_hash: string;
}

const encode = (value: string) => Buffer.from(value).toString('base64url');
const selectorHash = (selector: string) => createHash('sha256').update(selector).digest('hex');
const sign = (value: string, secret: string) =>
  createHmac('sha256', secret).update(value).digest('base64url');
const parseRefreshToken = (token: string) => {
  const [selector, verifier] = token.split('.');
  return selector && verifier && token.split('.').length === 2 ? { selector, verifier } : undefined;
};
const newRefreshToken = () => {
  const selector = randomBytes(selectorBytes).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  return { token: `${selector}.${verifier}`, selector };
};

export const createAccessToken = (accountId: string, secret: string): string => {
  const claims: AccessClaims = {
    sub: accountId,
    exp: Math.floor(Date.now() / 1000) + accessLifetimeSeconds
  };
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
};

export const verifyAccessToken = (token: string, secret: string): string | undefined => {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return undefined;
  const expected = sign(payload, secret);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims;
    return typeof claims.sub === 'string' && claims.exp > Math.floor(Date.now() / 1000)
      ? claims.sub
      : undefined;
  } catch {
    return undefined;
  }
};

const insertRefreshToken = async (db: Database, familyId: string) => {
  const refresh = newRefreshToken();
  await db.query(
    'INSERT INTO refresh_tokens (family_id, selector_hash, token_hash, expires_at) VALUES ($1, $2, $3, now() + $4::interval)',
    [
      familyId,
      selectorHash(refresh.selector),
      await argon2.hash(refresh.token, { type: argon2.argon2id }),
      `${refreshLifetimeDays} days`
    ]
  );
  return refresh.token;
};

export const pruneExpiredSessions = (db: Database) =>
  db.query("DELETE FROM refresh_token_families WHERE expires_at < now() - interval '7 days'");

export const issueSession = async (db: Database, accountId: string, secret: string) => {
  await pruneExpiredSessions(db);
  const family = await db.query<{ id: string }>(
    'INSERT INTO refresh_token_families (account_id, token_hash, expires_at) VALUES ($1, $2, now() + $3::interval) RETURNING id',
    [accountId, `legacy-${randomBytes(24).toString('hex')}`, `${refreshLifetimeDays} days`]
  );
  const refreshToken = await insertRefreshToken(db, family.rows[0]!.id);
  return {
    accessToken: createAccessToken(accountId, secret),
    refreshToken,
    expiresInSeconds: accessLifetimeSeconds
  };
};

const revokeFamily = (db: Database, familyId: string) =>
  db.query(
    'UPDATE refresh_token_families SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1',
    [familyId]
  );

export const rotateSession = async (db: Database, refreshToken: string, secret: string) => {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return undefined;
  const token = await db.query<RefreshTokenRecord>(
    `SELECT token.id, token.family_id, family.account_id, token.token_hash
     FROM refresh_tokens token JOIN refresh_token_families family ON family.id = token.family_id
     WHERE token.selector_hash = $1 AND token.expires_at > now() AND family.expires_at > now() AND family.revoked_at IS NULL`,
    [selectorHash(parsed.selector)]
  );
  const current = token.rows[0];
  if (!current) return undefined;
  if (current.id && !(await argon2.verify(current.token_hash, refreshToken))) {
    await revokeFamily(db, current.family_id);
    return undefined;
  }
  const used = await db.query<{ id: string }>(
    'UPDATE refresh_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id',
    [current.id]
  );
  if (!used.rows[0]) {
    await revokeFamily(db, current.family_id);
    return undefined;
  }
  const next = await insertRefreshToken(db, current.family_id);
  await db.query('UPDATE refresh_token_families SET rotated_at = now() WHERE id = $1', [
    current.family_id
  ]);
  return {
    accessToken: createAccessToken(current.account_id, secret),
    refreshToken: next,
    expiresInSeconds: accessLifetimeSeconds
  };
};

export const revokeSession = async (db: Database, refreshToken: string): Promise<void> => {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return;
  const token = await db.query<{ family_id: string }>(
    'SELECT family_id FROM refresh_tokens WHERE selector_hash = $1',
    [selectorHash(parsed.selector)]
  );
  if (token.rows[0]) await revokeFamily(db, token.rows[0].family_id);
};

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
