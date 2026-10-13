# ~/.misty ledger

What the desktop app and CLI actually read, write, create, and enforce inside the
Misty home (`~/.misty`), and what a clean install should create. Sources of truth:

- `src-tauri/misty-home-layout.json`: shared by the desktop (`infra/misty_home.rs`)
  and the CLI (`cli/src/home.rs`). Directories are created on every launch; private
  files get owner-only permissions; retired paths move to the Trash.
- `misty home generate` (CLI) creates a fresh home for a new install.

Layout version: **2** (unchanged by this ledger; see "Migration" below).

## Target install

A fresh install should create exactly this, and nothing else up front:

```
~/.misty/
  home.json          manifest: {"format":"misty-home","layoutVersion":2}
  .auth/             account credentials (Windows and Linux; macOS uses Keychain)
  config/            settings.json, workspaces.json, and other files written on first save
  db/                data.db, created when the database opens
```

Everything else is created by the feature that first needs it.

## Ledger

### Keep: needed at install

| Path | Writer / reader | Notes |
|---|---|---|
| `home.json` | `misty_home.rs`, `home.rs` | Manifest. Layout version gate. |
| `.auth/*.secret` | `misty-credential-store` (`lib.rs`, `account.rs`) | Live account-token store on Windows and Linux. macOS migrates to Keychain (`docs/account-keychain.md`), so this is legacy only there. Created lazily by the crate; the layout keeps the folder so its owner-only DACL is applied at install. |
| `config/` | `environment.rs` | Folder for every config file below. |
| `config/settings.json` | `infra/settings.rs` | Written on first load, see "Enforced" below. |
| `config/workspaces.json` | `infra/workspaces.rs` | Created on first save. |
| `config/commands.msy` | `infra/commands.rs` | Keyboard shortcuts. Created on first change. |
| `config/navigation.json` | `infra/navigation_names.rs` | Navigation names. Created on first write. |
| `config/device-trust/` | `infra/device_trust.rs` | Per-account trust files, created on sign-in. |
| `config/kura-bridge.json` | `infra/clipboard_bridge.rs` | Approvals for the Kura bridge. Created on first approval. |
| `db/` | `environment.rs`, `infra/misty.rs`, `infra/agents.rs` | Holds `data.db`. The transfer queue that used to write here has been removed. |
| `db/data.db` | same | The application database. |
| `session.json` (home root) | `infra/misty.rs` (`write_session`) | Signed-in user and license. Written 0600 on Unix. **Added to `privateFiles` by this change**; it was not listed before. |

### Lazy: created by the feature that uses it, never at install

| Path | Writer | Notes |
|---|---|---|
| `tmp/clipboard-cache/v1/` | `domain/clipboard/cache.rs` | Created with `create_dir_all`. Moved out of the layout. |
| `.cache/listings/`, `.cache/remotes/` | `domain/listing_cache.rs` | Parent created on first write (line 56). |
| `.cache/thumbnails/` | `infra/explorer/preview.rs` | Created on first thumbnail. |
| `.cache/trash/` | `infra/explorer/local_mutations.rs` | Created on first explorer trash action. |
| `.cache/clipboard-paste/{text,blob}/` | `infra/explorer/clipboard_staging.rs` | Created on first paste. |
| `.cache/explorer_state.json` | `infra/explorer_library.rs` | Created on first write. |
| `.cache/agent-snapshots/` | `app/code_snapshots.rs` | Created when a snapshot runs. |
| `browser/site-permissions.json` | `infra/browser_site_permissions_store_file.rs` | Created on first permission change. Not in the layout before. |
| `agent-code/` | `misty_agent_code` service | Created by the agent-code service. |

Each of these is created inside the home, which already has an owner-only DACL on
Windows (inherited) and mode 0700 on Unix, so lazy creation keeps them private.

### Remove: no reader, writer, or purpose found

| Path | Why | Action taken |
|---|---|---|
| `tmp/downloads/`, `tmp/transfers/` | Listed as directories. No code path uses either name. | Removed from `directories`. |
| `.cache/search/` | Listed as a directory. No code path uses it. | Removed from `directories`. |
| `.cache/` (the folder itself) | Every child is lazy, so it does not need to exist at install. | Removed from `directories`. |
| `tmp/` (the folder itself) | Only holds the lazy clipboard cache. The `tmp_dir` accessor in `environment.rs` is never called. | Removed from `directories`. |
| `.local/bin/` | `misty_bin_dir()` (`infra/misty.rs`) only reports the path in `check_system`. Nothing writes there. Dependency lookup in `system_dependencies.rs` uses the real user profile's `~/.local/bin`, not `~/.misty/.local/bin`. | Removed from `directories`. |
| `config/misty.json` | Written by the CLI generator as `{"server":{"mode":"hosted"}}`. Nothing reads its value. The only reference is a `config_exists` boolean in `app-explorer.ts`, which is not shown in the UI. | Generator no longer writes it (`cli/src/home.rs`). Removed from `privateFiles`. |
| `config/jwt.secret`, `db/token.key` | Listed as private files. Nothing in the desktop, CLI, or server reads or writes them. | Removed from `privateFiles`. |

### Retired: moved to the Trash on upgrade, must not be created again

These come from the existing `retired` list. The code currently still produces two of
them, which the "Enforced" section below covers.

- `logs/`: `misty.rs` has `misty_logs_dir`, but its only caller, `spawn_logged_process`, has no callers, so nothing creates it at runtime.
- `.version`: `installed_version` reads it, but nothing in this repo writes it, so it normally reads as absent.
- `mnt/`: `mount_root()` is only used as a string prefix, but the settings default `.misty/mnt` is still written (see below).
- `config/settings.before-profiles.json`: **written by the desktop**, see "Enforced" below.

## Enforced by the desktop and not needed

These behaviors are not changed in this pass because they touch user settings data.
They need a decision.

1. **Every settings default is written to `settings.json` on every load.**
   `infra/settings.rs` (`load_settings` → `normalize_settings_document` → `ensure_section_defaults`)
   saves about 20 default keys, including `mount_path: ".misty/mnt"`, `extension_tools_path`, and the
   built-in page-state exclusion list. Those values are then pinned for that user, so a
   later change to a default never reaches existing users. A new install also gets a
   populated file before the user has changed anything.
   **Recommend:** persist only keys the user changed, and read defaults in code.
   This also removes the retired `.misty/mnt` default.

2. **`config/settings.before-profiles.json` is created on the second launch of every install.**
   `infra/settings_profile_store.rs::backup_legacy_settings` copies `settings.json` whenever the
   file exists and the backup does not. The profile migration is done (schema version 9), so the backup is
   only a leftover. The layout lists this file as retired, so `misty home check` reports it as a legacy
   path on a machine the desktop itself created it on.
   **Recommend:** delete the backup call, then bump `layoutVersion` to 3 and add the file to
   the retired list so existing installs move it to the Trash once.

3. **Dead code that names retired paths:** `infra/misty.rs` (`misty_logs_dir`, `append_log_file`,
   `spawn_logged_process`, `misty_bin_dir`, `legacy_misty_bin_dir`, `installed_version_path`). These
   are not called at runtime. `misty.rs` already has uncommitted changes from another thread, so this is
   not edited here.

## Migration

No layout version bump. Removing an entry from `directories` or `privateFiles` does not
need a migration, because existing folders are left alone and nothing is deleted.
Existing installs keep their empty folders. Their files are untouched.

## This machine (`C:\Users\mtcco\.misty`)

Read from the code and from listings that succeeded:

| Path | State | Action |
|---|---|---|
| `home.json` | v2 manifest | Keep |
| `.auth/` | 5 `.secret` files. Two are from 2026-10-13 (active). Three are from September and may be from older profiles. | Keep the active ones. Confirm the September ones with the user before removing. Contents not read. |
| `.retired/Misty retired files 2026-10-07 12.24.23/` | Snapshot from the 2026-10-07 layout move. Includes a 28 MB `misty-proxy` binary, encrypted mail cache, and an old `db/misty.db` (10 MB). | Candidate for deletion. **Needs your confirmation**, because it holds an old database. |
| `config/`, `db/`, `tmp/`, `.cache/`, `.local/` | Inaccessible from this session (the home's owner-only DACL denies the shell's token). Not inventoried. | Run the commands below in your own terminal, then decide. |

To inventory the locked folders, run this in your own terminal:

```bash
ls -la ~/.misty/config ~/.misty/db ~/.misty/tmp ~/.misty/.cache ~/.misty/.local
```

## Verification

- `cargo test --manifest-path cli/Cargo.toml home::`: 2 passed
- `cargo test --lib misty_home` in `src-tauri`: 4 passed
- The desktop `ensure_at` tests iterate the layout, so the trimmed `directories` list
  is exercised directly.
