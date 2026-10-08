# Kiri

Kiri (霧, "mist") is Misty's native web platform layer.

OS webviews (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) provide a
rendering engine but not the browser layer that Chromium and Gecko build on top of theirs:
permission prompts, WebAuthn, device APIs, extension APIs. Kiri supplies that layer from
Rust, one capability at a time. It does not render anything and never replaces the engine.

Status and open items, including the Windows run that is still to do, are tracked in
[`docs/plans/kiri.md`](../docs/plans/kiri.md).

## Four ways in

| Layer | Who starts it | Transport | Trust |
| --- | --- | --- | --- |
| Capabilities (`capabilities/`) | Website pages | `plugin:kiri\|call` (Tauri IPC) | Anything a page may do; origin comes from the engine |
| Engine hooks (`engine/`) | The engine (camera/mic prompts) | Native delegates and events | The host's site-permission store decides |
| Host channel (`channel/`) | The embedder's own injected scripts | Each engine's native message handler | The embedder authenticates each message (Misty: per-tab token) |
| Extensions (`extensions/`) | WebExtension pages | WebKit's reply handler, answered by the embedder | Permissions the account granted |

## Capabilities: how a page call flows

1. `page_script()` is injected into each top-level document before site scripts run. It holds
   the transport and the shims for this platform.
2. A shim exposes a spec-shaped API to the page and marshals each use into
   `{ v, cap, method, args }`. Shims make no decisions.
3. The transport sends the call as `plugin:kiri|call`. The embedder's Tauri capability grants
   website webviews only `kiri:default`, so this is the one Tauri command a page can reach.
4. `Kiri::dispatch` validates the envelope, checks the webview label, derives the caller's
   origin from the webview's committed URL (never from the payload), and applies the
   capability's gate: secure context, then host permission.
5. The capability does the work and replies. Errors carry DOMException names, which the
   transport rethrows so the page sees what a full browser would raise.

| Capability | Platforms | What it supplies |
| --- | --- | --- |
| `media` | all | Tab audio state; on Windows, a hook that lets the host stop capture |
| `webauthn` | macOS, when entitled | `navigator.credentials` passkeys and security keys for any site |

### Passkeys on macOS

WKWebView only runs WebAuthn for the app's own associated domains. Browsers use
AuthenticationServices' web-browser APIs instead, which require the restricted
`com.apple.developer.web-browser.public-key-credential` entitlement. Kiri checks for it at
launch and installs the `webauthn` capability only when the running app has it, so builds
without it keep WebKit's behavior.

To turn it on:

1. The Apple Developer Account Holder requests the entitlement with Apple's form.
2. Once granted, add it to `src-tauri/Entitlements.plist` and sign with a provisioning profile
   that includes it. Do not add it before then: macOS refuses to launch an app that claims a
   restricted entitlement its profile does not grant.

WebView2 reaches Windows Hello itself, so Windows needs no shim. WebKitGTK has no
authenticator integration; Linux has no passkeys yet.

## Engine hooks: camera and microphone

`engine::install_media_permissions` routes each tab's capture requests through the host's
`MediaPolicy`, which normally answers from its site-permission store with
`permissions::media_verdict`. The rules are the same everywhere: a block applies to embedded
frames too, and an allowance never extends to a different origin.

| Engine | Requests | Stopping capture |
| --- | --- | --- |
| WebKit (macOS) | UI delegate callback, with the requesting frame's origin | `setCameraCaptureState` / `setMicrophoneCaptureState` |
| WebView2 | `PermissionRequested`, with the requesting frame's origin | The `media` capture hook in the page |
| WebKitGTK | `permission-request` | `set_camera_capture_state` / `set_microphone_capture_state` |

WebKitGTK ships camera, microphone and WebRTC switched off; Kiri turns them on when it
installs the hook, since every request then goes through the policy. It has no prompt of its
own and does not say which frame asked, so Kiri always asks with a dialog naming the tab's
site; only a block is applied silently.

## Host channel

Messages the embedder must be able to trust (Misty's focus, shortcuts, context menu,
companion pointer, page color and Escape-to-stop) cannot use `plugin:kiri|call`: anything a
page can reach, it can also forge or intercept. `channel::sender_script()` gives the
embedder's script the engine's native sender, which it binds before site scripts run; the
embedder authenticates each message with a secret held in that script's closure. Kiri
delivers the raw string to the `HostChannel` the embedder registered.

On WebView2 the channel shares `WebMessageReceived` with Tauri's IPC, and on WebKitGTK the
script-message signal. Misty's vendored wry skips host-channel messages (`WIRE_PREFIX`) and
listens only to its own `ipc` handler, so they never reach Tauri's IPC parser.

## Extensions

`extensions::apply` installs the WebExtension compatibility layer into an unpacked package:
scripts that run before an extension's own and define the Firefox APIs WebKit lacks. The
layer's host page relays requests that need answers to the embedder, which checks them
against the permissions the account granted.

## Layout

```
src/
  lib.rs              Kiri, dispatch, page_script()
  envelope.rs         request shape and limits
  gate.rs             Caller: origin and secure context from the engine
  host.rs             Host trait: permissions, signals, the UI thread
  permissions.rs      site-permission rules shared by every engine
  plugin.rs           Tauri adapter
  page/transport.js   page-side transport
  capabilities/       page APIs (media, webauthn)
  engine/             camera and microphone hooks per engine
  channel/            host channel per engine
  extensions/         WebExtension compatibility layer
```

## Adding a capability

1. Create `src/capabilities/<name>/mod.rs` implementing `Capability`, plus `shim.js`.
2. Put OS-specific code in `macos.rs`, `windows.rs` and `linux.rs` beside it. Return
   `KiriError::not_supported` on a platform that has no equivalent yet.
3. Register it in `capabilities::builtin()` and its shim in `capabilities::shims()`.
4. Powerful features keep the default `secure_context_only` and set `needs_permission`, so
   the host's site-permission store decides.

## Tests

```bash
cargo test --no-default-features
```

The core builds and tests without Tauri. The default `tauri` feature adds the plugin, engine
hooks, host channel and the macOS authenticator; Misty's desktop crate builds those.

To exercise every layer inside the running app (macOS debug builds):

```bash
MISTY_KIRI_PROBE=1 npm run tauri -- dev
```

The probe (`src-tauri/src/infra/browser_kiri_probe.rs`) opens a tab on a loopback page,
checks the page bridge and its ACL, the host channel, the context menu's copy, site
permissions and the macOS passkey path, prints `KIRI PROBE` lines and quits. On a Mac that
has never answered "use passkeys in Misty?", macOS asks once.

To run the Linux and Windows engine code for real, use the runtime probe. It is a minimal
Tauri app built on Misty's locked versions, and it checks the page bridge and its ACL, the
host channel, the camera permission hook, `engine::edit`, and that WebAuthn stays the
engine's own off macOS:

```bash
kiri/probes/runtime/run.sh
```

That runs Linux in Docker under a virtual display. On Windows (Rust with the MSVC toolchain
and the WebView2 runtime, as for building Misty):

```powershell
powershell -ExecutionPolicy Bypass -File kiri\probes\runtime\run.ps1
```

On a machine without a camera, the Windows probe skips the camera check and says so.

Kiri's native code must use the same `webview2-com`, `windows` and `webkit2gtk` as the wry
Tauri resolves to, so its Tauri requirement is pinned to Misty's (`>=2.11.3, <2.12`). Bump
them together.
