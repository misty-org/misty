# Native WebKit extension validation

Misty's extension implementation uses the system `WKWebExtension` runtime on
macOS 15.4 or later. The native host and MIT-owned fixtures in this directory do
not bundle a browser engine. Downloaded extensions retain their original licenses.

## Reproduce

Run from the repository root on an interactive macOS desktop with Xcode selected:

```sh
python3 src-tauri/tests/webextensions/run-native.py
node --test src-tauri/tests/webextensions/bridge.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib infra::extensions::
cargo test --manifest-path src-tauri/crates/browser-sync/Cargo.toml --lib
node cli/tasks/run-tool.ts vitest run src/features/extensions/store.test.ts
```

The native runner compiles disposable test binaries, serves fixtures on a random
loopback port, opens native test windows, and installs a uniquely named temporary
Firefox native-host manifest. It removes the manifest and temporary files on exit.
It uses unique extension controller identifiers; it does not modify installed
user extensions. `host-probe.m` links the same Objective-C implementation as Misty.

The standalone `probe.m` proves isolated public `storage.sync` APIs and change
events across two controller instances. This is a local host-mediated round trip,
not a two-device transport test. The production-host probe covers normal/private
content scripts, background messaging, toolbar popups, extension-origin options,
storage restoration, navigation swaps preserving a POST body and logical tab identity,
and data removal after disabling. The native messaging probe
checks host authorization, direct executable arguments, persistent fragmented
frames, incoming size rejection, and process cleanup.

`tab-lifecycle-probe.m` covers logical tabs restored before the runtime, binding
an existing adapter, reconciliation after a missing open notification, and stable
extension tab IDs across repeated layout/registration. It reproduces the state
where a tab is queryable and has an action but is absent from WebKit's `openTabs`;
content-script message routing requires that open registration. The regression
fails against the previous registration path and passes for both fixture versions.

JavaScript tests use the production sync bridge. Rust tests cover package integrity,
identity, traversal, symlinks, expanded-size limits, compatibility findings,
encrypted journal namespace binding, encrypted collection records, removal
ordering, and exclusion from renderer snapshots. Frontend tests cover permission
queues, account changes, update identity, private restrictions and defaults.

Optional live package intake (downloads public packages without installing them):

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib mozilla_package_intake -- --ignored --nocapture
```

## Architecture and boundaries

- `native/macos/MistyExtensions.m` owns controllers, context configurations,
  tab/window adapters, permissions, actions and bridge views. Extension-page
  configurations retain WebKit's supplied data store. Each Misty-created extension
  page gets a fresh user-content controller; sharing WebKit's returned controller
  caused duplicate handler registration with multiple extensions.
- `src/infra/extensions` owns catalog intake, immutable package versions, approval
  tokens, account reconciliation, updates and encrypted per-key sync journals.
  The original XPI remains intact. Only the runtime copy receives bridge resources.
- `src/features/extensions` provides the shared collection workspace, permissions,
  management, toolbar dropdown, pins and account-backed controls.
- `extension_sync` is a separate encrypted sync collection. Its values never enter
  renderer collection snapshots or ordinary account preferences. Renderer workspace
  edits cannot create, patch or delete extension records. Native bridge handlers
  bind account, context, view, frame, URL and session epoch.
- Uninstall has an independent generation tombstone so stale offline key writes
  cannot resurrect an installation. New installations get a new generation.
- Restored installations with storage permission wait for the first sync hydration;
  a new generation explicitly approved on this device can start immediately and
  journal changes offline. An already initialized journal remains usable while the
  vault is locked.
- The agent interface exposes permitted actions and popup interaction through the
  existing browser grant. It exposes no installer, bulk storage reader or vault unlock.
- Firefox native-host manifests are discovered at their standard macOS locations.
  Companion applications are separately installed and may reject an unknown browser.

The service reports native OS information, manifest versions and known host/API
limitations through `extensions_action` with operation `diagnostics`. Package parse
success never certifies an extension. Required known unsupported APIs block install;
optional unsupported APIs produce findings. This initial host does not implement
sidebar panels, new-tab overrides, moving existing tabs into new windows, or pinned,
muted and reader-mode tab creation. Tab-level context-menu contributions are supported;
link/selection-specific context-menu integration is not implemented. Unsupported
Windows/Linux runtimes and Chrome Store acquisition remain explicit backlog items.

## Recorded local evidence

On the development Mac (macOS 26.5.2), both MV2 and MV3 native probes and the native messaging
probe passed. A regression run with three simultaneous contexts passes and creates
one bridge per storage-enabled extension. Zero contexts creates zero bridge views.
A sample host-only run measured:

| Contexts | Bridge views | Ready | Host peak RSS | Host CPU over 5 s idle |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0.013 s | 31.5 MiB | 0.0021 s |
| 1 | 1 | 0.213 s | 67.0 MiB | 0.0085 s |
| 3 | 3 | 0.243 s | 69.1 MiB | 0.0105 s |

These measurements exclude WebKit subprocesses, Tauri/React and real extension
workloads. They are regression evidence, not a browser memory budget or popup
latency guarantee. The full app has not been profiled with representative extensions.

Live AMO package intake recorded Dark Reader 4.9.133 as unverified/allowed, and
Bitwarden 2026.9.3, SingleFile 1.27.0 and ClearURLs 1.27.3 as blocked by required
unsupported API findings. Digests and declared identities passed. These are intake
results only; those versions were not certified by exercising their runtime UI.
On October 2, 2026, Dark Reader 4.9.133 exposed a live tab-registration failure:
its popup loaded but labeled an existing Google tab as protected. Reasserting
open-tab registration restored its connection; after rebuilding, the original
Google tab's popup again showed its normal website control. A separate disposable
host also verified that this unchanged package injects its dynamic theme on Google.
These checks do not certify every Dark Reader feature or other Firefox packages.
The workspace and permission review were inspected with real React components in
a fixture preview, not through an authenticated production account.

## Release gates still requiring validation

- Run the native suite on the minimum supported macOS 15.4 and current release.
- Run the complete Tauri install/review/update/rollback/uninstall path against an
  account and the updated server. The server must accept `extension_sync` records
  and the added extension account preferences before this feature ships.
- Verify two physical devices, offline and concurrent edits, deletion, reinstall,
  vault locking, reconnect, account switches and browser-store generation changes.
- Exercise live extensions across content modification, reading, toolbar utilities
  and account tools, recording exact version-specific results and native hosts.
- Verify popup Escape/outside click/focus, resizing, display changes and navigation
  swaps in the full app; test optional permission requests and revocation there.
- Measure whole-app cold start, WebKit subprocess memory, idle CPU and popup latency
  with zero, one and several representative enabled extensions.

Passing unit and local native fixtures does not satisfy these release gates.

`compat-probe.m` loads `fixtures/compat` with the real compatibility layer
(`kiri/src/extensions/compat`) through the production host. It checks the
shims, native answers (language detection, idle state, site data removal),
requests forwarded to the app, `tabs.move`, the OAuth redirect rewrite, and
learned blocking: a request the extension cancels passes once, the repeat is
blocked by the learned rule, and an unrelated request still loads. Pages use a
persistent data store, because WebKit treats a nonpersistent store as private
browsing, where an extension without private access gets no rules.

`run-native.py --notifications` also runs `notification-probe.m`, which needs
an app bundle: UserNotifications refuses bare binaries, apps in temporary
folders and apps not launched through LaunchServices. The runner builds
`src-tauri/target/notification-probe/MistyNotificationProbe.app`, signs it
with the same development identity as `misty dev` (or
`MISTY_DEV_SIGNING_IDENTITY`) and launches it with `open`. On the first run,
allow Misty Notification Probe in System Settings > Notifications; a declined
or unanswered prompt is remembered as denied. The probe posts a notification
with buttons and an icon, checks the delivered request, and passes stand-in
responses to the delegate to check click, button and dismiss routing. A real
click on a banner still needs a manual check in Misty.
