# Integration OAuth popup repair

## Findings

- The native handler preserved WebKit's target configuration and cookie store, but emitted `misty://browser-popup` for every popup. The host converted those events to Browser tabs. Integration sign-in consequently left its originating app.
- Wry 0.55.1 supplies `createWebViewWithConfiguration` but omits `WKUIDelegate.webViewDidClose`. OAuth pages that call `window.close()` need that native callback to release their sign-in window.
- `reveal_main_window` required Tauri's `WebviewWindow` command argument. Tauri rejects that argument when the main window already contains child webviews, matching the screenshot's initialization error.

## Changes

The shared native popup handler now distinguishes integration-owned popups from ordinary Browser popups using the originating native session, including nested popup ownership. Integration popups use attached auxiliary windows and the exact WebKit-provided configuration, opener, and account data store. No Browser-tab event is emitted, and popup creation failure cannot fall back to a new Browser account context.

A same-layout subclass of the popup's Wry UI delegate adds the native close callback while preserving Wry's existing popup and file-dialog behavior. The delegate is reassigned so WebKit refreshes its cached optional selectors. Destruction is queued outside the WebKit delegate callback. Session records, close handlers, and nested windows are released on close or when the originating integration/account closes.

Workspace-wide hide and overlay stacking only operate on views in the main window, so they cannot hide or reparent an auxiliary sign-in window. Ordinary Browser popups keep their existing tab-adoption path. Domain admission and OAuth callback matching rules remain unchanged.

Main-window readiness accepts the invoking `Webview` rather than requiring a single-view window.

## Verification

- 37 existing tests passed across native browser backend/adoption, popup routing, and desktop window readiness.
- Host TypeScript check and the desktop binary build passed.
- A disposable native macOS/WebKit harness passed for both X and Messenger session policies. It exercised two isolated account stores and two loopback origins, checking opener continuity, cookies/local storage, a cross-origin redirect, `postMessage` callback, `window.close()`, retained source view/draft, nested-popup cleanup, absence of Browser-tab events, ordinary Browser popup events, and main-window reveal with multiple webviews.
- The signed-provider test harness now checks attached native windows and their close behavior instead of attempting to adopt authentication into a workspace tab.

Run the native fixture from the host repository:

```sh
MISTY_SDK_PROBE_OAUTH_POPUPS=1 MISTY_SDK_PROBE_TIMEOUT_SECONDS=120 node scripts/sdk-package-probe-run.mjs chat ../misty-apps
```

The runner uses temporary installation and profile roots; this fixture uses synthetic loopback pages and does not access real provider credentials. Passing it verifies popup mechanics, not successful login to live X, Messenger, or their identity providers. Native changes require restarting the rebuilt desktop app.
