import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { Database } from '@runsphere/db';

const accessLifetimeSeconds = 15 * 60;
const refreshLifetimeDays = 30;

interface AccessClaims {
  sub: string;
  exp: number;
}

const encode = (value: string) => Buffer.from(value).toString('base64url');
const sign = (value: string, secret: string) =>
  createHmac('sha256', secret).update(value).digest('base64url');

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

export const newRefreshToken = () => randomBytes(48).toString('base64url');

export const issueSession = async (db: Database, accountId: string, secret: string) => {
  const refreshToken = newRefreshToken();
  const tokenHash = await argon2.hash(refreshToken, { type: argon2.argon2id });
  await db.query(
    'INSERT INTO refresh_token_families (account_id, token_hash, expires_at) VALUES ($1, $2, now() + $3::interval)',
    [accountId, tokenHash, `${refreshLifetimeDays} days`]
  );
  return {
    accessToken: createAccessToken(accountId, secret),
    refreshToken,
    expiresInSeconds: accessLifetimeSeconds
  };
};

export const rotateSession = async (db: Database, refreshToken: string, secret: string) => {
  const sessions = await db.query<{ id: string; account_id: string; token_hash: string }>(
    'SELECT id, account_id, token_hash FROM refresh_token_families WHERE revoked_at IS NULL AND expires_at > now()'
  );
  const current = (
    await Promise.all(
      sessions.rows.map(async (row) => ({
        row,
        valid: await argon2.verify(row.token_hash, refreshToken)
      }))
    )
  ).find((candidate) => candidate.valid)?.row;
  if (!current) return undefined;
  const next = newRefreshToken();
  const nextHash = await argon2.hash(next, { type: argon2.argon2id });
  const updated = await db.query<{ id: string }>(
    'UPDATE refresh_token_families SET token_hash = $1, rotated_at = now() WHERE id = $2 AND revoked_at IS NULL RETURNING id',
    [nextHash, current.id]
  );
  if (updated.rows.length === 0) return undefined;
  return {
    accessToken: createAccessToken(current.account_id, secret),
    refreshToken: next,
    expiresInSeconds: accessLifetimeSeconds
  };
};

export const revokeSession = async (db: Database, refreshToken: string): Promise<void> => {
  const sessions = await db.query<{ id: string; token_hash: string }>(
    'SELECT id, token_hash FROM refresh_token_families WHERE revoked_at IS NULL'
  );
  const current = (
    await Promise.all(
      sessions.rows.map(async (row) => ({
        row,
        valid: await argon2.verify(row.token_hash, refreshToken)
      }))
    )
  ).find((candidate) => candidate.valid)?.row;
  if (current)
    await db.query('UPDATE refresh_token_families SET revoked_at = now() WHERE id = $1', [
      current.id
    ]);
};

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
