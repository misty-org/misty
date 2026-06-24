# Remembered native permissions

The native host stores affirmative capability consent in authenticated AES-256-GCM
records under the local app-data directory, using one encryption key in `~/.misty/.auth/` under the
`com.misty.permissions` namespace. The key is loaded at
most once per process; both success and failure are cached across all apps,
windows, and permission entry points. Missing records do not load the key.
Records use random nonces and bind the owner namespace as authenticated data. The existing owner namespace binds it to
the canonical package installation, account, deployment and Space. A fingerprint
of the app identity, publisher, repository, permission version, full capability
declaration and network origins requires fresh consent when those inputs change.
Ordinary package version changes do not discard consent. Unidentified sessions
remain temporary. Session capability limits still apply to restored approvals.

The permission dialog labels persistent consent “Allow and remember”. App
permissions lists restored approvals and can revoke them. Local credential transactions
run on blocking workers behind an asynchronous queue, without holding the app
registry or UI thread while credential I/O is pending. Brief registry locks
snapshot and commit authority; epoch checks reject late approvals after closure
or revocation, and roll back their saved approval. Approval propagates to matching
live declarations; revocation immediately clears matching live grants and cancels
affected work across instances, before waiting for the vault transaction.
The encrypted record is atomically saved before new authority is granted. A failed
revocation write is reported, while live access is still removed. Live handles
are never persisted. Restoration is cached per registration, avoiding a credential
read for each file operation.

Saved folder records now include macOS security-scoped bookmark data alongside
the existing volume, inode and creation identity. Bookmark resolution does not
show UI, and validates the original object before granting access. The existing
identity lookup handles macOS resolving an old path to a replacement object.
Identity-only records migrate on a successful restore without changing their IDs.
Bookmarks are refreshed on restoration. The security-scope lease is retained for
the grant lifetime, shared on an authorized pane handoff, and released on close,
release or revocation. Existing local APFS/HFS+ support restrictions remain.

Verification includes native consent isolation and revocation tests, folder
move/replacement and migration tests, pane handoff/scope lifetime tests, frontend
permission tests, and disposable credential-file tests that restore consent and folder
access in fresh processes. These do not replace testing a rebuilt signed app's
macOS permission UI. Existing session-only approvals require one new remembered
approval after upgrading.

## Local credential access paths

Permission status and permission lists restore through `restore_instance`.
Approval and revocation use `decide_instance` / `persist_decision`; their reads,
writes and late-approval rollback all use the same process-wide permission vault.
The shared encryption key and saved-folder records use the native local credential
store. Registry locks are never held during credential I/O. Failed reads remain
cached until restart to avoid repeatedly attempting an inaccessible file.

No legacy Keychain probes remain. Existing Keychain records are untouched.
Import the original encryption key to retain existing encrypted permission
records, or grant permissions again. See [credential storage](credential-storage.md)
for the import procedure and backup-password precautions.

Restart a rebuilt native app to activate the file backend. Tests cover concurrent
owners, repeated writes/reads, cached failures, encrypted persistence, and rejection
of ciphertext copied to a different owner.
