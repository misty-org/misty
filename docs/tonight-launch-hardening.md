# Tonight Launch Hardening

Goal: make Misty feel reliable enough for daily dogfooding by fixing the highest-risk launch issues before adding more features.

## Recommended Focus

### 1. Remote Reliability + Preview + Search Navigation

Why first: this is the launch-risk area currently producing real dogfooding bugs. If remotes feel unreliable, the rest of the app feels unreliable.

Implement tonight:

- Remote previews always use a prepared local cache file under `~/.misty/.cache/remote-files/v1`.
- Remote preview cache hits do not create download transfer notifications.
- Remote preview/open failures include actionable diagnostics: source path, prepared local path, cache hit/miss, and file existence.
- Search result navigation normalizes remote paths to the active mount shape.
- File search results navigate to the parent folder and select/reveal the file.
- Stale search results fail gracefully with a reindex prompt or clear message.

Verification:

- Preview a local PNG/JPEG from Desktop or Downloads.
- Preview a remote PNG/JPEG that is not cached.
- Preview the same remote image again and confirm it is a cache hit with no download notification.
- Open a remote image from search results.
- Open a remote folder from search results.
- Search result for a deleted/moved remote item shows a clean stale-result message.
- Run `npm run build:desktop`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml remote_file`.

Done when:

- Remote preview works after a fresh app restart.
- Remote preview works for first-time and cached files.
- Remote search jumps no longer produce raw rclone `directory not found` errors for existing paths.
- No implicit preview/open preparation appears as a user-facing download transfer.

Current code status:

- Implemented `~/.misty/.cache/remote-files/v1/<cache-key>/<filename>` for prepared remote files.
- Preserved legacy remote-file cache lookup by source metadata so existing cache entries can still be reused.
- Imported valid legacy `~/.misty/.cache/remote-open/v1` cache index entries into the new `remote-files/v1` index at startup.
- Added prepared-open diagnostics: source path, cache path, and cache hit/miss.
- Added desktop and mobile image-preview diagnostics when the prepared local asset URL cannot load.
- Added a provider refresh retry before reporting `Remote "<name>" was not found` while browsing a remote mount.
- Unified command-palette and deep-search indexed result navigation.
- File search results navigate to the parent directory, then select the matched file.
- Failed indexed result jumps show a reindex/stale-result message instead of exposing raw backend errors.

Verified locally:

- `npm run build:desktop`
- `npm run build:mobile`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml remote_file`
- `npm run diagnose:remote-cache`
- Bundled `~/.misty/rclone/rclone` is available and can list configured remotes with `~/.misty/rclone/rclone.conf`.
- Read-only shallow remote listing succeeded for all configured remotes reported by the diagnostic.

Needs live remote QA:

- Fresh app boot can open an existing remote without a transient missing-remote banner.
- First preview of an uncached remote PNG/JPEG downloads into `~/.misty/.cache/remote-files/v1` and displays.
- Second preview of the same remote image is a cache hit and shows no download transfer notification.
- Indexed search result for a remote file opens the parent remote folder and selects the file.
- Indexed search result for a remote folder opens the folder.
- A stale/deleted indexed remote result shows the clean reindex message.

## Other Good Tonight Targets

### 2. File Operation Safety

- Audit Trash/Delete Permanently availability across local, remote, recent, starred, and trash.
- Confirm remote items only expose permanent delete.
- Confirm trashed items only expose permanent delete.
- Confirm undo/redo uses the same transfer history entry instead of creating duplicate history.

Verification:

- Local item from normal folder can move to Trash.
- Local item from Recent/Starred can move to Trash.
- Trash item cannot be trashed again.
- Remote item does not show Trash.
- Undo/redo does not create new transfer IDs.

### 3. Search Index Settings Polish

- Show indexed counts by local, drive, and remote.
- Show last indexed time using `M/DD/YYYY h:mm AM/PM`.
- Add clear reindex action labels.
- Add stale/error status when a remote index scan fails.

Verification:

- Settings shows index totals after scan.
- Reindex updates the status.
- Last indexed time is readable.

### 4. Table + Layout Polish

- Keep table column resizing isolated to the resized column.
- Add reset table columns action if stored widths are broken.
- Reduce unnecessary borders around panes, headers, sidebars, and preview panels.

Verification:

- Dragging Modified wider does not resize Name or Size.
- Header no longer looks boxed by overlapping borders.
- Sidebar and preview resize handles remain easy to drag but visually subtle.

### 5. User-Facing Error Cleanup

- Replace raw rclone/backend errors with concise user-facing text.
- Keep technical details available in diagnostics/logging.
- Add recovery actions where useful: retry, refresh, reindex.

Verification:

- Missing remote folder shows a clean message.
- Rclone startup lag shows a temporary loading/retry state.
- Diagnostics still preserve technical details.
