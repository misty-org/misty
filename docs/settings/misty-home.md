# ~/.misty ledger

What the desktop app and CLI actually read, write, create, and enforce inside the
Misty home (`~/.misty`), and what a clean install should create. Sources of truth:

- `src-tauri/misty-home-layout.json`: shared by the desktop (`infra/misty_home.rs`)
  and the CLI (`cli/src/home.rs`). Directories are created on every launch; private
  files get owner-only permissions; retired paths move to the Trash.
- `misty home generate` (CLI) creates a fresh home for a new install.

Layout version: **5** (see "Migration" below).

## Target install

A fresh install creates exactly this, and nothing else up front:

```
~/.misty/
  .local/data/
    misty.db                 every structured store (see below), plus -wal/-shm
    workspace-recovery/<id>/ one encrypted recovery database per account
  .local/sync/<id>/          one encrypted vault database per account (own process lock)
  profiles/<profile>/webview   website data: a real folder on Windows/Linux, a symlink to
                               WebKit's store on macOS
  cache/                     disposable
```

The master key that encrypts every credential in `misty.db` lives in the OS keychain under
the service `com.misty.auth` (macOS Keychain, Windows Credential Manager, Linux Secret
Service); debug builds use `.local/data/dev-master.key` instead, so rebuilds never prompt.
Nothing else holds a credential.

`misty.db` holds (one numbered migration each, `PRAGMA user_version`): credentials,
settings, navigation names, keyboard shortcuts, the signed-in session record, trusted-device
records, site permissions, shared agent folders, the browser library (downloads and history),
extension sync journals and pending removals, and the layout version. Files from an earlier
layout are not read.

Two stores stay outside `misty.db` on purpose: the browser-sync vault and the workspace
recovery database. Each is cryptographically bound to one account and holds counters that
must never be copied or merged, and each has its own process lock.

Everything else is created by the feature that first needs it.

## Retired

Everything an earlier layout kept elsewhere is retired when the layout version rises: the
`.auth` credential files, `home.json` (the version is now a row in `misty.db`), `config/`
settings and the JSON files that moved into `misty.db`, `db/`, `tmp/`, the old
`.local/data/browser-sync` folder, `cache` under its old name, and the old CLI binary folder.

The coding feature left a `checkpoints` folder in the home. Unlike other retired paths it is
deleted, not moved to the Trash, by a one-time cleanup at launch (`infra/retired_coding_data.rs`).
It removes only `<misty home>/checkpoints`, only when that is a real directory, and on its own
thread, so launch never waits or fails because of it. A removal that fails is tried again next
launch. A mark in `settings_state` stops it running once it has worked or there was nothing to
remove. `misty.db` migration 20 removes the `coding_*` preferences, and `HostMain.tsx` removes the
old browser storage keys.
