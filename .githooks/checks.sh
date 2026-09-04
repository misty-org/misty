#!/usr/bin/env bash
# Local checks for every commit and push (there is no GitHub CI).
#   .githooks/checks.sh commit   suites touched by the staged changes
#   .githooks/checks.sh push     every suite, on a clean tree
#   .githooks/checks.sh all|frontend|scripts|server|rust-cli|rust-desktop|billing|secrets|plan
# Skip once with git commit/push --no-verify.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
# Git exports GIT_DIR and friends to hooks (all of them in a linked
# worktree). Tests that create their own repositories must not inherit them,
# or their git init and config would write to this repository. From the
# checkout root, git finds the same repository without them.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
hooks="$root/.githooks"
# misty-billing sits beside the main checkout. A linked worktree lives inside it
# (.claude/worktrees/...), so find the main checkout through the shared git dir.
main_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
export MISTY_BILLING_REPO="${MISTY_BILLING_REPO:-$(dirname "$main_root")/misty-billing}"

frontend() { parallel frontend-typecheck frontend-lint frontend-unit frontend-dev-navigation; }
frontend_typecheck() { npm run typecheck; }
frontend_lint() { npm run lint; }
frontend_unit() { MISTY_SHARED_CPU=1 npm test; }
frontend_dev_navigation() { npm run test:dev-navigation; }
# Injected page scripts, the git hooks and the build and release scripts (cli/tasks).
scripts() { npm run test:scripts; }
billing() {
  local billing_root="$MISTY_BILLING_REPO"
  [ -f "$billing_root/.githooks/checks.sh" ] || { echo "Billing checkout missing: $billing_root" >&2; return 1; }
  (cd "$billing_root" && MISTY_SERVER_REPO="$root" bash .githooks/checks.sh go)
}
server() { parallel server-go billing-contract agent-runtime journal-collab; }
server_go() { bash "$hooks/server-tests.sh"; }
billing_contract() { bash "$root/server/scripts/test-billing-contract.sh"; }
agent_runtime() { (cd server/apps/agent-runtime && npm ci --no-audit --no-fund --silent && npm run typecheck && npm test); }
journal_collab() { (cd server/apps/journal-collab && npm ci --no-audit --no-fund --silent && npm run typecheck && npm test && npm run test:runtime); }
rust_cli() { cargo test --locked --quiet --manifest-path cli/Cargo.toml; }
rust_desktop() { parallel desktop-crate browser-sync-crate kiri-crate desktop-services; }
desktop_crate() { cargo test --locked --quiet --manifest-path src-tauri/Cargo.toml; }
browser_sync_crate() { cargo test --locked --quiet --manifest-path src-tauri/crates/browser-sync/Cargo.toml; }
# Kiri's core tests need no Tauri; the desktop crate builds its native side.
kiri_crate() { cargo test --locked --quiet --no-default-features --manifest-path kiri/Cargo.toml; }
desktop_services() {
  local manifest
  for manifest in src-tauri/services/*/Cargo.toml; do
    cargo test --locked --quiet --manifest-path "$manifest"
  done
}
# The same pinned gitleaks image and configuration the old CI used.
# A linked worktree and the main repository's git directory point at each
# other by absolute path, so a worktree is mounted at its own path.
repo=/repo
git_mounts=(-v "$root:/repo:ro")
git_common=$(cd "$(git rev-parse --git-common-dir)" && pwd)
if [ "$git_common" != "$root/.git" ]; then
  repo=$root
  git_mounts=(-v "$root:$root:ro" -v "$git_common:$git_common:ro")
fi
gitleaks_image=zricethezav/gitleaks@sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055
# Scans commits, never the working folder: git-ignored .env files stay out.
# On push, only the commits the remote does not have yet. A new branch has no
# upstream, so it scans the commits no remote branch contains.
secrets() {
  local range="HEAD --not --remotes"
  if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then
    range="$upstream..HEAD"
  fi
  # shellcheck disable=SC2086 # the range is several git arguments
  [ -z "$(git rev-list $range 2>/dev/null | head -n 1)" ] && { echo "No new commits to scan."; return 0; }
  docker run --rm "${git_mounts[@]}" -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
    -e GIT_CONFIG_VALUE_0="$repo" "$gitleaks_image" detect --source="$repo" --redact --log-opts="$range" --config="$repo/.config/gitleaks.toml"
}
staged_secrets() {
  docker run --rm "${git_mounts[@]}" -w "$repo" -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
    -e GIT_CONFIG_VALUE_0="$repo" "$gitleaks_image" protect --staged --source="$repo" --redact --config="$repo/.config/gitleaks.toml"
}

run() {
  local name=$1 started=$SECONDS
  echo "── $name"
  # Do not call this function in an if/! expression: Bash would disable
  # errexit inside the entire suite and allow an early failure to pass.
  "${name//-/_}"
  echo "✓ $name ($((SECONDS - started))s)"
}

# Runs steps at the same time, each into its own log, and reports them in
# order: the time of each that passed and the full log of each that failed.
# Returns the exit code of the first step (in order) that failed.
# Every step runs as a plain command in its own subshell, so errexit stays on
# inside it; only the wait is tested.
parallel() {
  local logs name i=0 status=0
  local pids=()
  logs=$(mktemp -d)
  for name in "$@"; do
    (
      started=$SECONDS
      "${name//-/_}"
      echo "$((SECONDS - started))" >"$logs/$name.time"
    ) >"$logs/$name.log" 2>&1 &
    pids+=($!)
  done
  local code
  for name in "$@"; do
    code=0
    wait "${pids[$i]}" || code=$?
    if [ "$code" -eq 0 ]; then
      echo "✓ $name ($(cat "$logs/$name.time")s)"
    else
      echo "✗ $name"
      sed 's/^/  /' "$logs/$name.log"
      [ "$status" -ne 0 ] || status=$code
    fi
    i=$((i + 1))
  done
  rm -rf "$logs"
  return "$status"
}

suites_for() { # paths on stdin -> suite names
  local frontend=0 server=0 cli=0 desktop=0 scripts=0 billing=0 path
  while IFS= read -r path; do
    case "$path" in
      src/* | package.json | package-lock.json | tsconfig*.json | vite*.ts | vitest*.ts | .config/*) frontend=1; scripts=1 ;;
      server/*) server=1 ;;
      cli/tasks/*) scripts=1 ;;
      cli/*) cli=1 ;;
      .githooks/*) frontend=1; server=1; cli=1; desktop=1; scripts=1; billing=1 ;;
      src-tauri/* | kiri/*) desktop=1 ;;
      rust-toolchain.toml) cli=1; desktop=1 ;;
    esac
  done
  ((frontend)) && echo frontend
  ((server)) && echo server
  ((cli)) && echo rust-cli
  ((desktop)) && echo rust-desktop
  ((scripts)) && echo scripts
  ((billing)) && echo billing
  return 0
}

all=(frontend scripts server rust-cli rust-desktop billing)
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
    # shellcheck disable=SC2086 # one suite name per word
    parallel $suites
    ;;
  push)
    # Tests run on the working tree, so it must match what is being pushed.
    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
      echo "Commit or discard local changes before pushing; checks must run on the pushed commit." >&2
      exit 1
    fi
    parallel secrets "${all[@]}"
    ;;
  all) parallel secrets "${all[@]}" ;;
  frontend | scripts | server | rust-cli | rust-desktop | billing | secrets) run "$1" ;;
  *) echo "Usage: .githooks/checks.sh commit|push|all|frontend|scripts|server|rust-cli|rust-desktop|billing|secrets|plan" >&2; exit 2 ;;
esac
