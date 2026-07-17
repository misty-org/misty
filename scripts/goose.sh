#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

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
