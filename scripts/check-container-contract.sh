#!/bin/sh
set -eu

fail() {
  echo "Container contract: $1" >&2
  exit 1
}

[ -f Dockerfile ] || fail "the canonical root Dockerfile is missing"
[ ! -e Dockerfile.demo ] || fail "Dockerfile.demo must not reintroduce a second API image"
[ ! -e docker-compose.demo.yml ] || fail "demo mode must use the primary stack, not a separate Compose application"

[ -f docker-compose.override.yml ] ||
  fail "the development Compose overlay is missing"
[ -f deploy/compose.production.yml ] ||
  fail "the production Compose overlay is missing"
[ ! -e deploy/compose.staging.yml ] ||
  fail "the legacy standalone staging stack must not diverge from the shared stack"

grep -q 'MISTY_API_IMAGE' docker-compose.yml ||
  fail "the shared stack must select one MISTY_API_IMAGE"
api_image_consumers="$(grep -c '<<: \*api-image' docker-compose.yml)"
[ "$api_image_consumers" -ge 2 ] ||
  fail "shared migrations and API must consume the same API image anchor"

grep -q 'dockerfile: Dockerfile' docker-compose.override.yml ||
  fail "development must build the canonical root Dockerfile"

production_image_references="$(grep -c 'MISTY_API_IMAGE' deploy/compose.production.yml)"
[ "$production_image_references" -ge 2 ] ||
  fail "production migrations and API must use the same immutable MISTY_API_IMAGE"

grep -q '127.0.0.1:${MISTY_HOST_PORT:-8081}:8080' \
  deploy/compose.production.yml ||
  fail "production API must be loopback-only on host port 8081 by default"

if grep -Eq 'stripe:|tunnel:|cloudflare-deploy:' deploy/compose.production.yml; then
  fail "production must not run development-only Stripe, tunnel, or Worker services"
fi

echo "Development and production share the canonical Misty runtime stack."
