import type { Database } from '@runsphere/db';

/**
 * The staff roles granted to an account in `staff_role_assignments`, sorted by name.
 *
 * One lookup for every route module (M7.2). Each module still decides which roles it accepts, so
 * this only replaces the seven copies of the query that used to live beside those checks. The
 * env allow-list (`STAFF_REVIEW_ACCOUNT_IDS`) is a separate model and is not consulted here.
 */
export const staffRoles = async (database: Database, accountId: string): Promise<string[]> => {
  const result = await database.query<{ role: string }>(
    'SELECT role FROM staff_role_assignments WHERE account_id = $1 ORDER BY role',
    [accountId]
  );
  return result.rows.map((row) => row.role);
};
