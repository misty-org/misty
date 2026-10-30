#!/usr/bin/env bash
# Local checks for every commit and push (there is no GitHub CI).
#   .githooks/checks.sh commit   suites touched by the staged changes
#   .githooks/checks.sh push     every suite, on a clean tree
#   .githooks/checks.sh all|frontend|scripts|server|rust-cli|rust-desktop|secrets|plan
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

frontend() { parallel frontend-typecheck frontend-lint frontend-unit frontend-dev-navigation; }
frontend_typecheck() { npm run typecheck; }
frontend_lint() { npm run lint; }
frontend_unit() { MISTY_SHARED_CPU=1 npm test; }
frontend_dev_navigation() { npm run test:dev-navigation; }
# Injected page scripts, the git hooks and the build and release scripts (cli/tasks).
scripts() { npm run test:scripts; }
server() { parallel server-go agent-runtime journal-collab; }
server_go() {
  cargo run --quiet --locked --manifest-path "$root/cli/Cargo.toml" -- check go-sizes
  bash "$hooks/server-tests.sh"
}
agent_runtime() { (cd server/apps/agent-runtime && npm ci --no-audit --no-fund --silent && npm run typecheck && npm test); }
journal_collab() { (cd server/apps/journal-collab && npm ci --no-audit --no-fund --silent && npm run typecheck && npm test && npm run test:runtime); }
rust_cli() { cargo test --locked --quiet --manifest-path cli/Cargo.toml; }
rust_desktop() { parallel desktop-crate desktop-windows browser-sync-crate kiri-crate desktop-services; }
desktop_crate() { cargo test --locked --quiet --manifest-path src-tauri/Cargo.toml; }
# The desktop crate compiles for Windows too. A Windows machine already covers
# it in desktop-crate; elsewhere cargo-xwin cross-checks every target, so
# macOS-only changes cannot silently break the Windows build.
desktop_windows() {
  case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) echo "Covered by desktop-crate on Windows."; return 0 ;; esac
  if ! cargo xwin --version >/dev/null 2>&1; then
    echo "cargo-xwin is required to check the Windows build: cargo install --locked cargo-xwin" >&2
    echo "and rustup target add x86_64-pc-windows-msvc" >&2
    return 1
  fi
  cargo xwin check --locked --quiet --all-targets --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
}
browser_sync_crate() { cargo test --locked --quiet --manifest-path src-tauri/crates/browser-sync/Cargo.toml; }
# Code projects: file tools, the Seatbelt sandbox and its escape tests (macOS).
# Kiri's core tests need no Tauri; the desktop crate builds its native side.
kiri_crate() { cargo test --locked --quiet --no-default-features --manifest-path kiri/Cargo.toml; }
desktop_services() {
  local manifest
  for manifest in src-tauri/services/*/Cargo.toml; do
    cargo test --locked --quiet --manifest-path "$manifest"
  done
}
# A pinned gitleaks image with the repository's gitleaks configuration.
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

# Runs steps at the same time, each into its own log, and reports completion
# and the full log of each that failed. Periodic updates keep long-running
# checks visible even when their tools buffer output.
# Returns the exit code of the first step (in launch order) that failed.
# Every step runs as a plain command in its own subshell, so errexit stays on
# inside it; only the wait is tested.
parallel() {
  local logs name i=0 status=0 started=$SECONDS last_report=$SECONDS running
  local pids=()
  local done=()
  logs=$(mktemp -d)
  for name in "$@"; do
    case "$name" in
      frontend) echo "▶ frontend checks started (typecheck, lint, unit tests, dev-navigation)" ;;
      scripts) echo "▶ script tests started" ;;
      rust-desktop) echo "▶ Rust desktop checks started (crate tests and Windows cross-check)" ;;
      *) echo "▶ $name started" ;;
    esac
    (
      started=$SECONDS
      "${name//-/_}" 2>&1 | tee "$logs/$name.log" | while IFS= read -r line; do
        printf '[%s] %s\n' "$name" "$line"
      done
      echo "$((SECONDS - started))" >"$logs/$name.time"
    ) &
    pids+=($!)
    done+=(0)
  done
  local code
  while :; do
    running=0
    i=0
    for name in "$@"; do
      if [ "${done[$i]}" -eq 0 ]; then
        if kill -0 "${pids[$i]}" 2>/dev/null; then
          running=$((running + 1))
        else
          code=0
          wait "${pids[$i]}" || code=$?
          done[$i]=1
          if [ "$code" -eq 0 ]; then
            echo "✓ $name ($(cat "$logs/$name.time")s)"
          else
            echo "✗ $name"
            [ "$status" -ne 0 ] || status=$code
          fi
        fi
      fi
      i=$((i + 1))
    done
    [ "$running" -gt 0 ] || break
    if [ $((SECONDS - last_report)) -ge 15 ]; then
      running=
      i=0
      for name in "$@"; do
        if [ "${done[$i]}" -eq 0 ] && kill -0 "${pids[$i]}" 2>/dev/null; then
          [ -z "$running" ] || running="$running, "
          running="$running$name"
        fi
        i=$((i + 1))
      done
      echo "… still running after $((SECONDS - started))s: $running"
      last_report=$SECONDS
    fi
    sleep 1
  done
  rm -rf "$logs"
  return "$status"
}

suites_for() { # paths on stdin -> suite names
  local frontend=0 server=0 cli=0 desktop=0 scripts=0 path
  while IFS= read -r path; do
    case "$path" in
      src/* | package.json | package-lock.json | tsconfig*.json | vite*.ts | vitest*.ts | .config/*) frontend=1; scripts=1 ;;
      server/*) server=1 ;;
      cli/tasks/*) scripts=1 ;;
      cli/*) cli=1 ;;
      .githooks/*) frontend=1; server=1; cli=1; desktop=1; scripts=1 ;;
      src-tauri/* | kiri/*) desktop=1 ;;
      rust-toolchain.toml) cli=1; desktop=1 ;;
    esac
  done
  ((frontend)) && echo frontend
  ((server)) && echo server
  ((cli)) && echo rust-cli
  ((desktop)) && echo rust-desktop
  ((scripts)) && echo scripts
  return 0
}

all=(frontend scripts server rust-cli rust-desktop)
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
  frontend | scripts | server | rust-cli | rust-desktop | secrets) run "$1" ;;
  *) echo "Usage: .githooks/checks.sh commit|push|all|frontend|scripts|server|rust-cli|rust-desktop|secrets|plan" >&2; exit 2 ;;
esac
