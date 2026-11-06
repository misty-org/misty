# Browser security

Misty renders pages with the OS webview (WKWebView, WebView2, WebKitGTK) through Tauri, with no
Chromium or Gecko of its own. This is where the browser's security boundaries stand, from a code
audit on 2026-11-05. The app was not run for it and it was not a penetration test. Extension
permission checks, vault encryption, deep links and the server were not audited. To report a
problem, see [SECURITY.md](../../SECURITY.md).

## Open problems

Most serious first.

1. **The app has no OS sandbox.** `src-tauri/Entitlements.plist` has no App Sandbox, so a bug in
   the main process or the app's own windows runs with the person's full user rights.
2. **The agent runtime isn't confined.** The Node process started by
   `src-tauri/src/infra/agent_runtime/mod.rs` handles untrusted web content with full user rights,
   while document parsing is sandboxed. The same file honors `MISTY_AGENT_RUNTIME_NODE` and
   `MISTY_AGENT_RUNTIME_ENTRY` in release builds and falls back to a Node found on the computer.
3. **Sites can detect Misty.** `window.__TAURI_INTERNALS__` and `window.__MISTY_PASSWORDS__` are
   visible to every page, though the user agent presents as Safari.
4. **Kiri may trust an iframe as its parent page on Windows.** `kiri/src/plugin.rs` identifies the
   caller by the tab's top-level URL, and `src-tauri/src/shell_plugins.rs` notes that WebView2 also
   injects scripts into subframes. Whether Tauri's IPC reaches cross-origin frames there is
   unverified. The impact is low while `media` is the only capability on Windows, so check this
   before adding another.

## What holds

| Boundary | What protects it | Code |
| --- | --- | --- |
| Websites reaching app commands | Tauri rejects remote origins with no permission entry, and a per-window allowlist sits on top | `src-tauri/src/platform/app_command_policy.rs` |
| Plugin access | Website tabs get only `kiri:default`, and a test checks the other capabilities don't reach them | `src-tauri/capabilities/` |
| Local files | A custom `asset:` handler refuses website tabs, which Tauri's own handler does not | `src-tauri/src/platform/asset_protocol.rs` |
| Navigation | App windows stay on bundled pages; tabs load only http(s) and extension pages | `src-tauri/src/platform/navigation_guard.rs`, `src-tauri/src/infra/browser/mod.rs` |
| Saved passwords | A page never sees saved sign-ins or asks for one. Misty draws the menu, ignores clicks in its first half second, and only a click there fills, into the site the sign-in was saved for. The fix's tests pass, but it hasn't been tried in the running app | `src/features/browser/workspace/PasswordFillMenu.tsx`, `src-tauri/src/infra/browser/host_messages/passwords/manage.rs` |
| Native messages from pages | Each needs a per-tab token, built so page hooks never see it | `src-tauri/src/infra/browser/scripts/` |
| The app's own interface | `script-src 'self'` blocks injected scripts | `src-tauri/tauri.conf.json` |
| Untrusted documents | Parsed in a worker under `sandbox-exec` or an AppContainer | `src-tauri/src/infra/documents/` |
| Agent programs | Run in QuickJS with no network, files or globals | [harness](../agents/harness.md) |
| The runtime's local port | `/v1` routes need a signed request and voice sockets a one-time ticket. Workflow routes have no auth, but need custom headers a website can't send without CORS approval, so other local processes can reach them | `src-tauri/services/agent-runtime/src/index.ts` |
| Releases | macOS builds are notarized, Windows builds signed, updates verified with minisign, and the eval bridge isn't compiled in | `cli/src/release/`, `src-tauri/src/infra/browser/eval_bridge/mod.rs` |

The webviews sandbox their own page processes. Nothing in Misty's code overrides TLS errors or
turns off safe browsing, so those stay at each engine's default; the defaults themselves were not
tested.

## Limits of using the system webview

- **Site isolation** belongs to the engine. WebView2 has Chromium's. WebKit's is believed to be
  less complete, which was not checked against current releases.
- **Engine patches** arrive with OS and engine updates, not Misty's releases: evergreen on Windows,
  slower on macOS, and up to the distribution on Linux.
- **Private WebKit APIs**, such as the location permission callback, can break in an OS update.
