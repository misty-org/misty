#!/usr/bin/env bash
# Runs the Go server suite against a disposable PostgreSQL container, exactly
# as production runs it (same pinned image); the dev database is untouched.
# Arguments replace the default ./... package list, e.g.
#   .githooks/server-tests.sh ./test/contract/postgres -run NativeNote
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/server"
image=pgvector/pgvector:pg16@sha256:1d533553fefe4f12e5d80c7b80622ba0c382abb5758856f52983d8789179f0fb
password=misty-test-password
# The data directory lives in memory: tests churn table files constantly, and
# Docker's disk is slow on macOS. Nothing here needs to survive the run.
container=$(docker run -d --rm -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data:rw,size=2g \
  -e POSTGRES_USER=misty -e POSTGRES_PASSWORD=$password -e POSTGRES_DB=misty_test \
  "$image" -c checkpoint_timeout=30s -c fsync=off -c synchronous_commit=off -c full_page_writes=off)
trap 'docker rm -fv "$container" >/dev/null 2>&1 || true' EXIT
port=$(docker port "$container" 5432/tcp | head -n 1 | sed 's/.*://')
waited=0
until docker exec "$container" pg_isready -U misty -d misty_test >/dev/null 2>&1; do
  # A container that exits (for example, Docker out of disk) never becomes ready.
  if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" != true ] || ((++waited > 60)); then
    echo "Test PostgreSQL did not start:" >&2
    docker logs --tail 20 "$container" >&2 2>&1 || true
    exit 1
  fi
  sleep 1
done

export DB_HOST=127.0.0.1 DB_PORT=$port DB_USER=misty DB_PASSWORD=$password DB_NAME=misty_test DB_SSLMODE=disable
export TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=$port TEST_DB_USER=misty TEST_DB_PASSWORD=$password
export TEST_DB_NAME=misty_test TEST_DB_SSLMODE=disable
export STRIPE_WEBHOOK_SECRET=whsec_local_test_secret_123 MISTY_ENVIRONMENT=
# The test kit fills unset variables from server/.env/dev. Pin the ones that
# change behavior so local runs match a clean environment.
export MISTY_BILLING_ADAPTER=none MISTY_BILLING_URL= MISTY_BILLING_SECRET=

bin="$PWD/.misty/bin"
[ -x "$bin/goose" ] || GOBIN="$bin" go install \
  -tags="no_clickhouse no_libsql no_mssql no_mysql no_sqlite3 no_vertica no_ydb" \
  github.com/pressly/goose/v3/cmd/goose@v3.27.3
PATH="$bin:$PATH" ./scripts/goose.sh up >/dev/null
PGHOST=127.0.0.1 PGPORT=$port PGUSER=misty PGPASSWORD=$password PGDATABASE=misty_test \
  MISTY_APP_DB_USER=misty_app MISTY_APP_DB_PASSWORD=misty-app-test-password \
  ./scripts/docker/postgres-grant-app-role.sh >/dev/null
log=$(mktemp)
set +e
if [ $# -eq 0 ]; then set -- ./...; fi
go test -p 1 -timeout 30m -count=1 "$@" >"$log" 2>&1
status=$?
set -e
grep -v -e '^ok ' -e 'no test files' "$log" || true
rm -f "$log"
exit "$status"
