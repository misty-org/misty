#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  exit 1
fi

target="$1"

if [[ ! -f "$target" ]]; then
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    exec /usr/bin/open "$target"
    ;;
  Linux)
    exec /usr/bin/xdg-open "$target"
    ;;
  *)
    exit 1
    ;;
esac
