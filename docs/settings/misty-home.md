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
  cache/  tmp/               disposable (tmp holds the cloud clipboard cache, 72 h TTL)
```

The master key that encrypts every credential in `misty.db` lives in the OS keychain under
the service `com.misty.auth` (macOS Keychain, Windows Credential Manager, Linux Secret
Service); debug builds use `.local/data/dev-master.key` instead, so rebuilds never prompt.
Nothing else holds a credential.

`misty.db` holds (one numbered migration each, `PRAGMA user_version`): credentials,
settings, navigation names, keyboard shortcuts, the signed-in session record, trusted-device
records, Kura approvals, site permissions, shared agent folders, the browser library
(downloads and history), extension sync journals and pending removals, the file list's
recents, the file organizer's journal, and the layout version. Each earlier-layout file or database is imported once
(`legacy_imports`) and left in place.

Two stores stay outside `misty.db` on purpose: the browser-sync vault and the workspace
recovery database. Each is cryptographically bound to one account and holds counters that
must never be copied or merged, and each has its own process lock.

The file organizer's journal is in `misty.db` too (`agent_file_grants`,
`agent_file_manifests`). Every save is a committed transaction (WAL, `synchronous=FULL`),
so a plan is on disk before its first move and each receipt before the next one.

Everything else is created by the feature that first needs it.

## Retired

Everything an earlier layout kept elsewhere is retired when the layout version rises: the
`.auth` credential files, `home.json` (the version is now a row in `misty.db`), `config/`
settings and the JSON files that moved into `misty.db`, `db/`, `cache` under its old name,
and the old CLI binary folder.
