import type { GhostTraceUnavailable } from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { seasonMonthFor } from '@runsphere/domain';
import { settingFor, usernameFor } from './privacy-sql.js';

/**
 * Whether `accountId` may race the ghost of `claimId` (`territory-guide.md`
 * "Ghost Race"). Shared by the ghost-trace route and by starting a Ghost Race
 * run (M9 9.3), so the two can never disagree about who may race what.
 *
 * The rules, in the order they're checked (none of them spends the hourly
 * view budget, which only the ghost-trace route counts):
 *
 *   1. The claim must still be held.
 *   2. Not your own ground.
 *   3. No block, in either direction (answered as "not held").
 *   4. The holder hasn't turned Ghost Races off (answered as "no trace").
 *   5. The same region: a city the requester holds ground in this season, or
 *      anywhere if they hold none yet.
 *   6. A trimmed ghost trace exists.
 */
export interface RaceableClaim {
  id: string;
  account_id: string;
  city_tag: string | null;
  claimed_at: Date;
  display_name: string | null;
  cosmetic: unknown;
  username: string | null;
  named: boolean;
  ghost_races: boolean;
  path: unknown;
  elapsed_seconds: number[];
  distance_metres: number | null;
  duration_seconds: number;
  trim_metres: number | null;
}

export type GhostRaceAccess =
  | { ok: true; claim: RaceableClaim }
  | { ok: false; code: 403 | 404; reason: GhostTraceUnavailable['reason']; message: string };

const NOT_HELD = 'This ground is not held by anybody right now.';

export const ghostRaceAccess = async (
  database: Database,
  accountId: string,
  claimId: string
): Promise<GhostRaceAccess> => {
  const claim = await database.query<
    Omit<RaceableClaim, 'elapsed_seconds' | 'duration_seconds'> & {
      elapsed_seconds: number[] | null;
      duration_seconds: number | null;
    }
  >(
    `SELECT claim.id, claim.account_id, claim.city_tag, claim.claimed_at,
       profile.display_name, profile.cosmetic,
       ${usernameFor('claim.account_id')} AS username,
       ${settingFor('claim.account_id', 'name_on_ground', false)} AS named,
       ${settingFor('claim.account_id', 'ghost_races', true)} AS ghost_races,
       ST_AsGeoJSON(ghost.path) AS path, ghost.elapsed_seconds,
       ghost.distance_metres, ghost.duration_seconds, ghost.trim_metres
     FROM territory_claims claim
     LEFT JOIN profiles profile ON profile.account_id = claim.account_id
     LEFT JOIN territory_claim_ghost_traces ghost ON ghost.claim_id = claim.id
     WHERE claim.id = $1 AND claim.released_at IS NULL`,
    [claimId]
  );
  const row = claim.rows[0];
  // One answer for "no such claim" and "no longer held", because which of
  // the two it is is not the asker's business.
  if (!row) return { ok: false, code: 404, reason: 'not_held', message: NOT_HELD };

  if (row.account_id === accountId)
    return {
      ok: false,
      code: 403,
      reason: 'own_claim',
      message: 'This is your own ground. There is no ghost to race.'
    };

  const blocked = await database.query<{ blocked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
       AND ((block.blocker_account_id = $1 AND block.blocked_account_id = $2)
         OR (block.blocker_account_id = $2 AND block.blocked_account_id = $1))) AS blocked`,
    [accountId, row.account_id]
  );
  // Answered as "not held" rather than "you are blocked": a refusal that
  // names the block tells the asker something about the holder's choices.
  if (blocked.rows[0]?.blocked)
    return { ok: false, code: 404, reason: 'not_held', message: NOT_HELD };
  // ADR-0014: the holder turned Ghost Races off. Same answer as a run with
  // no trace, so the choice itself isn't disclosed.
  if (!row.ghost_races)
    return {
      ok: false,
      code: 404,
      reason: 'no_trace',
      message: 'This run cannot be shown as a ghost.'
    };

  if (row.city_tag) {
    const mine = await database.query<{ city_tag: string }>(
      `SELECT DISTINCT city_tag FROM territory_claims
       WHERE account_id = $1 AND released_at IS NULL AND season_month = $2
         AND city_tag IS NOT NULL`,
      [accountId, seasonMonthFor(new Date())]
    );
    const cities = mine.rows.map((place) => place.city_tag);
    if (cities.length > 0 && !cities.includes(row.city_tag))
      return {
        ok: false,
        code: 403,
        reason: 'out_of_region',
        message: 'Ghost races are limited to places you have run in this season.'
      };
  }

  if (!row.path || !row.elapsed_seconds || !row.duration_seconds)
    return {
      ok: false,
      code: 404,
      reason: 'no_trace',
      message:
        'This run cannot be shown as a ghost. Its loop was too short to trim safely, or it was claimed before ghost races existed.'
    };

  return {
    ok: true,
    claim: { ...row, elapsed_seconds: row.elapsed_seconds, duration_seconds: row.duration_seconds }
  };
};
