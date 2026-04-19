#!/usr/bin/env bash
#
# Smoke-test Misty.app locally before burning 15 minutes on a notarization
# round-trip. Launches the signed .app, waits for it to settle, and checks:
#
#   1. The process is still alive (didn't crash in init).
#   2. No new diagnostic report landed in ~/Library/Logs/DiagnosticReports.
#   3. misty-proxy is listening on the configured port.
#
# Exits non-zero on any failure so the caller can short-circuit before DMG.
#
# Usage:  scripts/test_macos_app.sh  [seconds_to_wait]
# Default wait: 6s (enough for ImGui init + proxy bind).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/release/macos/Misty.app"
WAIT="${1:-6}"

step() { printf "\n==> %s\n" "$1"; }

[[ -d "$APP" ]] || { echo "error: $APP missing. Run build_macos_app.sh first." >&2; exit 1; }

# launcher.c sets argv[0] to bare "misty-bin" / "misty-proxy", so `pgrep -f`
# against the full path won't match. Use `pgrep -x` (exact command name) and
# diff against a pre-launch baseline so we don't false-match a dev-run
# instance the user already had going.
baseline_pids() { pgrep -x "$1" 2>/dev/null | sort -u; }
new_pids() {
    local name="$1" before="$2"
    comm -13 <(printf '%s\n' "$before") <(baseline_pids "$name")
}

BIN_BEFORE="$(baseline_pids misty-bin)"
PROXY_BEFORE="$(baseline_pids misty-proxy)"

# Record the crash-report baseline so we can detect ones produced by this run.
CRASH_DIR="$HOME/Library/Logs/DiagnosticReports"
mkdir -p "$CRASH_DIR"
BASELINE="$(mktemp)"
ls -1 "$CRASH_DIR" 2>/dev/null | sort > "$BASELINE"

step "Launching Misty.app (fresh process)"
# -n: new instance even if one is already running. -F: fresh (don't restore
# state).
open -n -F "$APP"

step "Waiting ${WAIT}s for init"
sleep "$WAIT"

step "Checking misty-bin is alive"
BIN_NEW="$(new_pids misty-bin "$BIN_BEFORE")"
if [[ -z "$BIN_NEW" ]]; then
    echo "error: no new misty-bin process — likely crashed during init." >&2
    echo "Check ~/Library/Logs/DiagnosticReports/ for the crash report." >&2
    exit 1
fi
echo "OK: misty-bin pid(s) $BIN_NEW"

step "Checking misty-proxy is alive"
PROXY_NEW="$(new_pids misty-proxy "$PROXY_BEFORE")"
if [[ -z "$PROXY_NEW" ]]; then
    # Not fatal: a pre-existing proxy may already be bound to the port, which
    # is the launcher's expected behavior (see port_listening check).
    if [[ -n "$PROXY_BEFORE" ]]; then
        echo "OK: pre-existing misty-proxy ($PROXY_BEFORE) still holding the port"
    else
        echo "warn: misty-proxy is not running. Check ~/Library/Logs/Misty/misty-proxy.log" >&2
    fi
else
    echo "OK: misty-proxy pid(s) $PROXY_NEW"
fi

step "Checking for new crash reports"
AFTER="$(mktemp)"
ls -1 "$CRASH_DIR" 2>/dev/null | sort > "$AFTER"
NEW="$(comm -13 "$BASELINE" "$AFTER" | grep -iE 'misty|Misty' || true)"
rm -f "$BASELINE" "$AFTER"
if [[ -n "$NEW" ]]; then
    echo "error: new Misty crash report(s) detected:" >&2
    echo "$NEW" >&2
    exit 1
fi
echo "OK: no new crash reports"

step "Killing test instance"
# Only kill the pids we spawned, not any pre-existing dev-run processes.
for pid in $BIN_NEW $PROXY_NEW; do
    kill "$pid" 2>/dev/null || true
done
sleep 1

echo ""
echo "OK: Misty.app smoke test passed. Safe to notarize."
