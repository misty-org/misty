#!/bin/bash

# 1. Setup Usage / Help Check
usage() {
    echo "========================================================"
    echo "MiniDFS Vendor Build Script Usage"
    echo "========================================================"
    echo "Syntax:"
    echo "   ./build_vendors.sh [Configuration]"
    echo ""
    echo "Configurations:"
    echo "   Release        - Optimized build (Default)"
    echo "   Debug          - Build with debug symbols"
    echo "   RelWithDebInfo - Optimized build with symbols"
    echo "========================================================"
    exit 1
}

if [[ "$1" == "/?" || "$1" == "--help" || "$1" == "-h" ]]; then
    usage
fi

# 2. Setup Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 3. Get Configuration (Default to Release)
CONFIG=${1:-Release}

# Validation
if [[ ! "$CONFIG" =~ ^(Release|Debug|RelWithDebInfo)$ ]]; then
    echo "[ERROR] Invalid configuration: $CONFIG"
    usage
fi

MINIDFS_DIR="$ROOT_DIR/vendor/minidfs_sdk/$CONFIG"
GLFW_SRC="$ROOT_DIR/vendor/glfw"
LUNA_SRC="$ROOT_DIR/vendor/lunasvg"
GOOGLE_TEST_SRC="$ROOT_DIR/vendor/googletest"

echo "========================================================"
echo "Pre-compiling Vendors into $MINIDFS_DIR"
echo "Configuration: $CONFIG"
echo "========================================================"

mkdir -p "$MINIDFS_DIR"

# Determine number of processors for parallel build
# (nproc for Linux, sysctl for macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    NUM_PROCS=$(sysctl -n hw.ncpu)
else
    NUM_PROCS=$(nproc)
fi

# --- 3. Build GLFW ---
echo "Building GLFW [$CONFIG]..."
cmake -B "$GLFW_SRC/build_$CONFIG" -S "$GLFW_SRC" \
    -DCMAKE_INSTALL_PREFIX="$MINIDFS_DIR" \
    -DCMAKE_BUILD_TYPE="$CONFIG" \
    -DGLFW_BUILD_DOCS=OFF -DGLFW_INSTALL=ON
cmake --build "$GLFW_SRC/build_$CONFIG" --target install --parallel "$NUM_PROCS"

# --- 4. Build LunaSVG ---
echo "Building LunaSVG [$CONFIG]..."
cmake -B "$LUNA_SRC/build_$CONFIG" -S "$LUNA_SRC" \
    -DCMAKE_INSTALL_PREFIX="$MINIDFS_DIR" \
    -DCMAKE_BUILD_TYPE="$CONFIG" \
    -DLUNASVG_BUILD_SHARED=OFF
cmake --build "$LUNA_SRC/build_$CONFIG" --target install --parallel "$NUM_PROCS"

echo "========================================================"
echo "SUCCESS!"
echo "Configuration : $CONFIG"
echo "Location      : $MINIDFS_DIR"
echo "========================================================"