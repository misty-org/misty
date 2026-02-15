#!/usr/bin/env bash
#
# Build and sign the Misty macOS installer package.
#
# Input:  release/macos/Misty.app (must already be built + codesigned by
#         build_macos_app.sh + sign_macos_app.sh).
# Output: release/macos/Misty-<version>.pkg (signed, NOT yet notarized).
#
# Flow:
#   1. pkgbuild   -> component pkg (the .app payload + postinstall script)
#   2. productbuild --distribution -> distribution pkg (adds the GUI wizard)
#   3. productsign -> signs with Developer ID Installer
#
# After this, open the .pkg to preview the installer UI locally. When you're
# happy with it, run submit_macos_pkg.sh to notarize + staple.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/release/macos/Misty.app"
PKG_DIR="$ROOT/release/macos/pkg"
BUILD_DIR="$ROOT/release/macos/pkg/build"
IDENTIFIER="com.misty.app"

ENV_FILE="$ROOT/scripts/.signing.env"
[[ -f "$ENV_FILE" ]] || { echo "error: $ENV_FILE missing (copy .signing.env.example)" >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${INSTALLER_ID:?INSTALLER_ID must be set in scripts/.signing.env}"

step() { printf "\n==> %s\n" "$1"; }

# --- 1. Preflight ---------------------------------------------------------
[[ -d "$APP" ]] || { echo "error: $APP missing. Run build_macos_app.sh." >&2; exit 1; }

# Confirm the .app was signed. An unsigned .app inside a signed pkg still
# installs but fails Gatekeeper on launch — cheapest to catch here.
if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
    echo "error: $APP is not signed. Run sign_macos_app.sh first." >&2
    exit 1
fi

# Version comes from the .app's Info.plist so pkg version tracks the app.
VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")"
[[ -n "$VERSION" ]] || { echo "error: could not read CFBundleShortVersionString" >&2; exit 1; }
PKG_OUT="$ROOT/release/macos/Misty-${VERSION}.pkg"
COMPONENT_PKG="$BUILD_DIR/Misty-component.pkg"
UNSIGNED_PKG="$BUILD_DIR/Misty-${VERSION}-unsigned.pkg"

# --- 2. Stage payload -----------------------------------------------------
# pkgbuild mirrors --root to --install-location. Putting Misty.app at the
# root of the staging dir + --install-location /Applications makes it land
# at /Applications/Misty.app.
step "Staging payload"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/payload"
# ditto preserves extended attributes and symlinks (cp -R on Macs can lose
# resource forks / hardlink structure in .app bundles).
ditto "$APP" "$BUILD_DIR/payload/Misty.app"

# --- 3. Component pkg ----------------------------------------------------
step "Building component pkg"
pkgbuild \
    --root "$BUILD_DIR/payload" \
    --identifier "$IDENTIFIER" \
    --version "$VERSION" \
    --install-location "/Applications" \
    --scripts "$PKG_DIR/scripts" \
    "$COMPONENT_PKG"

# --- 4. Distribution pkg -------------------------------------------------
# --package-path: where productbuild looks up the <pkg-ref> names referenced
# in distribution.xml. --resources: where it finds welcome/license/conclusion.
step "Building distribution pkg"
productbuild \
    --distribution "$PKG_DIR/distribution.xml" \
    --package-path "$BUILD_DIR" \
    --resources "$PKG_DIR/resources" \
    "$UNSIGNED_PKG"

# --- 5. Sign -------------------------------------------------------------
step "Signing pkg with $INSTALLER_ID"
productsign --sign "$INSTALLER_ID" "$UNSIGNED_PKG" "$PKG_OUT"

# Verify the signature before we call it done.
pkgutil --check-signature "$PKG_OUT" >/dev/null || {
    echo "error: pkg signature failed to verify" >&2
    exit 1
}

echo ""
echo "OK: signed pkg at $PKG_OUT"
ls -lh "$PKG_OUT"
echo ""
echo "Preview locally:   open \"$PKG_OUT\""
echo "Ship when happy:   ./scripts/macos/submit_macos_pkg.sh"
