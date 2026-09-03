-- Leaderboard scope opt-ins (ADR-0007). Boards are opt-in, off by default, and
-- separately revocable per scope: the absence of a row means "not on that
-- board", so no migration ever enrolls an existing account.
--
-- Friend boards use a visibility control independent of activity visibility, so
-- this deliberately does not reuse `accounts.profile_visibility`. Only the
-- 'friends' scope has a read path today; the remaining scopes are listed so a
-- later phase adds a row kind rather than a second table.

CREATE TABLE IF NOT EXISTS leaderboard_opt_ins (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('friends', 'global', 'club', 'competition', 'territory')),
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (account_id, scope)
);

-- The read path only ever asks for live opt-ins in one scope.
CREATE INDEX IF NOT EXISTS leaderboard_opt_ins_scope_idx
  ON leaderboard_opt_ins (scope, account_id) WHERE revoked_at IS NULL;
