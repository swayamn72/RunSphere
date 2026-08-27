#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL' | grep -qx '1'
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN 1 ELSE 0 END;
SQL
