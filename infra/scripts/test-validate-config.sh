#!/usr/bin/env sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
validator="$root_dir/infra/scripts/validate-config.sh"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

write_valid_env() {
  cat >"$1" <<'ENV'
POSTGRES_DB=runsphere
POSTGRES_USER=runsphere
POSTGRES_PASSWORD=postgres-password-1234
POSTGRES_HOST_PORT=5432
POSTGRES_SHARED_BUFFERS=128MB
POSTGRES_EFFECTIVE_CACHE_SIZE=384MB
POSTGRES_MAINTENANCE_WORK_MEM=64MB
POSTGRES_MAX_CONNECTIONS=40
POSTGRES_LOG_MIN_DURATION_STATEMENT=500
PGADMIN_DEFAULT_EMAIL=ops@runsphere.local
PGADMIN_DEFAULT_PASSWORD=pgadmin-password-12345
PGADMIN_HOST_PORT=5050
MARTIN_DATABASE_URL=postgresql://runsphere:postgres-password-1234@postgres:5432/runsphere
MARTIN_HOST_PORT=3000
VALHALLA_TILE_URLS=
VALHALLA_HOST_PORT=8002
ENV
}

assert_valid() {
  ENV_FILE=$1 VALIDATE_COMPOSE=0 "$validator" >/dev/null
}

assert_invalid() {
  expected=$1
  env_file=$2
  if ENV_FILE="$env_file" VALIDATE_COMPOSE=0 "$validator" >"$tmp_dir/output" 2>&1; then
    printf '%s\n' "Expected validation to fail: $expected" >&2
    exit 1
  fi
  grep -F "$expected" "$tmp_dir/output" >/dev/null || {
    cat "$tmp_dir/output" >&2
    printf '%s\n' "Expected validation error containing: $expected" >&2
    exit 1
  }
}

valid_env="$tmp_dir/valid.env"
write_valid_env "$valid_env"
assert_valid "$valid_env"

assert_invalid "POSTGRES_PASSWORD must not contain" "$root_dir/.env.example"

short_secret_env="$tmp_dir/short-secret.env"
cp "$valid_env" "$short_secret_env"
sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=short/' "$short_secret_env"
assert_invalid "POSTGRES_PASSWORD must be at least 16 characters" "$short_secret_env"

shared_secret_env="$tmp_dir/shared-secret.env"
cp "$valid_env" "$shared_secret_env"
sed -i 's/^PGADMIN_DEFAULT_PASSWORD=.*/PGADMIN_DEFAULT_PASSWORD=postgres-password-1234/' "$shared_secret_env"
assert_invalid "POSTGRES_PASSWORD and PGADMIN_DEFAULT_PASSWORD must differ" "$shared_secret_env"

embedded_placeholder_env="$tmp_dir/embedded-placeholder.env"
cp "$valid_env" "$embedded_placeholder_env"
sed -i 's#^MARTIN_DATABASE_URL=.*#MARTIN_DATABASE_URL=postgresql://runsphere:replace-with-a-long-unique-password@postgres:5432/runsphere#' "$embedded_placeholder_env"
assert_invalid "MARTIN_DATABASE_URL must not contain" "$embedded_placeholder_env"

short_url_secret_env="$tmp_dir/short-url-secret.env"
cp "$valid_env" "$short_url_secret_env"
sed -i 's#^MARTIN_DATABASE_URL=.*#MARTIN_DATABASE_URL=postgresql://runsphere:short@postgres:5432/runsphere#' "$short_url_secret_env"
assert_invalid "MARTIN_DATABASE_URL password must be at least 16 characters" "$short_url_secret_env"

invalid_port_env="$tmp_dir/invalid-port.env"
cp "$valid_env" "$invalid_port_env"
sed -i 's/^MARTIN_HOST_PORT=.*/MARTIN_HOST_PORT=70000/' "$invalid_port_env"
assert_invalid "MARTIN_HOST_PORT must be between 1 and 65535" "$invalid_port_env"

printf '%s\n' "Infrastructure configuration validation tests passed."
