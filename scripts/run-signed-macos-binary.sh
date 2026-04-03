#!/bin/zsh

set -euo pipefail

executable="${1:-}"
if [[ -z "${executable}" ]]; then
  print -u2 "The macOS development runner did not receive an executable path."
  exit 2
fi
shift

identity="${MISTY_MACOS_DEV_SIGNING_IDENTITY:-}"
if [[ -z "${identity}" ]]; then
  identity_output="$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null || true)"
  identity="$(print -r -- "${identity_output}" | /usr/bin/awk -F '"' '/"Apple Development:/{ print $2; exit }')"
  if [[ -z "${identity}" ]]; then
    identity="$(print -r -- "${identity_output}" | /usr/bin/awk -F '"' '/"Developer ID Application:/{ print $2; exit }')"
  fi
fi

if [[ -n "${identity}" ]]; then
  /usr/bin/codesign \
    --force \
    --sign "${identity}" \
    --identifier com.misty.desktop \
    --timestamp=none \
    "${executable}"
else
  print -u2 "No Apple Development identity was found. Misty will run ad-hoc signed, so macOS Keychain may ask again after rebuilds."
  /usr/bin/codesign \
    --force \
    --sign - \
    --identifier com.misty.desktop \
    --timestamp=none \
    "${executable}"
fi

# Replace this runner process with Misty instead of spawning a child. Cargo and
# Tauri can now stop the actual app process during rebuilds, so it cannot be
# orphaned behind a terminated wrapper.
exec "${executable}" "$@"
