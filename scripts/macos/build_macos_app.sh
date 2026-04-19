#!/usr/bin/env bash
#
# Build and stage Misty.app for macOS.
#
# Re-runs the client + proxy builds, then copies fresh binaries and runtime
# assets into release/macos/Misty.app. Template files that live in the .app
# (Info.plist, AppIcon.icns, the launcher script, the bundled misty.env seed)
# are preserved — this script only replaces what comes from a build or from
# client/assets.
#
# Run from anywhere; the script resolves paths relative to the repo root.
#
# Output: release/macos/Misty.app ready for codesigning (next script).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/release/macos/Misty.app"
MACOS_DIR="$APP/Contents/MacOS"
RES_DIR="$APP/Contents/Resources"
ASSETS_DIR="$RES_DIR/assets"

step() { printf "\n==> %s\n" "$1"; }

# --- 1. Build client (ImGui GUI) ------------------------------------------
step "Building client (misty)"
if [[ ! -d "$ROOT/client/build" ]]; then
    echo "error: $ROOT/client/build does not exist. Run cmake first:" >&2
    echo "  cmake -S $ROOT/client -B $ROOT/client/build" >&2
    exit 1
fi
cmake --build "$ROOT/client/build" --target misty

# --- 2. Build proxy (misty-proxy only) ------------------------------------
# Use the `release` target: -trimpath + -ldflags="-s -w" drops DWARF and
# symbol tables, cutting ~30% off the bundled proxy. Dev builds use the
# plain `build` target and keep symbols for stack traces.
step "Building proxy (misty-proxy, release)"
make -C "$ROOT/proxy" release

# --- 2b. Build the native launcher ----------------------------------------
# Tiny C binary used as CFBundleExecutable. A native Mach-O main executable
# is required for notarization; a shell script won't pass.
step "Building launcher (Contents/MacOS/Misty)"
LAUNCHER_SRC="$ROOT/release/macos/launcher.c"
LAUNCHER_OUT="$ROOT/release/macos/launcher.bin"
[[ -f "$LAUNCHER_SRC" ]] || { echo "error: $LAUNCHER_SRC missing" >&2; exit 1; }
cc -O2 -Wall -Wextra -mmacosx-version-min=12.0 \
    -o "$LAUNCHER_OUT" "$LAUNCHER_SRC"

# --- 3. Verify .app template exists ---------------------------------------
if [[ ! -d "$APP" ]]; then
    echo "error: $APP does not exist." >&2
    echo "The .app template (Info.plist, launcher, AppIcon) must be in place." >&2
    exit 1
fi
for required in \
    "$APP/Contents/Info.plist" \
    "$RES_DIR/AppIcon.icns" \
    "$ASSETS_DIR/misty.env" \
    "$ROOT/client/misty.conf"
do
    [[ -e "$required" ]] || { echo "error: template file missing: $required" >&2; exit 1; }
done

# --- 4. Stage binaries ----------------------------------------------------
# Vault (restic + misty-pwd-helper) is treated as a plugin, not core — not
# bundled. The proxy already handles their absence gracefully (vault routes
# return "restic unavailable").
step "Staging binaries"
install -m 0755 "$ROOT/client/build/bin/misty"  "$MACOS_DIR/misty-bin"
install -m 0755 "$ROOT/proxy/dist/misty-proxy"  "$MACOS_DIR/misty-proxy"
install -m 0755 "$LAUNCHER_OUT"                 "$MACOS_DIR/Misty"

# If an older build left these around, scrub them.
rm -f "$MACOS_DIR/misty-pwd-helper" "$MACOS_DIR/restic"

# --- 4b. Bundle Homebrew dylibs into Contents/Frameworks ------------------
# misty-bin links against grpc, protobuf, abseil, openssl, etc. from
# /opt/homebrew — paths that don't exist on user machines and are signed
# by the Homebrew team (wrong Team ID for Gatekeeper anyway). dylibbundler
# recursively copies each dep into Contents/Frameworks and rewrites the
# binary's install names to @executable_path/../Frameworks, making the
# bundle self-contained. The proxy is a static Go binary, so skip it.
if ! command -v dylibbundler >/dev/null; then
    echo "error: dylibbundler not installed. Run: brew install dylibbundler" >&2
    exit 1
fi

FRAMEWORKS_DIR="$APP/Contents/Frameworks"
step "Bundling Homebrew dylibs into Contents/Frameworks"
# -od/-of: overwrite dir and files; -cd: create if missing; -b: bundle deps
# recursively; -x/-d/-p: target binary, destination, install-name prefix.
dylibbundler -od -of -cd -b \
    -x "$MACOS_DIR/misty-bin" \
    -d "$FRAMEWORKS_DIR" \
    -p "@executable_path/../Frameworks/"

# Sanity-check: misty-bin should no longer reference any /opt/homebrew path.
if otool -L "$MACOS_DIR/misty-bin" | grep -q "/opt/homebrew"; then
    echo "error: misty-bin still references /opt/homebrew after bundling:" >&2
    otool -L "$MACOS_DIR/misty-bin" | grep "/opt/homebrew" >&2
    exit 1
fi

# --- 5. Stage runtime assets ----------------------------------------------
# rsync --delete scrubs stale files (commands.msy, icons.msy, redirect.html,
# sprites/, logo/) that were hand-added to the bundle but aren't in source.
# misty.env is the bundled seed — preserve it; misty.conf is copied to the
# Resources root below (not under assets/) because misty-bin opens it via
# std::ifstream("misty.conf") relative to cwd, and the launcher cd's to
# Contents/Resources/ before exec'ing misty-bin.
step "Staging runtime assets from client/assets"
mkdir -p "$ASSETS_DIR"
rsync -a --delete \
    --exclude 'misty.env' \
    --exclude 'misty.conf' \
    "$ROOT/client/assets/" "$ASSETS_DIR/"
install -m 0644 "$ROOT/client/misty.conf" "$RES_DIR/misty.conf"
# Clean up any stale copy from the old layout.
rm -f "$ASSETS_DIR/misty.conf"

# --- 6. Drop orphaned proxy-icloud ----------------------------------------
# iCloud has been migrated to rclone; the old Python proxy is dead weight.
if [[ -d "$RES_DIR/proxy-icloud" ]]; then
    step "Removing orphaned proxy-icloud (migrated to rclone)"
    rm -rf "$RES_DIR/proxy-icloud"
fi

# If an older layout left assets under Contents/MacOS/assets, scrub it so
# codesign doesn't choke on resources living alongside binaries.
if [[ -d "$MACOS_DIR/assets" ]]; then
    step "Removing legacy Contents/MacOS/assets (moved to Resources/assets)"
    rm -rf "$MACOS_DIR/assets"
fi

# --- 7. Sanity check ------------------------------------------------------
step "Verifying bundle layout"
for f in \
    "$MACOS_DIR/Misty" \
    "$MACOS_DIR/misty-bin" \
    "$MACOS_DIR/misty-proxy" \
    "$ASSETS_DIR/misty.env" \
    "$RES_DIR/misty.conf" \
    "$APP/Contents/Info.plist" \
    "$RES_DIR/AppIcon.icns"
do
    [[ -e "$f" ]] || { echo "error: missing after stage: $f" >&2; exit 1; }
done

# Confirm the Mach-O binaries are real executables for this arch.
for bin in Misty misty-bin misty-proxy; do
    if ! file "$MACOS_DIR/$bin" | grep -q Mach-O; then
        echo "error: $bin is not a Mach-O binary" >&2
        exit 1
    fi
done

echo ""
echo "OK: staged Misty.app at $APP"
du -sh "$APP"
