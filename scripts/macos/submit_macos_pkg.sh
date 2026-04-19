#!/usr/bin/env bash
#
# Notarize and staple the Misty installer pkg.
#
# Input:  release/macos/Misty-<version>.pkg produced by build_macos_pkg.sh
#         (must already be signed with Developer ID Installer).
# Output: same pkg, with the notarization ticket stapled in-place.
#
# Flow:
#   1. notarytool submit --wait -> upload to Apple, block until ticket issues
#   2. stapler staple           -> embed ticket so Gatekeeper works offline
#   3. spctl --assess           -> sanity-check the final artifact
#
# This is intentionally separate from build_macos_pkg.sh so you can open the
# signed pkg first, verify the GUI wizard looks right, and only then burn
# the 1-15 minute round-trip to Apple.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/release/macos/Misty.app"

ENV_FILE="$ROOT/scripts/.signing.env"
[[ -f "$ENV_FILE" ]] || { echo "error: $ENV_FILE missing" >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${NOTARY_PROFILE:?NOTARY_PROFILE must be set in scripts/.signing.env}"

step() { printf "\n==> %s\n" "$1"; }

# --- 1. Locate the pkg ---------------------------------------------------
# Version lives in the .app's Info.plist — single source of truth so the
# two scripts always look at the same filename.
[[ -d "$APP" ]] || { echo "error: $APP missing. Rebuild first." >&2; exit 1; }
VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")"
PKG="$ROOT/release/macos/Misty-${VERSION}.pkg"

[[ -f "$PKG" ]] || {
    echo "error: $PKG not found. Run build_macos_pkg.sh first." >&2
    exit 1
}

# Refuse to submit if the pkg isn't signed — notary will reject it anyway.
if ! pkgutil --check-signature "$PKG" >/dev/null 2>&1; then
    echo "error: $PKG is not signed. Run build_macos_pkg.sh first." >&2
    exit 1
fi

echo "Submitting: $PKG"

# --- 2. Notarize ---------------------------------------------------------
step "Submitting to notary service (this takes 1-15 min)"
xcrun notarytool submit "$PKG" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait

# --- 3. Staple -----------------------------------------------------------
step "Stapling notarization ticket"
xcrun stapler staple "$PKG"
xcrun stapler validate "$PKG"

# --- 4. Final assessment -------------------------------------------------
step "Gatekeeper assessment"
spctl --assess --type install --verbose "$PKG"

echo ""
echo "OK: notarized + stapled pkg at $PKG"
ls -lh "$PKG"
