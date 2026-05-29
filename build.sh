#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MISTY_DIR="$ROOT/misty"
PROXY_DIR="$ROOT/misty-proxy"
HUB_DIR="$ROOT/misty-hub"

MISTY_BUILD_DIR="${MISTY_BUILD_DIR:-$MISTY_DIR/build/release}"
RCLONE_SOURCE_DIR="${MISTY_RCLONE_SOURCE:-}"
RCLONE_OUTPUT_PATH="${MISTY_RCLONE_OUTPUT:-$HOME/.misty/rclone/rclone}"
GOFLAGS_EXTRA="${GOFLAGS_EXTRA:-}"

usage() {
    cat <<'EOF'
Usage:
  ./misty-scripts/build.sh [target...]

Targets:
  misty         Configure and build the Misty desktop app
  proxy         Build misty-proxy
  hub           Build the misty-hub frontend and Tauri app
  rclone        Build your custom rclone into ~/.misty/rclone/rclone
  all           Build everything above

Examples:
  ./misty-scripts/build.sh all
  ./misty-scripts/build.sh misty proxy
  MISTY_RCLONE_SOURCE=/path/to/rclone ./misty-scripts/build.sh rclone

Optional environment variables:
  MISTY_BUILD_DIR      Override the Misty CMake build directory
  MISTY_RCLONE_SOURCE  Path to your custom rclone checkout
  MISTY_RCLONE_OUTPUT  Output path for the built rclone binary
  GOFLAGS_EXTRA        Extra flags appended to Go build commands
EOF
}

step() {
    printf '\n==> %s\n' "$1"
}

fail() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

jobs() {
    if command -v sysctl >/dev/null 2>&1; then
        sysctl -n hw.ncpu
        return
    fi
    if command -v nproc >/dev/null 2>&1; then
        nproc
        return
    fi
    printf '4\n'
}

require_dir() {
    [[ -d "$1" ]] || fail "missing directory: $1"
}

build_misty() {
    require_dir "$MISTY_DIR"
    step "Building misty"
    cmake -S "$MISTY_DIR" -B "$MISTY_BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
    cmake --build "$MISTY_BUILD_DIR" -j"$(jobs)"
}

build_proxy() {
    require_dir "$PROXY_DIR"
    step "Building misty-proxy"
    (
        cd "$PROXY_DIR"
        mkdir -p dist
        go build ${GOFLAGS_EXTRA} -o dist/misty-proxy .
    )
}

build_hub() {
    require_dir "$HUB_DIR"
    step "Building misty-hub"
    (
        cd "$HUB_DIR"
        npm run build
        cargo build --manifest-path src-tauri/Cargo.toml
    )
}

build_rclone() {
    [[ -n "$RCLONE_SOURCE_DIR" ]] || fail "set MISTY_RCLONE_SOURCE to your rclone checkout before building rclone"
    require_dir "$RCLONE_SOURCE_DIR"
    step "Building custom rclone"
    mkdir -p "$(dirname "$RCLONE_OUTPUT_PATH")"
    (
        cd "$RCLONE_SOURCE_DIR"
        go build ${GOFLAGS_EXTRA} -o "$RCLONE_OUTPUT_PATH" .
    )
}

run_target() {
    case "$1" in
        misty) build_misty ;;
        proxy) build_proxy ;;
        hub) build_hub ;;
        rclone) build_rclone ;;
        all)
            build_misty
            build_proxy
            build_hub
            build_rclone
            ;;
        -h|--help|help) usage ;;
        *) fail "unknown target: $1" ;;
    esac
}

main() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 1
    fi

    for target in "$@"; do
        run_target "$target"
    done
}

main "$@"
