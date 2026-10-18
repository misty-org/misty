# Spike: separate website data per Space

Status: done 2026-10-16. The prototype code (the probes named below) stays on branch
`claude/spike-space-web-data-6dfa15` (commit 450023be); only these findings are on `main`'s side.
The build plan is [Spaces as profiles](../spaces-as-profiles.md).
Question from [Spaces as profiles](../../design/spaces-as-profiles/BRIEF.md): can Misty give
each Space its own WebKit website data store on macOS, so cookies, sign-ins, localStorage,
IndexedDB and cache never cross between Spaces?

**Answer: yes, with no wry or Tauri fork.** The engine side already works and Misty already
uses it. What's left is Misty's own code, which assumes one active store, one sync session
and one extension controller per process.

## What Misty does today

Misty's website pages never use WebKit's default store. Every browser webview already
opens in a named `WKWebsiteDataStore`:

- `src-tauri/src/infra/browser_profile.rs` turns a 64-hex profile identity into a 16-byte
  store identifier. With no identity it uses the fixed legacy store.
- `browser_create.rs` passes it to Tauri's `WebviewBuilder::data_store_identifier`, which
  wry 0.55.1 (vendored at `src-tauri/vendor/wry`) maps to
  `WKWebsiteDataStore.dataStoreForIdentifier:` on macOS 14 and later
  (`vendor/wry/src/wkwebview/mod.rs`, around line 230). On macOS 12–13
  (`browser_requires_ephemeral_store`) pages fall back to a non-persistent store.
- Sync picks which store a page opens in. `browser_sync/profile.rs` hashes the vault scope
  (deployment, account, `vault_id`) into a **logical** profile id
  (`default_profile_id`), and the encrypted registry binds it to a **physical** store
  generation. A Space is a new `vault_id`, so it gets its own logical profile, and with it its
  own store, without new sync code.
- There are already device-local "browser profiles" (`src/features/workspace/browserProfiles.ts`,
  `profile:<id>` scopes) that each get a random store. They show that several named stores
  can be open in one process today.

The single-store assumptions are in Misty, not the engine:

| Where | Assumption |
| --- | --- |
| `browser_sync.rs` `SESSION` | one open vault per process |
| `browser_sync/profile.rs` `SELECTED_PROFILE` | one selected store; switching errors until every view closes |
| `native/macos/MistyExtensions.m` `static host` | one `WKWebExtensionController`. Its `configureStore:` tears the controller down and rebuilds it whenever the default store changes |
| `browser_profile_view.rs`, `extensions/native.rs` `trusted`, about 64 `"main"` labels in `infra/` | one app window named `main` |
| wry `private_data_store` (thread-local) | one private session shared by all private tabs |

## What the prototype checked

### 1. Two windows, two stores, through Tauri/wry (pass)

`src-tauri/examples/space_store_probe.rs` opens two OS windows (`WebviewWindowBuilder`),
each built with `.data_store_identifier(...)` on a random identity, against a loopback
test page. It runs as three processes: write, then a real restart to verify, then cleanup.

```bash
cargo run --manifest-path src-tauri/Cargo.toml --example space_store_probe
```

The run on macOS 26.5 (2026-10-16):

```
write a: before {cookie:"", local:null, idb:null, cache:null}  after all "a" | Cookie: js=a; session=a
write b: before {cookie:"", local:null, idb:null, cache:null}  after all "b" | Cookie: js=b; session=b
native a: ["js=a", "session=a"]
native b: ["js=b", "session=b"]
PASS write: two windows, two stores, no crossing; native capture and restore stay in their store
restart a: before all "a" | Cookie: js=a; session=a
restart b: before all "b" | Cookie: js=b; restored=b; session=b
PASS restart: cookies, localStorage, IndexedDB and Cache Storage persisted per Space
PASS: separate per-Space website data, persisted across restart
```

Space B opens after A has signed in, and finds every area empty. That covers an HTTP-only
`Set-Cookie` session, a script cookie, localStorage, IndexedDB and Cache Storage. After
the restart each Space finds only its own data. Cleanup through
`WKWebsiteDataStore.removeDataStoreForIdentifier:` left
`~/Library/WebKit/<app>/WebsiteDataStore/` empty. The HTTP disk cache lives in the same
per-identifier folder; the probe doesn't test it separately.

### 2. Sign-in capture and restore against a chosen store (pass)

The probe reuses `browser_cookie_store.rs` unchanged, which is the code sign-in capture
(`browser_sync/collect.rs`) and restore use:

- `read(window, store)` returns only that Space's cookies, the HTTP-only one included.
- Reading Space A's window as Space B is refused with `CookieStoreError::Profile`. The
  guard compares the live view's `websiteDataStore.identifier`, not renderer metadata.
- `write(window_b, b, cookie)` lands in B only. A never sees it, and B's page still sends
  it after the restart.

The capture side already targets a specific store by design: `CaptureView::open(app, physical)`
opens a hidden page in the physical store (`browser_profile_view.rs`). The existing
`cookie_store_probe` example covers the rest: attributes, deletion, staged restore and the
journal. What changes for Spaces is that sync must run one capture/restore loop per open
vault instead of one per process.

### 3. Kiri and extensions in a non-default store (pass, host needs a refactor)

**Kiri** has nothing to change. It injects its page script and answers on Tauri IPC by
webview label, which doesn't depend on the store. Its engine hooks already key site
permissions by the view's own store identifier (`kiri/src/engine/macos.rs`
`StoreScope::Persistent`, `browser_site_permissions.rs` `profile_key`), so each Space
gets its own camera, microphone and notification choices automatically. Today's device
profiles already run Kiri in non-default stores in production.

**Extensions:** `src-tauri/tests/webextensions/space-probe.m` (with `fixtures/space`) runs
two `WKWebExtensionController`s live at once. Each uses
`configurationWithIdentifier:` with its own identity, and its `defaultWebsiteDataStore` is
its Space's named store. Each Space's page runs in its own window, with its own store and
controller.

```
write space a: content script ran, extension storage held none
write space b: content script ran, extension storage held none
PASS write: two live extension controllers, one per Space store
verify space a: content script ran, extension storage held a     (after restart)
verify space b: content script ran, extension storage held b
PASS verify
PASS cleanup                                                      (then a fresh write found none again)
```

Content scripts inject in both Spaces. Extension storage is separate per controller and
persists, and removing it (controller data records plus the data store) works. Run it like
the other native probes:

```bash
xcrun clang -fobjc-arc -fblocks -framework AppKit -framework WebKit src-tauri/tests/webextensions/space-probe.m -o /tmp/space-probe
```

Then pass it the fixture folder, a loopback page URL, `write|verify|cleanup` and four
UUIDs. The page URL can come from any static server, such as `python3 -m http.server`.

A single shared controller is not acceptable. Its background pages and extension tabs use
the controller's `defaultWebsiteDataStore`, so an extension's own requests would carry one
Space's cookies into another. `MistyExtensionHost` must therefore become one host per Space,
holding the controller, contexts, tabs and windows, with a controller identity derived
from the Space. This matches the brief: extensions are installed per Space.

## What needs patches

- **wry/Tauri: none for named stores.** Tauri 2.11 `WebviewBuilder::data_store_identifier` and
  wry 0.55.1 `WebViewBuilderExtDarwin::with_data_store_identifier` are upstream. No upstream
  issue is needed.
- **Vendored wry, small and optional:** `private_data_store` is one thread-local, so private
  tabs in every Space would share one session. For a private session per Space, key it by
  Space (for example, by adding a private-session key to the attributes) in
  `vendor/wry/src/wkwebview/mod.rs`. Record it in `MISTY-PATCH.md` like the others.
- **Misty, the real work:**
  - per-vault sync sessions (`SESSION`, `SELECTED_PROFILE` → maps keyed by `vault_id`)
  - one extension host per Space (`MistyExtensions.m`)
  - window labels per Space instead of `main`, including the hidden capture view's owner and
    `extensions::native::trusted`
  - removing today's device "browser profiles", which Spaces replace

## Minimum macOS version

- **Separate persistent stores: macOS 14.** `dataStoreForIdentifier:` and
  `WKWebsiteDataStore.identifier` arrived there. Misty's `minimumSystemVersion` is still 12.0.
  On 12–13 every tab is already ephemeral, so Spaces couldn't keep sign-ins.
- **Extensions: macOS 15.4,** unchanged (`WKWebExtension`).

Recommendation: raise `minimumSystemVersion` to 14.0 with the Spaces build. Keeping 12–13
would mean Spaces that forget every sign-in at quit, for a shrinking set of Macs, while
Misty has no users to strand.

## Windows (on paper, not tested)

Each window can have its own WebView2 profile today, in two ways:

1. **Separate user data folder per Space**, which Misty already does. Tauri
   `WebviewBuilder::data_directory` → wry `WebContext::new(Some(dir))` →
   `CreateCoreWebView2EnvironmentWithOptions(browserExecutableFolder, userDataFolder, …)`
   (`vendor/wry/src/webview2/mod.rs` `create_environment`). `browser.rs` `with_browser_data`
   points every browser view at `~/.misty/profiles/<profile>/webview`, and
   `browser_cookie_store_windows.rs` checks it. Every Space is fully separate, at the cost of
   one Edge browser process group per open Space.
2. **WebView2 named profiles in one environment.** `ICoreWebView2Environment10::CreateCoreWebView2ControllerOptions`
   and then `ICoreWebView2ControllerOptions::put_ProfileName` select a profile, which WebView2
   creates if it's missing. Names are ASCII letters, up to 64 characters
   ([reference](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controlleroptions),
   [multi-profile support](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/multi-profile-support)).
   wry 0.55.1 only sets `IsInPrivateModeEnabled` on those options (`create_controller`,
   around line 408), so this route needs a small vendored-wry patch. It shares one browser
   process, and extensions are per profile (`ICoreWebView2Profile7::AddBrowserExtension`,
   which wry already calls on the view's profile).

For Windows, keep option 1 now, since it ships today, and treat option 2 as a later memory
optimization.

## Recommended approach for the build plan

1. **Store identity = the Space's logical profile.** Keep `default_profile_id(scope)` →
   physical generation → `data_store_identifier`. A Space's store follows from its `vault_id`.
   The personal Space keeps today's binding, so no data moves.
2. **One OS window per Space,** each built with its Space's store. Every page in that window,
   popups and hidden capture views included, opens with that identifier. Never pick a store
   from renderer input; resolve it natively from the window's Space, as the lease does today.
3. **Sync per vault:** turn the single session and selected profile into maps keyed by
   `vault_id`, with one capture/restore loop and lease per open Space. Leave the cookie-shard
   code as it is.
4. **One extension host per Space** in `MistyExtensions.m`. Use a controller identity derived
   from the Space and `defaultWebsiteDataStore` set to its store.
5. **Kiri unchanged;** site permissions are already per store.
6. **Deleting a Space:** close its windows, then remove its store in a fresh step
   (`removeDataStoreForIdentifier:`; WebKit keeps references briefly after `close`), its
   extension controller data and its `~/.misty/profiles/<id>` link, as
   `browser_profile_cleanup.rs` does for device profiles today.
7. Raise macOS to 14.0. Optionally patch vendored wry for a private session per Space.
8. Fold today's device "browser profiles" into Spaces and remove them.
