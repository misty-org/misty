#!/bin/sh
# Linux: runs Kiri's WebKitGTK code for real in a container (Docker) under a
# virtual display. Prints KIRI RUNTIME lines. Windows: see run.ps1.
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
docker build -q -t kiri-linux-probe:local "$here" >/dev/null
# Resolve with the exact versions Misty ships.
cp "$repo/src-tauri/Cargo.lock" "$here/Cargo.lock"
# The content filter check loads a page and scripts from these names.
docker run --rm -v "$repo":/repo -v kiri-linux-target:/target \
  --add-host news.example:127.0.0.1 --add-host cdn.example:127.0.0.1 \
  --add-host securepubads.g.doubleclick.net:127.0.0.1 \
  -v kiri-linux-cargo:/usr/local/cargo/registry -e CARGO_TARGET_DIR=/target \
  -w /repo/kiri/probes/runtime kiri-linux-probe:local \
  sh -c 'cargo build -q && dbus-run-session -- xvfb-run -a /target/debug/kiri-runtime-probe 2>&1 | grep -E "KIRI RUNTIME|EVENT|panicked"'
