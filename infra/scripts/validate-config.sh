#!/usr/bin/env sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose_file=${COMPOSE_FILE:-"$root_dir/infra/compose.yaml"}
env_file=${ENV_FILE:-"$root_dir/.env"}
validate_compose=${VALIDATE_COMPOSE:-1}

fail() {
  printf '%s\n' "Configuration error: $*" >&2
  exit 1
}

[ -f "$env_file" ] || fail "missing $env_file; copy .env.example and set its required values"

get_env() {
  key=$1
  sed -n "s/^[[:space:]]*${key}=//p" "$env_file" | tail -n 1 | sed 's/[[:space:]]*$//'
}

require_value() {
  key=$1
  value=$(get_env "$key" || true)
  [ -n "$value" ] || fail "$key must be set in $env_file"
  printf '%s' "$value"
}

reject_placeholder() {
  key=$1
  value=$2
  case "$value" in
    *replace-with-*|*change-me*|*example*|*your-*|*your_*|*'<'*'>'*)
      fail "$key must not contain an example or placeholder value"
      ;;
  esac
}

require_port() {
  key=$1
  value=$(require_value "$key")
  case "$value" in
    *[!0-9]* | '') fail "$key must be a numeric port" ;;
  esac
  [ "$value" -ge 1 ] && [ "$value" -le 65535 ] || fail "$key must be between 1 and 65535"
}

require_secret() {
  key=$1
  value=$(require_value "$key")
  reject_placeholder "$key" "$value"
  [ "${#value}" -ge 16 ] || fail "$key must be at least 16 characters"
  printf '%s' "$value"
}

postgres_password=$(require_secret POSTGRES_PASSWORD)
pgadmin_password=$(require_secret PGADMIN_DEFAULT_PASSWORD)
[ "$postgres_password" != "$pgadmin_password" ] || fail "POSTGRES_PASSWORD and PGADMIN_DEFAULT_PASSWORD must differ"

postgres_db=$(require_value POSTGRES_DB)
postgres_user=$(require_value POSTGRES_USER)
reject_placeholder POSTGRES_DB "$postgres_db"
reject_placeholder POSTGRES_USER "$postgres_user"

pgadmin_email=$(require_value PGADMIN_DEFAULT_EMAIL)
case "$pgadmin_email" in
  *@?*) ;;
  *) fail "PGADMIN_DEFAULT_EMAIL must be an email address" ;;
esac
reject_placeholder PGADMIN_DEFAULT_EMAIL "$pgadmin_email"

martin_url=$(require_value MARTIN_DATABASE_URL)
reject_placeholder MARTIN_DATABASE_URL "$martin_url"
case "$martin_url" in
  postgresql://*@*/* | postgres://*@*/*) ;;
  *) fail "MARTIN_DATABASE_URL must be a PostgreSQL connection URL with credentials" ;;
esac
martin_authority=${martin_url#*://}
martin_userinfo=${martin_authority%%@*}
case "$martin_userinfo" in
  *:*) martin_password=${martin_userinfo#*:} ;;
  *) fail "MARTIN_DATABASE_URL must include a password" ;;
esac
reject_placeholder MARTIN_DATABASE_URL "$martin_password"
[ "${#martin_password}" -ge 16 ] || fail "MARTIN_DATABASE_URL password must be at least 16 characters"

require_port POSTGRES_HOST_PORT
require_port PGADMIN_HOST_PORT
require_port MARTIN_HOST_PORT
require_port VALHALLA_HOST_PORT

valhalla_tile_urls=$(get_env VALHALLA_TILE_URLS || true)
[ -z "$valhalla_tile_urls" ] || reject_placeholder VALHALLA_TILE_URLS "$valhalla_tile_urls"

if [ "$validate_compose" = "1" ] && command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose --env-file "$env_file" -f "$compose_file" config --quiet
elif [ "$validate_compose" = "1" ]; then
  printf '%s\n' "docker compose unavailable; completed static .env validation only." >&2
fi

printf '%s\n' "Infrastructure configuration is valid."
