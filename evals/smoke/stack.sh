#!/usr/bin/env bash
# A throwaway server for the smoke test: its own Postgres container on its own port, with an empty
# database, and the server from ../misty-server beside the shared dev stack, which it never touches.
#
#   evals/smoke/stack.sh up <scratch folder>     Prints the address and runs the server until stopped
#   evals/smoke/stack.sh down <scratch folder>   Removes the container, the scratch folder and the
#                                                smoke profile's WebKit data
#
# It reads ~/.misty/server/dev for the server's keys and overrides the database, port and addresses.
# Object storage stays unset, so a development server keeps objects in memory.
set -euo pipefail

command="${1:?up or down}"
scratch="${2:?a scratch folder}"
server_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../misty-server" && pwd)"
container="misty-smoke-postgres"
db_port="${MISTY_SMOKE_DB_PORT:-55439}"
api_port="${MISTY_SMOKE_API_PORT:-18099}"
env_home="$HOME/.misty/server/dev"

case "$command" in
  down)
    docker rm -fv "$container" >/dev/null 2>&1 || true
    rm -rf "$scratch" "$HOME/Library/WebKit/com.misty.desktop.smoke" "$HOME/Library/Caches/com.misty.desktop.smoke"
    exit 0
    ;;
  up) ;;
  *) echo "Usage: $0 up|down <scratch folder>" >&2; exit 2 ;;
esac

mkdir -p "$scratch/docker" "$scratch/bin"
echo '{"auths":{}}' > "$scratch/docker/config.json"
# A config without credsStore avoids a known hang pulling public images.
DOCKER_CONFIG="$scratch/docker" docker run -d --name "$container" -p "127.0.0.1:$db_port:5432" \
  -e POSTGRES_USER=smoke_admin -e POSTGRES_PASSWORD=smoke_admin -e POSTGRES_DB=misty_smoke \
  pgvector/pgvector:pg16 >/dev/null
until docker exec "$container" pg_isready -q -U smoke_admin -d misty_smoke; do sleep 0.5; done
sleep 1
until docker exec "$container" pg_isready -q -U smoke_admin -d misty_smoke; do sleep 0.5; done

admin_sql() { docker exec "$container" psql -q -U smoke_admin -d misty_smoke -v ON_ERROR_STOP=1 -c "$1"; }
admin_sql "CREATE ROLE smoke_app LOGIN PASSWORD 'smoke_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
admin_sql "GRANT CONNECT ON DATABASE misty_smoke TO smoke_app"
admin_sql "GRANT USAGE ON SCHEMA public TO smoke_app"

cd "$server_repo"
goose_bin="$scratch/bin/goose"
[ -x "$goose_bin" ] || GOBIN="$scratch/bin" CGO_ENABLED=0 go install \
  -tags='no_clickhouse no_libsql no_mssql no_mysql no_sqlite3 no_vertica no_ydb' \
  github.com/pressly/goose/v3/cmd/goose@v3.27.3
"$goose_bin" -dir internal/platform/db/migrations postgres \
  "host=127.0.0.1 port=$db_port user=smoke_admin password=smoke_admin dbname=misty_smoke sslmode=disable" up >/dev/null
admin_sql "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO smoke_app"
admin_sql "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO smoke_app"

go build -o "$scratch/bin/misty-server" ./cmd/misty-server

set -a
for file in "$env_home/runtime.env" "$env_home/observability.env" "$env_home"/integrations/{ai,cloudflare,composio,google}.env "$env_home"/crypto/*.env; do
  # shellcheck disable=SC1090
  [ -f "$file" ] && source "$file"
done
set +a
unset R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY R2_SECRET_KEY MISTY_HOST_PORT \
  CLOUDFLARE_API_TOKEN CLOUDFLARE_TUNNEL_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_ZONE_ID MISTY_DEV_API_TUNNEL_HOSTNAME
address="http://127.0.0.1:$api_port"
export MISTY_ENVIRONMENT=development PORT="$api_port" MISTY_DEVICE_JOBS_ENABLED=true
export DB_HOST=127.0.0.1 DB_PORT="$db_port" DB_USER=smoke_app DB_PASSWORD=smoke_app DB_NAME=misty_smoke DB_SSLMODE=disable
export DB_MIGRATION_USER='' DB_MIGRATION_PASSWORD=''
export MISTY_PUBLIC_API_URL="$address/v1" MISTY_DEV_API_ORIGIN="$address" MISTY_PUBLIC_URL="$address" MISTY_WEBSITE_URL="$address"
export MISTY_ALLOWED_ORIGINS="tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:5199,http://127.0.0.1:5199"
export MISTY_COMPOSIO_API_KEY='' GOOGLE_CLIENT_ID='' GOOGLE_CLIENT_SECRET=''
echo "Throwaway server on $address"
exec "$scratch/bin/misty-server"
