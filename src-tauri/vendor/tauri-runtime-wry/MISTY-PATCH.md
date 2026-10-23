# Misty patch: hold messages that arrive while a webview is created

Source: crates.io `tauri-runtime-wry` 2.11.3. Original MIT and Apache-2.0 licenses are retained.

Upstream builds a webview while holding the `WebContext` store's lock, and on
Windows WebView2 creation pumps the thread's messages until the view is ready.
Tauri's own queued messages are dispatched inside that pump. When one of them
creates or closes another webview (a tab's `add_child` from a command, a
companion window, a tab closing), it takes the same lock on the same thread and
the UI thread waits on itself: every Misty window stops responding.

It happened when an extension opened tabs at startup: a page asked for a popup,
Misty built the popup window on the UI thread, and the new tab's creation
arrived in that popup's pump.

`src/lib.rs` now counts creations running on the UI thread (`creation_hold`).
While one runs, a runtime message the event loop dispatches is held instead of
handled, and so is a create or close that main-thread code sends directly.
Held messages are handled, in the order they arrived, as soon as the creation
finishes. Callers on other threads only wait a little longer; main-thread
getters that need a reply are never held.

Regression verification: on Windows, install an extension whose
`runtime.onInstalled` calls `chrome.tabs.create` twice with an extension page
and a website (for example "Ultimate Car Driving Game"), then restart Misty. The
window stays responsive and the website opens as a tab.

Remove this patch when upstream stops dispatching its messages inside a
webview's creation, or releases the `WebContext` lock before WebView2 pumps.
