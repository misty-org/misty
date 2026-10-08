# Kiri

Kiri (`kiri/`) is Misty's native web platform layer: the web APIs that OS webviews leave
out, supplied from Rust. `kiri/README.md` describes how it works.

## Status

| Phase | Scope | macOS | Linux | Windows |
| --- | --- | --- | --- | --- |
| 1 | Page bridge (`plugin:kiri\|call`), tab audio state | Ran in app | Ran in probe | Compiles |
| 2 | Camera and microphone permissions on every engine | Ran in app | Ran in probe | Compiles |
| 3 | Passkeys (WebAuthn) for any site | Runs up to Apple's entitlement | Not available | WebView2's own |
| 4 | Host channel, context menu everywhere, extension transport | Ran in app | Ran in probe | Compiles |

## Open items

- [ ] **Run Kiri's tests on Windows.** None of Kiri's Windows code has run yet: the WebView2
      permission hook, the host channel, context-menu copy/cut/paste, and WebView2's own
      passkeys. On a Windows machine with Rust (MSVC) and the WebView2 runtime:

      ```powershell
      powershell -ExecutionPolicy Bypass -File kiri\probes\runtime\run.ps1
      ```

      Every `KIRI RUNTIME` line should say PASS (a machine without a camera skips the camera
      check). Then run the app on Windows and try shortcuts, right-click, the tab speaker and
      site settings. Record the date and result here.
- [ ] **Passkey entitlement.** Request `com.apple.developer.web-browser.public-key-credential`
      with Apple's "Request the macOS Web Browser Public Key Credential Entitlement" form
      (Account Holder only). It needs a public download page, a notarized Developer ID build
      and an evaluation account. After approval: enable the capability on the
      `com.misty.desktop` App ID, regenerate the "Misty Developer ID" and "Misty Development"
      profiles, add the entitlement to `src-tauri/Entitlements.plist`, and embed the profiles
      in dev and release builds. Never add the entitlement before the profile carries it: the
      app will not launch.
- [ ] Passkey autofill (`mediation: "conditional"`) is rejected for now.
- [ ] On Linux, a saved "Allow" still asks each time, because WebKitGTK does not report which
      frame asked.

## Re-running the checks

- Kiri core: `cargo test --no-default-features` in `kiri/`.
- macOS, inside the app: `MISTY_KIRI_PROBE=1 npm run tauri -- dev`.
- Linux, in Docker: `kiri/probes/runtime/run.sh`.
- Windows: `kiri\probes\runtime\run.ps1`.
