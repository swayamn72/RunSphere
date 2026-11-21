/**
 * SQL fragments for reading another runner's privacy settings and username
 * inside a query. Column and setting names come from code, never a request.
 *
 * Accounts with no settings row read as `fallback`: callers pass the
 * conservative default migration 050 gave existing accounts.
 */
export const settingFor = (column: string, setting: string, fallback: boolean) =>
  `COALESCE((SELECT s.${setting} FROM privacy_settings s WHERE s.account_id = ${column}), ${fallback})`;

export const usernameFor = (column: string) =>
  `(SELECT a.username FROM accounts a WHERE a.id = ${column})`;
