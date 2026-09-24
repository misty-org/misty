# Misty patch: respect background webview creation on macOS

Source: crates.io `wry` 0.55.1. Original MIT and Apache-2.0 licenses are retained.

Upstream's macOS constructor unconditionally activates NSApplication for every
new webview, including hidden child views, and ignores `WebViewAttributes.focused`.
This makes sync's website-storage helpers steal focus from the user's active app.

`src/wkwebview/mod.rs` now checks `attributes.focused` before making the main
webview first responder or activating the application. Background helper views
explicitly set `.focused(false)`. Focused window creation remains unchanged.

Regression verification: run the SDK package probe with
`MISTY_SDK_PROBE_SYNC_STORAGE=1`, `MISTY_SDK_PROBE_APP=browser`, and
`MISTY_SDK_PROBE_ORIGIN=http://127.0.0.1:5178` against the local Vite server.
It verifies native storage transfer and that the hidden test app stays inactive.

Remove this patch when the upstream macOS backend honors this focus attribute.
