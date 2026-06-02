#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export TEST_DB_HOST="${TEST_DB_HOST:-${DB_HOST:-}}"
export TEST_DB_PORT="${TEST_DB_PORT:-${DB_PORT:-5432}}"
export TEST_DB_USER="${TEST_DB_USER:-${DB_USER:-}}"
export TEST_DB_PASSWORD="${TEST_DB_PASSWORD:-${DB_PASSWORD:-}}"
export TEST_DB_SSLMODE="${TEST_DB_SSLMODE:-${DB_SSLMODE:-disable}}"

if [[ -z "${TEST_DB_NAME:-}" ]]; then
  if [[ -n "${DB_NAME:-}" ]]; then
    if [[ "$DB_NAME" == *test* ]]; then
      export TEST_DB_NAME="$DB_NAME"
    else
      export TEST_DB_NAME="${DB_NAME}_test"
    fi
  fi
fi

go test ./... -count=1 "$@"
