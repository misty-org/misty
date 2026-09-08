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

# Misty patch: let web pages declare their own global `ipc`

Upstream defines `window.ipc` in every page as a read-only, non-configurable
property. A site whose script declares a global function named `ipc` then fails
on that declaration (JavaScript cannot redeclare such a property), and the rest
of its script never runs. Google Sheets does this: in Misty its editor never
started and every control stayed disabled.

`src/wkwebview/mod.rs`, `src/webview2/mod.rs` and `src/webkitgtk/mod.rs` now
define it writable and enumerable, which the language requires for a page's
global function declaration to replace it. Tauri uses `window.ipc` only as a
fallback when its custom-protocol IPC is blocked, so Misty's own windows are
unaffected; on a page that both blocks that protocol and declares `ipc`, Kiri's
page features report an error instead of the whole site failing.

Regression verification: with the browser eval bridge running (see
`server/apps/agent-runtime/evals/browser/README.md`), a new sheet at
`https://docs.google.com/spreadsheets/create` gets its own address and enabled
controls.

Remove this patch when upstream defines the property so pages can redeclare it.


# Misty patch: keep the page canvas under opaque backgrounds on macOS

Upstream disables WebKit's `drawsBackground` whenever a background color is
set, even an opaque one, and applies the color only to the overscroll area.
A site that leaves `html` and `body` without a background (Walmart's account
pages) then showed Misty's dark window through it, while Chrome and Safari
paint their standard white canvas there.

`src/wkwebview/mod.rs` now disables `drawsBackground` only for a transparent
webview or a color with alpha below 255, in the constructor and in
`set_background_color`. The transparent main app webview is unchanged.

Remove this patch when upstream keeps the canvas for opaque colors.
