# Misty patch: respect background webview creation on macOS

Source: crates.io `wry` 0.55.1. Original MIT and Apache-2.0 licenses are retained.

Upstream's macOS constructor unconditionally activates NSApplication for every
new webview, including hidden child views, and ignores `WebViewAttributes.focused`.
This makes sync's website-storage helpers steal focus from the user's active app.

`src/wkwebview/mod.rs` now checks `attributes.focused` before making the main
webview first responder or activating the application. Background helper views
explicitly set `.focused(false)`. Focused window creation remains unchanged.

Regression verification: with another app in front, unlock sync so it opens
its hidden website-storage views; Misty must stay in the background.

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
`server/apps/agent-runtime/evals/odysseys/README.md`), a new sheet at
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

# Misty patch: one incognito session per key on macOS

Upstream keeps one thread-local private data store, so every incognito webview in
the process shares one session. Misty gives each Space its own incognito session:
all of a Space's incognito windows share it, and other Spaces never see it.

`src/wkwebview/mod.rs` now keeps one `nonPersistentDataStore` per session id. An
incognito webview built with a `data_store_identifier` joins the session with that
id (the identifier is never used for a persistent store when `incognito` is set);
one built without an identifier gets a session of its own.
`end_private_session(id)` drops a session once its last window has closed, so the
next incognito window of that Space starts signed out. `extension_private_data_store`
and `reset_private_data_store` are gone: incognito windows have no extension host.

Regression verification: open two incognito windows in one Space and sign in to a
site in one; the other is signed in, an incognito window of another Space is not,
and after closing every incognito window of the first Space a new one starts
signed out.

Remove this patch when upstream supports more than one private session.
