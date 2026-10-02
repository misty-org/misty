#!/usr/bin/env bash
# Local checks for every commit and push (there is no GitHub CI).
#   .githooks/checks.sh commit   suites touched by the staged changes
#   .githooks/checks.sh push     every suite, on a clean tree
#   .githooks/checks.sh all|frontend|tasks|server|rust-cli|rust-desktop|billing|secrets|plan
# Skip once with git commit/push --no-verify.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
hooks="$root/.githooks"

frontend() {
  npm run typecheck
  npm run lint
  npm test
  npm run test:dev-navigation
}
tasks() { npm run test:tasks; }
billing() {
  local billing_root="${MISTY_BILLING_REPO:-$(dirname "$root")/misty-billing}"
  [ -f "$billing_root/.githooks/checks.sh" ] || { echo "Billing checkout missing: $billing_root" >&2; return 1; }
  (cd "$billing_root" && MISTY_SERVER_REPO="$root" bash .githooks/checks.sh go)
}
server() {
  bash "$hooks/server-tests.sh"
  bash "$root/server/scripts/test-billing-contract.sh"
  (cd server/apps/agent-runtime && npm ci --no-audit --no-fund --silent && npm run typecheck && npm test)
  (cd server/apps/journal-collab && npm ci --no-audit --no-fund --silent && npm run typecheck && npm test && npm run test:runtime)
}
rust_cli() { cargo test --locked --quiet --manifest-path cli/Cargo.toml; }
rust_desktop() {
  cargo test --locked --quiet --manifest-path src-tauri/Cargo.toml
  cargo test --locked --quiet --manifest-path src-tauri/crates/browser-sync/Cargo.toml
  local manifest
  for manifest in src-tauri/services/*/Cargo.toml; do
    cargo test --locked --quiet --manifest-path "$manifest"
  done
}
# The same pinned gitleaks image and configuration the old CI used.
gitleaks_image=zricethezav/gitleaks@sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055
# Scans commits, never the working folder: git-ignored .env files stay out.
# On push, only the commits the remote does not have yet.
secrets() {
  local range=HEAD
  if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then
    range="$upstream..HEAD"
  fi
  [ -z "$(git rev-list "$range" 2>/dev/null | head -n 1)" ] && { echo "No new commits to scan."; return 0; }
  docker run --rm -v "$root:/repo:ro" -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
    -e GIT_CONFIG_VALUE_0=/repo "$gitleaks_image" detect --source=/repo --redact --log-opts="$range" --config=/repo/.config/gitleaks.toml
}
staged_secrets() {
  docker run --rm -v "$root:/repo:ro" -w /repo -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
    -e GIT_CONFIG_VALUE_0=/repo "$gitleaks_image" protect --staged --source=/repo --redact --config=/repo/.config/gitleaks.toml
}

run() {
  local name=$1 started=$SECONDS
  echo "── $name"
  # Do not call this function in an if/! expression: Bash would disable
  # errexit inside the entire suite and allow an early failure to pass.
  "${name//-/_}"
  echo "✓ $name ($((SECONDS - started))s)"
}

suites_for() { # paths on stdin -> suite names
  local frontend=0 server=0 cli=0 desktop=0 tasks=0 billing=0 path
  while IFS= read -r path; do
    case "$path" in
      src/* | package.json | package-lock.json | tsconfig*.json | vite*.ts | vitest*.ts | .config/*) frontend=1; tasks=1 ;;
      server/*) server=1 ;;
      cli/tasks/*) tasks=1 ;;
      cli/*) cli=1 ;;
      .githooks/*) frontend=1; server=1; cli=1; desktop=1; tasks=1; billing=1 ;;
      src-tauri/*) desktop=1 ;;
      rust-toolchain.toml) cli=1; desktop=1 ;;
    esac
  done
  ((frontend)) && echo frontend
  ((server)) && echo server
  ((cli)) && echo rust-cli
  ((desktop)) && echo rust-desktop
  ((tasks)) && echo tasks
  ((billing)) && echo billing
  return 0
}

all=(frontend tasks server rust-cli rust-desktop billing)
case "${1:-}" in
  plan) suites_for ;;
  commit)
    # Tests must see the same tracked files as the proposed commit.
    if ! git diff --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
      echo "Stage or stash outstanding files before committing so tests match the staged snapshot." >&2
      exit 1
    fi
    run staged-secrets
    # macOS ships bash 3.2, which has no mapfile.
    suites=$(git diff --cached --name-only --diff-filter=ACMRD | suites_for)
    [ -n "$suites" ] || { echo "No test suites affected."; exit 0; }
    for suite in $suites; do run "$suite"; done
    ;;
  push)
    # Tests run on the working tree, so it must match what is being pushed.
    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
      echo "Commit or discard local changes before pushing; checks must run on the pushed commit." >&2
      exit 1
    fi
    run secrets
    for suite in "${all[@]}"; do run "$suite"; done
    ;;
  all) run secrets; for suite in "${all[@]}"; do run "$suite"; done ;;
  frontend | tasks | server | rust-cli | rust-desktop | billing | secrets) run "$1" ;;
  *) echo "Usage: .githooks/checks.sh commit|push|all|frontend|tasks|server|rust-cli|rust-desktop|billing|secrets|plan" >&2; exit 2 ;;
esac
