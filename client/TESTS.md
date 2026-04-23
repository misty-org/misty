# Misty Client Test Backlog

This file is a backlog of automated tests worth writing for the C++ client.

Current direction:
- Prioritize `unit` and `integration` tests.
- Skip full GUI E2E for now.
- Cover UI behavior indirectly by testing state transitions, commands, path logic, file logic, and client/server flows.

How to use this file:
- Treat each item as a candidate test case, not a strict requirement.
- Mark items off as they are implemented.
- Prefer small, deterministic tests over giant scenario tests.
- If a behavior currently lives inside `render()`, consider extracting the logic into a helper/state method first, then test that helper.

## Unit Tests

### FileManager

- [ ] Acquire write lock on a new file succeeds.
- [ ] Acquire write lock twice for the same file from different clients fails or blocks as designed.
- [ ] Acquire write lock on two different files from different clients succeeds independently.
- [ ] Acquire read lock on an existing readable file succeeds.
- [ ] Acquire read lock while a writer is active is blocked or rejected as designed.
- [ ] Multiple readers can hold a read lock concurrently.
- [ ] Writer proceeds after all readers release.
- [ ] Releasing a write lock that is not held does not corrupt lock state.
- [ ] Releasing a read lock that is not held does not corrupt lock state.
- [ ] `ReleaseAllLocks()` clears both read and write lock state.
- [ ] Write without owning the write lock fails.
- [ ] Read without owning a read lock fails.
- [ ] Write at offset `0` creates or overwrites content correctly.
- [ ] Write at a middle offset patches content correctly.
- [ ] Sparse write creates expected zero-filled gap.
- [ ] Sequential chunk writes reconstruct the original file exactly.
- [ ] Zero-byte write succeeds and leaves file unchanged or creates empty file as designed.
- [ ] Read from offset `0` returns expected bytes.
- [ ] Read from non-zero offset returns correct suffix bytes.
- [ ] Read past EOF returns zero bytes or false as designed.
- [ ] Remove file with correct write lock succeeds.
- [ ] Remove file without lock fails with `FILE_LOCKED`.
- [ ] Remove missing file returns `FILE_NOT_FOUND`.
- [ ] Removing a file releases or preserves lock bookkeeping correctly.
- [ ] Nested parent directories are created automatically on write.
- [ ] `ResolvePath()` joins normal relative paths correctly.
- [ ] `ResolvePath()` normalizes `.` segments safely.
- [ ] `ResolvePath()` prevents escaping the mount via `..`.
- [ ] `ResolvePath()` handles repeated slashes consistently.
- [ ] `ResolvePath()` handles empty relative path consistently.
- [ ] `ResolvePath()` handles platform separators consistently.
- [ ] `GetFileHash()` is stable for identical content.
- [ ] `GetFileHash()` differs for different content.
- [ ] `GetFileHash()` handles empty files.
- [ ] Large-file hashing completes and returns deterministic result.

### MistyClient

- [ ] Client mount path getter returns the configured mount path.
- [ ] Store request for a missing local file returns `NOT_FOUND`.
- [ ] Store request for an empty file streams successfully.
- [ ] Store request for an exact chunk-size file uploads successfully.
- [ ] Store request for a file spanning multiple chunks uploads successfully.
- [ ] Fetch request writes downloaded bytes to the expected local destination.
- [ ] Fetch request for a missing remote file returns `NOT_FOUND`.
- [ ] Remove request returns expected gRPC status for successful delete.
- [ ] Remove request returns expected gRPC status for missing file.
- [ ] List request maps server reply into `ListFilesRes` correctly.
- [ ] Client preserves binary file contents exactly through store/fetch.
- [ ] Client handles server-side failure status without crashing.

### Server / Reactor Logic

- [ ] `ListFiles` returns files and directories with correct `is_dir` metadata.
- [ ] `ListFiles` rejects non-directory paths with `FAILED_PRECONDITION`.
- [ ] `ListFiles` returns `NOT_FOUND` for missing paths.
- [ ] `StoreFile` rejects writes when lock acquisition fails.
- [ ] `StoreFile` releases write lock after success.
- [ ] `StoreFile` releases write lock after failure.
- [ ] `FetchFile` acquires and releases read lock correctly.
- [ ] `FetchFile` stops cleanly at EOF.
- [ ] `FetchFile` returns error for missing file.
- [ ] `RemoveFile` maps `FILE_OK` to `OK`.
- [ ] `RemoveFile` maps `FILE_NOT_FOUND` to `NOT_FOUND`.
- [ ] `RemoveFile` maps `FILE_LOCKED` to `FAILED_PRECONDITION` or the intended status.
- [ ] `ListFiles` computes hashes only for regular files.
- [ ] Store/fetch paths are resolved under the configured mount only.

### File Explorer Path Utilities

- [ ] `is_remote_path()` returns false for local filesystem paths.
- [ ] `is_remote_path()` returns false for the mount root itself.
- [ ] `is_remote_path()` returns true for provider root children.
- [ ] `parse_remote_path()` parses provider-only path correctly.
- [ ] `parse_remote_path()` parses provider plus remote folder correctly.
- [ ] `parse_remote_path()` parses provider, remote, and deep relative path correctly.
- [ ] `parse_remote_path()` returns empty fields for non-remote paths.
- [ ] `parse_remote_name_and_path()` returns the expected pair for remote paths.
- [ ] `split_path()` splits simple slash-separated paths correctly.
- [ ] `split_path()` ignores repeated slashes consistently.
- [ ] `split_path()` handles leading slash consistently.
- [ ] `split_path()` handles trailing slash consistently.

### File Explorer State

- [ ] `path_for_selection()` returns the backing file path for a known selected id.
- [ ] `path_for_selection()` falls back to the id itself when item is missing.
- [ ] `is_downloading()` returns false for unknown paths.
- [ ] `is_downloading()` returns true after path is inserted.
- [ ] Clipboard state reports empty when no items are present.
- [ ] Clipboard state reports populated after copy setup.
- [ ] Clipboard `clear()` resets operation, paths, and items.
- [ ] `make_file_id()` returns stable local ids for local paths.
- [ ] `make_file_id()` returns unique ids for remote items.
- [ ] Recent/starred/trash virtual path constants behave as expected in helpers.

### File Explorer Persistence

- [ ] `load_state()` with no existing file keeps defaults.
- [ ] `save_state()` writes recent/starred/persisted state successfully.
- [ ] `load_state()` restores previously saved state.
- [ ] `load_state()` tolerates malformed JSON or config data without crashing.
- [ ] `save_state()` preserves empty collections correctly.
- [ ] `last_opened_path` is restored when valid.
- [ ] Invalid persisted local path is ignored safely.
- [ ] Persisted remote path is accepted without creating phantom local directories.

### File Explorer Helper Logic

- [ ] Remote folder sanitization replaces forbidden characters.
- [ ] Remote folder sanitization falls back to default name when preferred is empty.
- [ ] Remote folder sanitization trims surrounding whitespace.
- [ ] Preview format detection recognizes PNG.
- [ ] Preview format detection recognizes JPG/JPEG.
- [ ] Preview format detection recognizes PDF.
- [ ] Preview format detection returns unknown for unsupported extension.
- [ ] Preview format detection is case-insensitive.
- [ ] Preview zoom clamp enforces minimum bound.
- [ ] Preview zoom clamp enforces maximum bound.
- [ ] Preview zoom clamp preserves in-range values.
- [ ] Filename extraction returns basename for POSIX path.
- [ ] Filename extraction returns basename for Windows-style path.

### CommandManager

- [ ] Default commands load when no user config exists.
- [ ] Missing user commands file is created automatically.
- [ ] User overrides are loaded from config.
- [ ] Runtime commands can be registered after load.
- [ ] Runtime commands are cleared correctly.
- [ ] Registering an empty runtime command is ignored safely.
- [ ] Registering an empty runtime shortcut is ignored safely.
- [ ] Updated default shortcuts are backfilled into user config.
- [ ] Shortcut parser accepts primary modifier combos.
- [ ] Shortcut parser accepts shift/alt/ctrl/super combos.
- [ ] Shortcut parser rejects unknown keys safely.
- [ ] Label formatting for shortcuts is stable.

### View Registry / Navigation

- [ ] Registering a view stores it successfully.
- [ ] Switching to a registered view updates the current view id.
- [ ] Switching to an unregistered view leaves the current view unchanged.
- [ ] Rendering with no current view is a no-op.
- [ ] Navbar state `handle_nav_item()` updates selected item.
- [ ] Navbar state `handle_nav_item()` switches the global view.
- [ ] Navbar state `handle_logo_click()` switches to auth view.

### Workspace / Services State Helpers

- [ ] Workspace mount root helper returns non-empty path.
- [ ] Account mapping normalization keeps provider and folder names aligned.
- [ ] Dirty-indicator callback registration and replacement work as expected.
- [ ] Services state init is idempotent.
- [ ] Fetch flags transition correctly during async workspace fetch setup.

## Integration Tests

### Single Client File Flows

- [ ] List empty directory returns no entries.
- [ ] List directory containing files returns expected filenames.
- [ ] List directory containing directories marks directory entries correctly.
- [ ] List non-existent directory returns `NOT_FOUND`.
- [ ] List path that is a file returns `FAILED_PRECONDITION`.
- [ ] Store empty file uploads successfully.
- [ ] Store small text file uploads with matching hash.
- [ ] Store exact chunk-size file uploads with matching hash.
- [ ] Store multi-chunk binary file uploads with matching hash.
- [ ] Store nested path like `subdir/deep/file.txt` creates parent directories on server.
- [ ] Store overwriting an existing file replaces contents fully.
- [ ] Fetch small file downloads with matching hash.
- [ ] Fetch empty file downloads as zero-byte file.
- [ ] Fetch large file downloads with matching size and hash.
- [ ] Fetch overwrites stale local contents correctly.
- [ ] Remove stored file deletes it from server.
- [ ] Remove non-existent file returns `NOT_FOUND`.
- [ ] Store then fetch round-trip preserves binary equality.
- [ ] Store then list shows uploaded file in the parent directory.

### Multi-Client Locking and Concurrency

- [ ] Client A writes while Client B tries to write the same file.
- [ ] Client A writes while Client B tries to fetch the same file.
- [ ] Client A reads while Client B tries to delete the same file.
- [ ] Client A deletes after Client B releases read lock.
- [ ] Two clients write different files concurrently without interference.
- [ ] Multiple clients fetch the same file concurrently.
- [ ] Multiple clients list the same directory concurrently.
- [ ] One client rapidly overwrites while another repeatedly fetches; behavior matches design.
- [ ] Lock cleanup after a failed upload leaves file writable by another client.
- [ ] Lock cleanup after failed fetch leaves file readable by another client.

### Path and Validation Flows

- [ ] Store path containing traversal segments is rejected safely.
- [ ] Fetch path containing traversal segments is rejected safely.
- [ ] Remove path containing traversal segments is rejected safely.
- [ ] Store path with repeated separators resolves safely.
- [ ] Store path with `.` segments resolves safely.
- [ ] Very long nested paths fail gracefully if OS limits are exceeded.
- [ ] Invalid filenames fail gracefully on the current platform.

### Failure and Resilience

- [ ] Client handles server shutdown during request without crashing.
- [ ] Client handles reconnect to a restarted in-process test server.
- [ ] Partial upload failure does not leave corrupted visible file state.
- [ ] Server-side write failure returns non-OK status to client.
- [ ] Failed delete leaves original file untouched.
- [ ] Failed fetch does not leave partially written local file or leaves it in documented state.
- [ ] Large upload canceled mid-stream leaves lock state cleaned up.
- [ ] Large fetch canceled mid-stream leaves lock state cleaned up.

### File Explorer Integration (No GUI Automation)

- [ ] Initial explorer state uses workspace mount path when available.
- [ ] Initial explorer state falls back to client mount path when workspace path is unavailable.
- [ ] Persisted last-opened local path is restored on panel construction.
- [ ] Invalid persisted local path falls back safely.
- [ ] Persisted remote path is restored without creating stray local directories.
- [ ] Pending navigation path is consumed and applied on render/update cycle.
- [ ] Back history updates after navigation.
- [ ] Forward history updates after navigating back and forward.
- [ ] Refresh keeps current path stable.
- [ ] Search panel selecting a result updates explorer pending navigation path.
- [ ] File sidebar shortcuts update explorer pending navigation path to expected destination.
- [ ] Device selection updates explorer pending navigation path correctly.

### Remote Mapping / Workspace Integration

- [ ] Remote account mappings create expected provider-folder layout under mount root.
- [ ] Alias-based folder names are sanitized consistently.
- [ ] Changing mappings re-syncs explorer-visible remote folders.
- [ ] Dirty-indicator callback marks matching remote file entries as dirty.
- [ ] Dirty-indicator callback ignores updates for unrelated remotes.
- [ ] Dirty-indicator callback ignores updates for unrelated directories.

### Command and Navigation Integration

- [ ] Loading command config then opening panel exposes expected command labels.
- [ ] Runtime extension commands register and become queryable.
- [ ] Triggering a navigation state handler changes the active view globally.
- [ ] Switching views preserves current view when target view is missing.

### Application-Level Persistence

- [ ] App shutdown saves explorer state.
- [ ] App restart reloads saved explorer state.
- [ ] Multiple explorer instances maintain separate state keys correctly.
- [ ] Shared clipboard state is visible across panes/tabs that use the same registry key.

## Nice-to-Have Later

- [ ] Benchmark: upload throughput for large files.
- [ ] Benchmark: fetch throughput for large files.
- [ ] Stress: many tiny files uploaded in sequence.
- [ ] Stress: repeated list/store/fetch/delete loop for race detection.
- [ ] Stress: repeated lock contention test under thread sanitizer.
- [ ] Property-style tests for path normalization and path traversal prevention.

## Out of Scope for Now

These are intentionally not the current priority:

- Full GUI click automation for ImGui widgets.
- Pixel-perfect screenshot tests.
- Desktop/window-manager E2E tests.
- Native file picker automation across all platforms.
- Full usability/feedback validation, which is better handled manually right now.
