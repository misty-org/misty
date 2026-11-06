# Browser security

Misty renders pages with the OS webview (WKWebView, WebView2, WebKitGTK) through Tauri, with no
Chromium or Gecko of its own. This is where the browser's security boundaries stand, from a code
audit on 2026-11-05. The app was not run for it and it was not a penetration test. Vault encryption,
deep links and the server were not audited. Extension permissions were audited on 2026-11-06, in
[their own section](#extension-permissions). To report a problem, see
[SECURITY.md](../../SECURITY.md).

## Open problems

Most serious first.

1. **The app has no OS sandbox.** `src-tauri/Entitlements.plist` has no App Sandbox, so a bug in
   the main process or the app's own windows runs with the person's full user rights. The file gate
   (below) keeps Misty's own code to what's granted, but can't stop a memory bug. Three things still
   reach further than `.misty` and grants: Misty's file picker lists any folder
   (`file_access/looks.rs`), the `asset:` scope in `tauri.conf.json` still covers whole folders like
   Documents, and `misty-browser-sync` and the credential store open their files themselves.
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
| Plugin access | Website tabs get only `kiri:default`, and a test checks the other capabilities don't reach them | `src-tauri/sandbox/capabilities/` |
| Files the app itself touches | One gate refuses anything without a grant, and clippy bans the standard calls elsewhere. It checks real paths, so `..` and links can't get around it. Tests cover this; the prompts haven't been tried in the running app | `src-tauri/src/infra/file_access/`, `src-tauri/clippy.toml` |
| Other browsers, the screen, other apps, typing | Off until the person says yes to a native prompt. Background calls are refused without one. Settings › Agents › Access changes them | `src-tauri/src/infra/permissions/` |
| Downloads | The folder is asked for on the first download. Nothing opens or runs a download except the person's click. On macOS 26.5 a WKDownload carried `com.apple.quarantine` in a small test program, not in Misty itself. Misty adds the flag to pages and clipboard images it saves | `src-tauri/src/infra/browser/downloads.rs`, `src-tauri/src/infra/file_access/quarantine.rs` |
| Local files | A custom `asset:` handler refuses website tabs, which Tauri's own handler does not | `src-tauri/src/platform/asset_protocol.rs` |
| Navigation | App windows stay on bundled pages; tabs load only http(s) and extension pages | `src-tauri/src/platform/navigation_guard.rs`, `src-tauri/src/infra/browser/mod.rs` |
| Saved passwords | A page never sees saved sign-ins or asks for one. Misty draws the menu, ignores clicks in its first half second, and only a click there fills, into the site the sign-in was saved for. The fix's tests pass, but it hasn't been tried in the running app | `src/features/browser/workspace/PasswordFillMenu.tsx`, `src-tauri/src/infra/browser/host_messages/passwords/manage.rs` |
| Extensions | Nothing runs, and nothing runs wider, than the person approved on this computer. See [below](#extension-permissions) | `src-tauri/src/infra/extensions/approvals.rs` |
| Native messages from pages | Each needs a per-tab token, built so page hooks never see it | `src-tauri/src/infra/browser/scripts/` |
| The app's own interface | `script-src 'self'` blocks injected scripts | `src-tauri/tauri.conf.json` |
| Untrusted documents | Parsed in a worker under `sandbox-exec` or an AppContainer | `src-tauri/src/infra/documents/` |
| Agent programs | Run in QuickJS with no network, files or globals | [harness](../agents/harness.md) |
| The runtime's local port | `/v1` routes need a signed request and voice sockets a one-time ticket. Workflow routes have no auth, but need custom headers a website can't send without CORS approval, so other local processes can reach them | `src-tauri/services/agent-runtime/src/index.ts` |
| Releases | macOS builds are notarized, Windows builds signed, updates verified with minisign, and the eval bridge isn't compiled in | `cli/src/release/`, `src-tauri/src/infra/browser/eval_bridge/mod.rs` |

The webviews sandbox their own page processes. Nothing in Misty's code overrides TLS errors or
turns off safe browsing, so those stay at each engine's default; the defaults themselves were not
tested.

## Extension permissions

Audited on 2026-11-06 by reading the code and by tests. The tests include a native probe,
`src-tauri/tests/webextensions/permissions-probe.m`, that runs an extension asking for far more than
it's granted through the real macOS host and WebKit. The app itself wasn't run, so the review dialog
and the Settings rows have only been through component tests. Windows was read, not run.

**What the person approves.** The review in Misty's own window shows what the manifest asks for in
plain words before anything is committed. `extensions_commit` records exactly what that review lists
in `extension_approvals` in `misty.db`, which never syncs. `extensions_reconcile` caps every load to
that record and to what the version declares, so the install list can only narrow it. An update asking
for more waits for approval and the old version keeps running. Settings shows each grant with Remove
access, which an update doesn't undo. An extension with no record doesn't run.

Fixed in this audit, most serious first:

| Severity | Problem | Fix | Test |
| --- | --- | --- | --- |
| High | The profile's synced extension list installed extensions by itself on each computer, with everything they asked for and no prompt. Anything that could write to the vault, such as another compromised computer, could put any store extension on all of them | The list only offers them in Settings, through the normal review, and native commit refuses without an approval | `followProfile.test.ts`, `approvals` tests |
| High | Native code kept no record of approval and took its grants from the renderer's list | `approvals.rs`, above | `approvals` tests |
| High | `downloads.open` opened a downloaded file with no click, so an extension could fetch a file and open it | Refused for every extension, in native code | `native/checks.rs`, the probe |
| Medium | A website could open any extension page, such as its settings, with an address it chose. Misty's tab swap and new tabs bypassed WebKit's `web_accessible_resources` check | The same rule in `web_access.rs`, for navigations and `window.open`. Only Misty's own navigations skip it | `web_access` tests, the probe |
| Medium | Private access was on by default in the review, which let an extension see incognito tabs' addresses and titles | Off until the person turns it on | `ExtensionDialogs.test.tsx`; what it exposes was read |
| Medium | `incognito: not_allowed` was checked only by the switch in the interface on Windows | Capped natively on every platform | `approvals` tests |
| Low | `downloads.download` could set `Cookie`, `Origin` and other headers kept for the browser | Refused, as in Chrome | `native/checks.rs`, the probe |
| Low | An extension could open another extension's pages | The same rule as websites | `web_access` tests, the probe |
| Low | A grant from an old version carried over after the new one stopped declaring it | Capped to what the version declares | `approvals` tests |
| Low | Zip names that Windows reads as something else (`a:b`, `a.`, `aux`) | Refused on every platform | `package` tests |
| Low | Sync's removal path left a removed extension's pages allowed on Windows | Drops the right host | By reading |

What holds:

| Boundary | What protects it | Checked by |
| --- | --- | --- |
| Package signature, before anything unpacks | CRX3 developer key for the requested ID plus the Web Store's pinned key, over the digest the update service named | `crx` tests |
| Unpacking | No traversal, absolute paths, links, duplicates or Misty's own folders. Limits of 64 MiB download, 256 MiB expanded, 20,000 files | `package` tests |
| Caller identity | From the engine: the host view and its frame's URL, never the message | Reading |
| WebKit's own APIs (tabs, cookies, storage, webNavigation, declarativeNetRequest, scripting) | Only what's granted to the context exists. Removing access stops it while running | The probe, except `scripting`, which was read |
| Misty's native APIs (history, bookmarks, downloads, browsingData and others) | The native host checks the namespace's permission before Misty hears the call | The probe, `native/checks.rs` |
| `permissions`, `host_permissions`, `optional_permissions` on Windows | The copy WebView2 runs holds only what's granted, and optional access can't be asked for | `native_windows` tests exist; not run here |
| Other extensions' storage | WebKit keeps it per extension, and each profile has its own controller | The probe, `space-probe.m` |
| Content scripts | Only on granted hosts, in their own world, with no view of the page's handlers or globals. A main-world script at `document_start` ran after the embedder's script | The probe |
| Tauri commands | Extension pages run in `misty-browser-*` views, which get no app commands, and their schemes aren't in Kiri's remote list. Popup hosts, background pages and compat pages match no capability, and the last two aren't Tauri views | `app_command_policy` tests, reading |
| The vault, saved sign-ins, Misty's windows | No extension API reaches them. Extension tabs load only http(s) and their own scheme | Reading |

Still open:

- **The synced list still switches and removes.** It can turn off, turn on or remove an extension
  already approved here, and removing erases its data. It can't add access. Low.
- **Allow in private tabs means little on macOS.** Incognito windows have no extension controller, so
  no content script runs there, but the tabs are still listed to an extension with this switch on.
  Windows runs it in the InPrivate profile. Choose one meaning. Low.
- **OAuth redirects.** Any tab can land on an extension's `*.extensions.misty.invalid` address and
  answer a sign-in that's waiting, where Chrome only watches the sign-in window. Low.
- **Updates can go backwards.** Any digest the store names applies, even an older version. Low.
- **Firefox packages have no signature check**, only the digest from Mozilla's API over TLS. Firefox
  isn't offered in the interface, but the path remains. Low.
- **Extensions already installed need one new review**, since nothing recorded their approval before.
  Some of them may have come from the synced list, so they aren't approved automatically. They stop
  until then, with a Review row in Settings.
- **Windows, unverified.** Whether a content script can reach `chrome.webview` from its world, and
  `externally_connectable` isn't narrowed to what's granted.
- **`tabs.query({})` took about 60 seconds in the probe** with several tabs open, though queries by
  address answered at once. Not investigated.
- `run-native.py` stops at `tab-lifecycle-probe.m`, which no longer compiles. The host, compat and
  permissions probes pass when run directly.

## Limits of using the system webview

- **Site isolation** belongs to the engine. WebView2 has Chromium's. WebKit's is believed to be
  less complete, which was not checked against current releases.
- **Engine patches** arrive with OS and engine updates, not Misty's releases: evergreen on Windows,
  slower on macOS, and up to the distribution on Linux.
- **Private WebKit APIs**, such as the location permission callback, can break in an OS update.
