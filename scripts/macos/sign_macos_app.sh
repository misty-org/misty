#!/usr/bin/env bash
#
# Codesign release/macos/Misty.app for Developer ID distribution.
#
# Signs every Mach-O binary inside the bundle first (restic, misty-bin,
# misty-proxy, misty-pwd-helper, any .dylibs), then signs the bundle
# itself with hardened runtime + secure timestamp, using the entitlements
# at release/macos/Misty.entitlements.
#
# Reads DEVELOPER_ID from scripts/.signing.env. Run build_macos_app.sh first.
#
# After this, the app is ready to be packaged into a DMG (next script).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/release/macos/Misty.app"
ENTITLEMENTS="$ROOT/release/macos/Misty.entitlements"
SIGNING_CONF="$ROOT/scripts/.signing.env"

step() { printf "\n==> %s\n" "$1"; }

# --- 1. Load signing config -----------------------------------------------
if [[ ! -f "$SIGNING_CONF" ]]; then
    echo "error: $SIGNING_CONF does not exist." >&2
    echo "Copy scripts/.signing.env.example to scripts/.signing.env and fill it in." >&2
    exit 1
fi
# shellcheck disable=SC1090
source "$SIGNING_CONF"

if [[ -z "${DEVELOPER_ID:-}" ]]; then
    echo "error: DEVELOPER_ID not set in $SIGNING_CONF" >&2
    exit 1
fi

# --- 2. Preflight ---------------------------------------------------------
[[ -d "$APP" ]] || { echo "error: $APP missing. Run build_macos_app.sh first." >&2; exit 1; }
[[ -f "$ENTITLEMENTS" ]] || { echo "error: $ENTITLEMENTS missing." >&2; exit 1; }

# Confirm the cert is actually in the keychain before we start.
if ! security find-identity -v -p codesigning | grep -qF "$DEVELOPER_ID"; then
    echo "error: signing identity not found in keychain:" >&2
    echo "  $DEVELOPER_ID" >&2
    echo "Run: security find-identity -v -p codesigning" >&2
    exit 1
fi

# --- 3. Sign every Mach-O inside (inside-out order) -----------------------
# codesign requires leaves signed before their containing bundles. Running
# over all Mach-O files first, then the .app itself, satisfies that order
# for a flat-MacOS-dir layout like ours.
step "Signing inner Mach-O binaries"
# shellcheck disable=SC2016
while IFS= read -r -d '' f; do
    if file "$f" | grep -q "Mach-O"; then
        echo "  sign: ${f#$APP/}"
        codesign --force --timestamp --options runtime \
            --sign "$DEVELOPER_ID" "$f"
    fi
done < <(find "$APP" -type f -print0)

# --- 4. Sign the main executable (script or binary) -----------------------
# CFBundleExecutable points to our launcher, which is currently a bash
# script. Non-Mach-O files were skipped by the Mach-O loop above, but the
# bundle still needs its main executable signed before codesign will seal
# the outer .app. Read the name from Info.plist so renames don't break us.
# Shell scripts don't support hardened runtime — omit --options runtime.
MAIN_EXEC_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
MAIN_EXEC="$APP/Contents/MacOS/$MAIN_EXEC_NAME"
[[ -e "$MAIN_EXEC" ]] || { echo "error: CFBundleExecutable missing: $MAIN_EXEC" >&2; exit 1; }

if ! file "$MAIN_EXEC" | grep -q "Mach-O"; then
    step "Signing main executable (script): $MAIN_EXEC_NAME"
    codesign --force --timestamp --sign "$DEVELOPER_ID" "$MAIN_EXEC"
fi

# --- 5. Sign the bundle ---------------------------------------------------
step "Signing bundle"
codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$DEVELOPER_ID" "$APP"

# --- 6. Verify ------------------------------------------------------------
step "Verifying signature"
codesign --verify --deep --strict --verbose=2 "$APP"

step "Gatekeeper assessment (pre-notarization)"
# spctl will say "rejected: source=Unnotarized Developer ID" at this stage —
# that's expected. We're checking that the *signature* itself is valid, not
# that it's notarized yet.
if spctl --assess --type execute --verbose "$APP" 2>&1 | tee /tmp/misty-spctl.log; then
    echo "  (fully accepted — already notarized?)"
else
    if grep -q "Unnotarized Developer ID" /tmp/misty-spctl.log; then
        echo "  OK: signed with Developer ID, pending notarization (expected)."
    else
        echo "  error: Gatekeeper rejected for a reason other than notarization." >&2
        exit 1
    fi
fi
rm -f /tmp/misty-spctl.log

echo ""
echo "OK: signed $APP"
