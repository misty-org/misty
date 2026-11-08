# src-tauri: what is left

Written 2026-11-07. Delete this file when the work below is done, so nothing finished stays in
`docs/`. The reorganization of `src-tauri` and the rewrite of its Objective-C in Rust are
finished: all code is in `src-tauri/features/<feature>/` and no `.m` or `.h` file is left.

## Left

- The Windows installer (the NSIS hook in `packaging/windows/`) was moved but not built, because
  it can't be built on a Mac. The macOS bundle builds and carries `packaging/Info.plist`.
- The macOS native code was ported line by line and is untested in the running app. Try the
  Touch ID prompt for a saved card, setting Misty as the default browser, the Space dock menu,
  dictation into another app, the agent pointer and ring, the desktop control island, window
  control, screen context on an ask, extension install from a store, an extension popup and
  options page, notifications, and native messaging.
- ScreenCaptureKit is now linked strongly (the `objc2` crate does it), so a Mac older than
  macOS 12.3 fails at launch; `build.rs` still adds a weak link flag for it.
- The two largest files, `sync/browser_data/src/local.rs` and `vault/exchange.rs`, are split and
  under the 500-line contract. About 200 other files sit between 200 and 500 lines; the contract
  allows them, so splitting them is optional.
