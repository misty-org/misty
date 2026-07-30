#!/bin/sh
set -eu

fail() {
  echo "Container contract: $1" >&2
  exit 1
}

[ -f Dockerfile ] || fail "the canonical root Dockerfile is missing"
[ ! -e Dockerfile.demo ] || fail "Dockerfile.demo must not reintroduce a second API image"
[ ! -e docker-compose.demo.yml ] || fail "demo mode must use the primary stack, not a separate Compose application"

grep -q 'image: misty-server:local' docker-compose.yml ||
  fail "local Compose must tag the canonical API image as misty-server:local"
grep -q 'dockerfile: Dockerfile' docker-compose.yml ||
  fail "local Compose must build the canonical root Dockerfile"

staging_image_references="$(grep -c 'MISTY_API_IMAGE' deploy/compose.staging.yml)"
[ "$staging_image_references" -ge 2 ] ||
  fail "staging migrations and API must use the same immutable MISTY_API_IMAGE"

echo "Local, CI, and staging share the canonical Misty API image contract."
