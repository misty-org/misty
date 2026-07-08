# Misty Dogfood QA

Use this before sharing a build or doing a daily-driver pass.

## Overnight Hardening Notes

- Default Delete no longer promotes mixed local + remote selections to permanent delete. Pressing Delete on a mixed selection only trashes eligible local items; explicit Delete Permanently is still available from the context menu.
- Remote-only selections still default to permanent delete because remotes do not support local Trash semantics.
- Trash entries are only eligible for Delete Permanently.
- Search index status now reports total, local, and remote indexed item counts, plus local root and remote counts.
- Search scan errors and common remote/backend failures use recovery-oriented text in Explorer and Settings.
- Explorer table widths are clamped on load and can be reset from the table header when customized widths are active.

## Manual QA

### File Operations

- Select one local file in a normal folder and press Delete. It should queue Trash, not permanent delete.
- Select one remote file and press Delete. It should queue permanent delete and respect destructive confirmation settings.
- Select one local file and one remote file together, then press Delete. The local item should be the only item queued for Trash.
- Open the context menu on a mixed local + remote selection. Trash should be unavailable, and Delete Permanently should require explicit selection.
- Open `misty://trash`. Trash should not be offered for deleted entries; Delete Permanently should be the only delete action.

### Search Settings

- Run a full reindex from Settings > Search. Local items, remote items, local roots, and remotes should update after the scan completes.
- Confirm the last-indexed timestamp reads like `M/DD/YYYY h:mm AM/PM`.
- Disconnect or make a remote unavailable, run reindex, and confirm scan errors are concise and recovery-oriented.
- Search for a stale/deleted indexed result and confirm Explorer asks the user to reindex instead of showing raw backend text.

### Table Layout

- Resize Modified, Size, and Type columns individually. Other stored column widths should remain stable.
- Reload Explorer and confirm widths are restored but clamped to sane limits.
- Use Reset columns from the table header and confirm widths return to defaults.

### User-Facing Errors

- Browse a missing local folder or stale indexed folder. The message should say the item could not be found and suggest refresh/reindex.
- Browse a temporarily unavailable remote. The message should tell the user to refresh remotes or check the connection.
- Confirm technical details are still present in diagnostics/logging where available.

## Local Verification

- `npm run build:desktop`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`

Known blocker:

- `cargo test --manifest-path src-tauri/Cargo.toml search` currently fails during test compilation in `src-tauri/src/services/providers.rs` because several provider tests index into a `Result<serde_json::Value, ApiError>` without unwrapping it first. This is unrelated to the search status changes but blocks targeted Rust test execution.
