#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Values explicitly supplied by the caller must win over local dotenv values.
# This is especially important for isolated demo/test databases: sourcing the
# repository's normal development .env must never silently redirect a migration.
misty_goose_db_host_set=${DB_HOST+x}; misty_goose_db_host=${DB_HOST-}
misty_goose_db_port_set=${DB_PORT+x}; misty_goose_db_port=${DB_PORT-}
misty_goose_db_user_set=${DB_USER+x}; misty_goose_db_user=${DB_USER-}
misty_goose_db_password_set=${DB_PASSWORD+x}; misty_goose_db_password=${DB_PASSWORD-}
misty_goose_db_name_set=${DB_NAME+x}; misty_goose_db_name=${DB_NAME-}
misty_goose_migration_user_set=${DB_MIGRATION_USER+x}; misty_goose_migration_user=${DB_MIGRATION_USER-}
misty_goose_migration_password_set=${DB_MIGRATION_PASSWORD+x}; misty_goose_migration_password=${DB_MIGRATION_PASSWORD-}
misty_goose_migrations_dir_set=${MIGRATIONS_DIR+x}; misty_goose_migrations_dir=${MIGRATIONS_DIR-}
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
[[ -n "$misty_goose_db_host_set" ]] && DB_HOST=$misty_goose_db_host
[[ -n "$misty_goose_db_port_set" ]] && DB_PORT=$misty_goose_db_port
[[ -n "$misty_goose_db_user_set" ]] && DB_USER=$misty_goose_db_user
[[ -n "$misty_goose_db_password_set" ]] && DB_PASSWORD=$misty_goose_db_password
[[ -n "$misty_goose_db_name_set" ]] && DB_NAME=$misty_goose_db_name
[[ -n "$misty_goose_migration_user_set" ]] && DB_MIGRATION_USER=$misty_goose_migration_user
[[ -n "$misty_goose_migration_password_set" ]] && DB_MIGRATION_PASSWORD=$misty_goose_migration_password
[[ -n "$misty_goose_migrations_dir_set" ]] && MIGRATIONS_DIR=$misty_goose_migrations_dir

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-misty}"
DB_PASSWORD="${DB_PASSWORD:-misty}"
DB_NAME="${DB_NAME:-misty_server}"
DB_MIGRATION_USER="${DB_MIGRATION_USER:-$DB_USER}"
DB_MIGRATION_PASSWORD="${DB_MIGRATION_PASSWORD:-$DB_PASSWORD}"
case "${DB_HOST}" in
  localhost|127.0.0.1|::1|postgres|/*) DB_SSLMODE="disable" ;;
  *) DB_SSLMODE="require" ;;
esac
MIGRATIONS_DIR="${MIGRATIONS_DIR:-db/migrations}"

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <goose-command> [args...]"
  echo
  echo "Examples:"
  echo "  $0 status"
  echo "  $0 up"
  echo "  $0 down"
  exit 2
fi

if ! command -v goose >/dev/null 2>&1; then
  echo "goose is not installed. Install it with:"
  echo "  go install github.com/pressly/goose/v3/cmd/goose@latest"
  exit 127
fi

DSN="host=${DB_HOST} port=${DB_PORT} user=${DB_MIGRATION_USER} password=${DB_MIGRATION_PASSWORD} dbname=${DB_NAME} sslmode=${DB_SSLMODE}"

exec goose -dir "$MIGRATIONS_DIR" postgres "$DSN" "$@"
