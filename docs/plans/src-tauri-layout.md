# src-tauri: what is left

Written 2026-11-07. Delete this file when the work below is done, so nothing finished stays in
`docs/`. The reorganization of `src-tauri` and the rewrite of its Objective-C in Rust are
finished: all code is in `src-tauri/features/<feature>/` and no `.m` or `.h` file is left.

## Left

- The Windows installer (the NSIS hook in `packaging/windows/`) was moved but not built, because
  it can't be built on a Mac.
- ScreenCaptureKit is now linked strongly (the `objc2` crate does it), so a Mac older than
  macOS 12.3 fails at launch; `build.rs` still adds a weak link flag for it.
