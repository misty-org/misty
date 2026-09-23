# Native browser sync core

This crate contains native-only vault encryption, signed protocol messages,
durable encrypted mutation storage, OS-protected remembered roots, bounded HTTP/
WebSocket transport, a typed document reducer, and an owned reconnecting worker.
The application now has a native registry and restricted IPC for connecting a
vault, creating its encrypted wrapper/device atomically, and unlocking a cached
vault offline. A preview Settings form and the frontend workspace bridge now connect to this
registry. Renderer edits carry stable intent IDs, deduplicated by encrypted local
receipts even after their outbox entries are replayed. Browser credential
capture/import, cold-start locked-draft recovery, and complete legacy-state migration remain
incomplete. Do not claim signed-in website session handoff from these tests.

Run from the repository root:

```sh
cargo test --manifest-path src-tauri/crates/browser-sync/Cargo.toml
cargo clippy --manifest-path src-tauri/crates/browser-sync/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml --lib
```

The OS credential-store test is opt-in because it accesses the current user's
Keychain/Credential Manager. It creates a unique disposable test record and removes
it on completion:

```sh
cargo test --manifest-path src-tauri/crates/browser-sync/Cargo.toml secure_store::tests::os_store_roundtrip_and_forget -- --ignored --exact
```

`tests/fixtures/protocol-v1.json` contains public, fake test credentials and an
encrypted fixture. The identical file is kept by the server under
`internal/platform/postgres/testdata/browser-sync-protocol-v1.json`. Go tests
independently check native signing bytes and Ed25519 signatures. The fixture
generator is a development example, not a production enrollment path.

For the opt-in live native/server test, build `--example live_protocol_fixture`
and set `MISTY_BROWSER_SYNC_NATIVE_FIXTURE` to its absolute binary path when running
the server's `TestBrowserSyncNativeWorkerAgainstGo`. Also set
`MISTY_BROWSER_SYNC_TEST_DSN` to the guarded disposable test database (see the
server test helper). It bootstraps a test vault, connects two native workers to
separate server instances, forces an outage, persists an offline mutation,
restarts a worker, and checks recovery, deduplication, readiness, identity failure,
and rollback detection. The server drops the first committed bootstrap response;
the worker recovers the same vault and device. Nine typed mutations also verify disjoint workspace edits,
atomic credential conflict rejection, and logout versus stale tokens. It uses
synthetic data, not real browser credentials.

The store deliberately requires a pure reducer. Emit UI changes, browser imports,
or outbound notifications only after a transaction commits. Received mutations
must never trigger external agent actions. `document::reduce` provides field-level
workspace merges, tombstones, atomic credential base versions, and per-device
resume records. `pending_snapshot` overlays durable local edits for native-only
validation/projection without changing committed state. Its tentative sequence
must never become a replay or browser-import cursor. The worker validates local
edits before queueing them, including references to pending creates.

Checkpoints, revocation/rotation, and browser adapters remain to implement. The
host owns one worker per account/device and must await worker shutdown before
completing lock or account switching. Do not expose raw committed/pending snapshots
to webviews: use `Document::workspace_view`, which excludes credential data.


A macOS WKHTTPCookieStore adapter now lives in the native host's
`infra/browser_cookie_store.rs`. Five Foundation/profile-validation tests pass,
including rejection of lossy expiry conversion and native partition/port metadata.
The `cookie_store_probe` example also passes 40 live WebKit-store round trips,
same-profile visibility, callback completion and cross-profile rejection. The
sync crate rejects duplicate leading-dot aliases while permitting distinct
host-only/domain identities. The adapter is driven by the worker in the isolated native probe; the production
profile registry participates in native selection for activated bindings. The
macOS host now polls cookies in those activated stores while the vault is open;
initial profile migration and incoming restore coordination remain pending.
Windows, partition coverage, network semantics and provider-session acceptance
remain open. The protocol document records exact scope.

`store::BrowserImportJournal` records native restore intent before browser writes.
The worker exposes native-only begin/read/finish/quarantine methods; credential
capture is blocked while a profile has pending work. Completion compares all
target areas to native read-back, and `imports_applied` rejects missing or stale
receipts. The six journal tests cover crash recovery, ciphertext binding, failed
transactions, expiry and capture suppression. The live Rust/Go/PostgreSQL fixture
also verifies pending-import recovery across worker restart. Host integration and
safe quarantine recovery remain required; these APIs alone do not restore browsers.


`restore::restore_profile` runs native preflight, durable begin, awaited apply,
readback and finish under a shared worker import lease for unmapped profiles.
`restore_staged_profile` additionally checks the native-allocated generation and
physical engine identity. A reserved command slot queues quarantine if a writing
future is canceled.

`store::BrowserProfileBinding` encrypts device-local active/staged/retired physical
identities. Stage replacement atomically invalidates an old pending receipt;
activation requires verified current credentials and preserves the predecessor.
Capture and readiness remain blocked until activation. Cleanup acknowledgement is
native-only and requires completed engine deletion. The macOS probe verifies real
allocated stores, restart and explicit logout while retaining predecessor cookies.
The combined suite has 46 passing tests and one opt-in keychain test ignored.

The caller must own quiescent profiles and the account lifetime. The host now serializes view creation/account shutdown and resolves activated
profiles, but legacy migration, automatic profile switching, complete storage capture,
storage and Windows remain unfinished. Durable receipts alone do not prove an engine retained its
session data after process restart; the host must read back before activation.


`restore::verify_active_profile` rechecks an activated generation using actual
native observations under the worker import lease. It never calls the backend's
apply method. The host calls it before first selecting that store in a process.
The WebKit probe verifies a post-receipt cookie mutation is detected and preserved.
Account changes now await native creation, reject stale queued creation, revoke
agent leases without discarding scope tombstones, and close prior browser views.
These boundaries do not by themselves implement automatic capture or handoff.

`store::BrowserObservation` accepts complete native area snapshots into a separate
encrypted capture journal. It persists the latest observation and a stable intent
before inserting an outbox operation. Only one credential operation per profile
is in flight; later observations coalesce until ordered replay establishes the
next base version. A remote logout or superseding rotation requires import rather
than rebasing stale local tokens. Profile staging blocks unresolved publication.
The five capture tests cover offline restart/coalescing, a failed outbox insertion,
remote logout, partial observations and the acknowledgment/bookkeeping crash gap.
The real WebKit probe additionally drives native observations into the worker's
encrypted outbox while offline.

The host observer currently polls every two seconds under the account lifetime
lease, stops on vault lock/account replacement, and only operates already activated
profiles. It does not migrate legacy stores or apply incoming credentials. The
transport remains WebSockets. Server acknowledgment alone does not prove native
restoration: a fresh matching engine observation is required for readiness.
