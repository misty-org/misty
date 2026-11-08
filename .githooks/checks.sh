#!/usr/bin/env bash
# Local checks for every commit and push (there is no GitHub CI).
#   .githooks/checks.sh commit   suites touched by the staged changes, at most 5 minutes
#   .githooks/checks.sh push     every suite, on a clean tree
#   .githooks/checks.sh all|frontend|scripts|rust-cli|rust-desktop|secrets|plan
#   .githooks/checks.sh release  also compiles for Windows; run it when cutting a release
# Skip once with git commit/push --no-verify.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
# Git exports GIT_DIR and friends to hooks (all of them in a linked
# worktree). Tests that create their own repositories must not inherit them,
# or their git init and config would write to this repository. From the
# checkout root, git finds the same repository without them.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

frontend() { parallel frontend-typecheck frontend-lint frontend-unit frontend-dev-navigation; }
frontend_typecheck() { npm run typecheck; }
frontend_lint() { npm run lint; }
frontend_unit() { MISTY_SHARED_CPU=1 npm test; }
frontend_dev_navigation() { npm run test:dev-navigation; }
# Injected page scripts, the git hooks and the build and release scripts (cli/tasks).
scripts() { npm run test:scripts; }
# Reinstalling takes longer than the tests, so only when the lockfile moved.
packages() { [ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --no-audit --no-fund --silent; }
rust_cli() { cargo test --locked --quiet --tests --manifest-path cli/Cargo.toml; }
# Tests only: compiling for other platforms and building examples wait for a release.
rust_desktop() { parallel desktop-crate base-crates browser-data-crate agent-crate kiri-crate desktop-workers; }
desktop_crate() { cargo test --locked --quiet --tests --manifest-path src-tauri/Cargo.toml; }
# The desktop crate compiles for Windows too, and every example with it. Not part of a
# commit or push: compiling is for cutting a release, which runs this through `release`.
desktop_windows() {
  case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) echo "Covered by desktop-crate on Windows."; return 0 ;; esac
  if ! cargo xwin --version >/dev/null 2>&1; then
    echo "cargo-xwin is required to check the Windows build: cargo install --locked cargo-xwin" >&2
    echo "and rustup target add x86_64-pc-windows-msvc" >&2
    return 1
  fi
  cargo xwin check --locked --quiet --all-targets --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
  cargo xwin check --locked --quiet --all-targets --target x86_64-pc-windows-msvc --manifest-path cli/Cargo.toml
}
# The crates the app builds on: the file gate, the database and documents. Each is its own Cargo project.
base_crates() {
  local crate
  for crate in file_access database documents; do
    cargo test --locked --quiet --tests --manifest-path "src-tauri/features/$crate/Cargo.toml"
  done
}
browser_data_crate() { cargo test --locked --quiet --tests --manifest-path src-tauri/features/sync/browser_data/Cargo.toml; }
agent_crate() {
  cargo test --locked --quiet --tests --manifest-path src-tauri/features/browser/page_text/Cargo.toml
  cargo test --locked --quiet --tests --manifest-path src-tauri/features/agents/runs/Cargo.toml
}
# Kiri's core tests need no Tauri; the desktop crate builds its native side.
kiri_crate() { cargo test --locked --quiet --tests --no-default-features --manifest-path src-tauri/features/kiri/Cargo.toml; }
# The workers the app embeds: each is its own Cargo project, because it runs in an OS sandbox and can't link Tauri.
desktop_workers() {
  local manifest
  for manifest in src-tauri/features/documents/worker/Cargo.toml src-tauri/features/browser/page_text/worker/Cargo.toml src-tauri/features/agents/shell/worker/Cargo.toml; do
    cargo test --locked --quiet --tests --manifest-path "$manifest"
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

# Asks a suite to stop so it can clean up, then insists: nothing may hold a commit past its limit.
stop_group() {
  local waited=0
  kill -TERM -- "-$1" 2>/dev/null || true
  while kill -0 -- "-$1" 2>/dev/null && [ "$waited" -lt 10 ]; do
    sleep 0.5
    waited=$((waited + 1))
  done
  kill -KILL -- "-$1" 2>/dev/null || true
}

# One suite at a time, cheapest first: a failure shows up early, and the machine isn't running
# everything at once. With a limit, a suite still going when it's reached is stopped and left to
# the push, which runs them all. A commit never waits longer, and a failure still refuses it.
sequence() { # seconds (0 for no limit), then suite names
  local limit=$1 started=$SECONDS name pid code unfinished=
  shift
  for name in "$@"; do
    if [ "$limit" -gt 0 ] && [ $((SECONDS - started)) -ge "$limit" ]; then
      unfinished="$unfinished $name"
      continue
    fi
    # Its own process group, so stopping it stops everything it started.
    set -m
    run "$name" &
    pid=$!
    set +m
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$limit" -gt 0 ] && [ $((SECONDS - started)) -ge "$limit" ]; then
        stop_group "$pid"
        unfinished="$unfinished $name"
        break
      fi
      sleep 0.2
    done
    case "$unfinished " in *" $name "*) continue ;; esac
    code=0
    wait "$pid" || code=$?
    [ "$code" -eq 0 ] || return "$code"
  done
  if [ -n "$unfinished" ]; then
    echo "⚠ Stopped at the ${limit}s limit, so these weren't fully checked:$unfinished. The push runs them."
  fi
}

suites_for() { # paths on stdin -> suite names
  local frontend=0 cli=0 desktop=0 scripts=0 path
  while IFS= read -r path; do
    case "$path" in
      src/* | package.json | package-lock.json | tsconfig*.json | vite*.ts | vitest*.ts | .config/*) frontend=1; scripts=1 ;;
      cli/tasks/*) scripts=1 ;;
      cli/*) cli=1 ;;
      .githooks/*) frontend=1; cli=1; desktop=1; scripts=1 ;;
      src-tauri/*) desktop=1 ;;
      rust-toolchain.toml) cli=1; desktop=1 ;;
    esac
  done
  ((scripts)) && echo scripts
  ((cli)) && echo rust-cli
  ((desktop)) && echo rust-desktop
  ((frontend)) && echo frontend
  return 0
}

all=(scripts rust-cli rust-desktop frontend)
# A commit takes at most 5 minutes, secret scan and all, leaving a little for git itself.
commit_seconds=${MISTY_COMMIT_SECONDS:-285}
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
    # What's left of the limit. Never 0, which would mean no limit at all.
    remaining=$((commit_seconds - SECONDS))
    [ "$remaining" -gt 0 ] || remaining=1
    # shellcheck disable=SC2086 # one suite name per word
    sequence "$remaining" $suites
    ;;
  push)
    # Tests run on the working tree, so it must match what is being pushed.
    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
      echo "Commit or discard local changes before pushing; checks must run on the pushed commit." >&2
      exit 1
    fi
    sequence 0 secrets "${all[@]}"
    ;;
  all) sequence 0 secrets "${all[@]}" ;;
  release) sequence 0 secrets "${all[@]}" desktop-windows ;;
  frontend | scripts | rust-cli | rust-desktop | desktop-windows | secrets) run "$1" ;;
  *) echo "Usage: .githooks/checks.sh commit|push|all|release|frontend|scripts|rust-cli|rust-desktop|desktop-windows|secrets|plan" >&2; exit 2 ;;
esac
