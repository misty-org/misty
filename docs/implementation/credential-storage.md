# Local native credential storage

All macOS runtime credential operations use `misty-credential-store` under
`src-tauri/vendor/`. The native host and the desktop keystore plugin share this
library, so Misty apps using coding-provider, device-identity, backup or permission
commands inherit the same file backend. No runtime macOS Keychain reads, writes,
deletions or legacy permission probes remain.

The root is `~/.misty/.auth/`. A credential file name hashes the configured
`MISTY_PROFILE` (or `MISTY_DESKTOP_PROFILE`), service name and account name, with
unambiguous length boundaries. Files are atomically replaced with mode 0600,
inside a mode-0700 directory. The directory must belong to the current user and
cannot be a symlink. Reads require regular, singly linked, user-owned files and
reject symlinks. The OS user can still read these files; application-specific
Keychain access controls are intentionally absent.

Account JWT cookies are stored by native HTTP clients in a separate service namespace,
bound to API origin and account ID. They never pass through JavaScript. The
multi-account index contains non-secret `cookie-session:<account-id>` handles.
Requests use cookies; the HTTP helper refreshes once after an expired access JWT,
without replaying a request under a newly selected account. Browser builds use
only browser cookies. Native mobile builds use the same native HTTP transport
and their private app-data `.auth` directory.

## Existing credentials

Existing macOS debug credential files migrate automatically on first read. The
old file is removed only after the new atomic write succeeds. Existing production
Keychain entries are not queried or deleted: login requires signing in again,
provider keys can be re-entered, and missing device identities can be re-paired.
Previously encrypted permission records fail closed until permissions are
granted again or their original encryption key is imported.

Encrypted backups need their **original password**, not a newly generated one.
Export any needed credential from the old store before discarding it. To import
an exported credential without putting its value into command-line arguments,
pass a JSON object on standard input to:

```sh
cargo run --manifest-path src-tauri/vendor/misty-credential-store/Cargo.toml --bin import_credentials < private-export.json
```

The object has `service`, `account` and `value` string fields. Use the same Misty
profile when importing and launching the app. The utility rejects replacement
of a different existing value and does not print secrets. Keep exported files
private and remove them after verifying the import. It never contacts Keychain.

Relevant service names are `com.misty.coding-ai.api-key` (provider ID account),
`com.misty.backups` (`repository:<id>` account), `com.misty.native-app.backups`
(`<owner>:<repository-id>` account), `com.misty.permissions`
(`installation-encryption-key` account), and
`com.misty.native-app.directory-bookmarks.v1` (owner namespace account).
Device credentials retain their service and account names from the native
identity modules. Preserve the exact stored encoding of each value.

Rebuild and restart the native app to activate this backend. Existing running
binaries continue to use their compiled credential implementation.
