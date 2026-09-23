# Browser workspace synchronization protocol

Status: implementation in progress. This is a multiwriter WebSocket design,
superseding the earlier single-writer/SSE checkpoint proposal.

## Current implementation boundary

The backend now has versioned encrypted key wrappers, vault-authorized device
signing identities, a transactional event log, deduplication receipts, ordered
replay, and a WebSocket service. The native `misty-browser-sync` crate now provides
vault wrapping, signed encrypted mutations, transactional SQLite persistence,
and OS credential-store adapters. It also has a bounded HTTP/WebSocket transport
and an owned native worker for reconnect, publication, replay, and presence. Two
Rust workers have been exercised against the real Go handlers and PostgreSQL.
A typed native document reducer now handles workspace fields, deletion tombstones,
per-device resume records, and atomic version-checked credential batches. A native
application registry can connect an existing vault through main-window-only IPC,
project safe workspace fields, and shut down before account-cookie replacement.
Native vault creation, offline unlock, account-startup setup/unlock and automatic
remembered-key reconnection are wired to the renderer workspace bridge. Workspace
selection follows the latest server-ordered resume. Native cookies, localStorage,
per-tab sessionStorage and a bounded portable IndexedDB adapter now feed automatic
capture/import. Native desktop layout recovery uses a separate OS-protected key.
See the [current user flow and bounds](browser-handoff-test-checklist.md).

The transport below is still the earlier encrypted event log. The accepted
latest-snapshot/CAS/component-reference design, key rotation/revocation UX and
provider/device runtime acceptance remain unfinished. Compilation does not prove
that every website accepts a transferred session. No server deployment was made.

Verification so far: real PostgreSQL tests with separate server/listener instances
cover concurrent socket writers, lost acknowledgments, reconnect replay, ticket
reuse, identity failures, and transaction rollback. Native tests cover restart
durability, rollback during enqueue/apply, replay deduplication and gaps, concurrent
local counter allocation, ciphertext-only database/WAL contents, account/device
binding, and tampering. A shared public fixture verifies Rust signature encodings
and signatures in Go. A live Rust/Go fixture covers concurrent clients, signed
enrollment and connection, a forced network outage, offline writes, client
restart, replay convergence, and readiness gated on the applied import cursor.
Its nine typed mutations exercise disjoint workspace edits, atomic rejection of
stale credential batches, rotation, and logout that old offline tokens cannot undo.
The server deliberately drops the first successful bootstrap response; the worker
recovers the committed vault and exactly two device identities. Local tests verify
that wrapper/device creation rolls back together and that a cached wrapper unlocks
the same root, device, and pending outbox after restart without network access.
Native application tests also verify worker shutdown before account replacement,
exclusive process ownership of a device database, and rejection of old worker
handles after lock.
The complete macOS native library passes `cargo check`.
An explicit disposable macOS Keychain test passed remember/recall/forget. Windows
Credential Manager has not been runtime-tested; cross-compilation from this Mac
stops in bundled SQLite because the Windows C SDK headers are unavailable.

## Public interfaces

Routes mount under the existing server API prefixes:

- GET/POST `/sync/workspace`: fetch or bootstrap the personal workspace, encrypted
  vault key wrapper, public root identity, and initial signed device grant.
- GET/POST `/sync/devices`: obtain public signing grants or enroll a device using
  the vault root's signature. Revoked device identities cannot be reenrolled.
- POST `/sync/ticket`: account-authenticated, protocol-versioned, single-use
  connection ticket for an enrolled device; expires after 60 seconds.
- GET `/sync/ws?ticket=...`: upgrade, then prove possession of the device key
  against a fresh server challenge before receiving any private workspace data.
- Checkpoint transfer and rotation/revocation endpoints remain to implement.

WebSocket frames: server challenge; client authenticate; server welcome/devices/
presence; client publish; server ack/error/events; client heartbeat/resume; server
checkpoint_required. Account-event notifications share the authenticated stream.
Every reconnect obtains a fresh ticket and replays from the last durable client
cursor. Connections expire after ten minutes to renew account authorization.

The Rust worker continues accepting encrypted local edits while connecting or
backing off. Network retries use jitter with a 30-second ceiling. Publication is
ordered with one in-flight operation; an acknowledgment timeout reconnects and
replays before retrying. Incoming frames are capped at 6 MiB, and publication is
paced below the server's frame limit. Blocking identity/storage/protocol errors
retain the outbox and enter an attention state instead of resetting local data.
Stopping the worker cancels connection attempts; the host must await its task
before reporting the vault locked. HTTPS is required except on loopback test or
local development endpoints. TLS uses native trust roots with an explicit Rustls
provider. The native account-cookie HTTP client must disable redirects.

Each publication carries a workspace UUID, operation UUID, device UUID, monotonic
device counter, key epoch, AES-GCM envelope, and Ed25519 signature. Server receipt
contains operation UUID and committed workspace sequence. Publication is an
encrypted mutation batch; the backend never receives tab URLs, cookies, tokens,
origin storage contents, or mutation semantics in plaintext.

Signature bytes are UTF-8 JSON arrays in the precise order implemented by
`SyncMutation.SigningBytes`, `SyncDeviceGrant.SigningBytes`, and
`syncConnectionProof`. IDs use canonical lowercase UUIDs; binary data is standard
padded Base64. Numeric counters are positive safe integers (at most 2^53-1).
Device grants bind workspace, device, key epoch, and public key. Mutation signatures
bind immutable sender metadata and ciphertext, not a sequence assigned later by
the server. Native implementations must match these encodings with cross-language
fixtures before release.

## Native application boundary

`infra/browser_sync.rs` owns the active native session. Account selection is
checked against the native cookie jar. First setup generates a random vault root,
wraps it using the user's password and sync secret, then commits the encrypted root
wrapper, encrypted device identity, and initial document in one SQLite transaction.
Only afterward can the worker contact the bootstrap/enrollment endpoints. Pending
enrollment is durable and retried during reconnect. A lost bootstrap response is
resolved by matching the existing remote vault; a different root is never adopted.

Secret generation is a separate command so the setup UI can show the secret
before submitting setup; losing that response must not strand a user who never
received their secret. Neither that secret nor the password is cached. An existing cached vault unlocks on a blocking task without a server
request, using both secrets or an OS-remembered root. Its worker verifies current
account/device authorization and the pinned root/wrapper on reconnect. Rotation
still requires a future authenticated transition; arbitrary remote wrapper changes
are rejected. Removing a remembered key also works while the vault is locked.

A per-database OS file lock prevents two processes using the same device identity.
Account-scoped storage can discover and upgrade older workspace-scoped native
vaults in place after authenticated unlock. Migration preserves the device key,
counter, receipts, and outbox; it does not move/copy a live database or silently
reenroll another identity. Multiple ambiguous older vaults require recovery.

Main-window IPC covers availability, sync-secret generation, setup, unlock,
workspace view/edit/resume, lock, and removal of remembered keys. Embedded websites,
installed-app views, and agent windows cannot call these commands. Edit, resume,
and lock carry a fresh native session ID, preventing delayed commands from an old
account from changing a replacement session. Account-cookie selection holds the
same registry mutex across worker shutdown and jar replacement. Lock waits for
the worker task and aborts its notification task before returning.

The view contains shared records, resume metadata, pending operation IDs, presence,
and status. It has no cookie/storage credential payloads or encryption/signing
keys. Safe cached workspace fields remain readable when a worker stops with an
attention error. Browser import completion is deliberately not a renderer command;
only the native browser adapter may make that readiness assertion.

Pending local edits are applied to a tentative native snapshot for offline UI
projection and validation. Invalid edits are rejected before a device counter is
allocated. Tentative versions are never import/replay cursors: IPC reports the
committed sequence separately from pending operation IDs. This is not yet mounted
to the frontend workspace store. The standalone frontend projection preserves
device-local focus and places orphaned tabs in deterministic recovery layouts;
those synthetic layouts must never be echoed back as new shared records.

## Durability, ordering, and merge rules

A native SQLite transaction stores each local mutation and its encrypted outbox
entry. Retries reuse operation identity and ciphertext. Imported state does not
create new local mutations. A single native coordinator prevents multiple windows
from allocating the same device counter.

The backend locks a workspace row only while assigning the next sequence and
committing the event, receipt, and device high watermark. This is not a device
ownership lease: both devices may write. Matching operation retries return the
original receipt; conflicting bytes fail. Out-of-order device counters fail.
Receipt compaction never resets device high watermarks.

Clients apply a contiguous event sequence. Gaps trigger replay; compacted gaps
require a checkpoint. Disjoint workspace fields merge; the latest accepted edit
to the same field wins. Deletions must retain enough identity to reject stale
resurrection. Atomic layout changes cannot silently discard orphaned tabs.
Credential batches have additional base-version checks on clients: never blindly
replay old offline tokens over newer credentials.

The native store durably records the highest observed server head, including
acknowledgments received before their events are applied. Reconnect rejects a
server welcome behind that head. Gap replay requests are bounded; contradictory
receipts/signatures never advance the local cursor. The workspace/credential
merge rules above are still awaiting the typed reducer; the live transport test
uses synthetic payloads and does not prove browser session continuity.

PostgreSQL NOTIFY carries routing metadata only after commit. The existing account
hub fans hints across API instances; sockets read the durable log. Five-second
server reconciliation repairs missed hints. Slow consumers disconnect rather
than grow unbounded queues. Replay pages cap event count and bytes.

Planned compaction: encrypted checkpoints after 1,000 changes or 15 minutes of
activity, ten retained checkpoints, at least 30 days of covered events, and
persistent deduplication/deletion watermarks. Never compact uncovered events.
Clients beyond replay retention install a validated checkpoint then reconcile
pending operations without resurrecting obsolete records.

## Presence and trust

Native-device proof precedes replay and presence registration. Ticket possession
or a live connection alone grants no write authority; every publication verifies
its signature and current device authorization. All queries enforce account,
workspace, and device boundaries.

Heartbeats run every 15 seconds with 45-second expiry. Presence records identify
connections separately, so closing an old socket cannot remove a replacement.
Readiness requires an unlocked client reporting an applied cursor at the current
head. Presence is advisory and separate from sync acknowledgments.

Native readiness also requires an empty pending outbox, a validated device roster,
and browser-import completion for the current durable cursor. An import completion
for an earlier cursor cannot mark newly received state ready. Device-roster races
are repaired by fetching and validating the current signed grants before replay.
Account-event notifications are delivered over a bounded native broadcast channel;
consumers must reconcile after a lag notification.

## Native encryption and persistence

The native core uses a random 256-bit vault root wrapped with AES-256-GCM. Its
wrapping key is Argon2id v0x13, 64 MiB memory, three passes, one lane, 32-byte
output, a fresh 16-byte salt, the user password, and the 32-byte sync secret as
Argon2's secret parameter. Unlock verifies the resulting root public identity.
Normal mutations do not rerun this KDF.

HKDF-SHA256 with salt `misty.sync.hkdf.v1` separates root signing, event encryption,
and device-local encryption keys. All AEAD nonces are fresh random 12-byte values.
Associated data binds deployment/account/workspace and either immutable operation
metadata or local record/device identity. The committed snapshot's associated
data includes its durable replay cursor. Per-event ciphertext is at most 1 MiB;
local encrypted snapshots are at most 32 MiB. Large browser-storage transfer still
requires an atomic chunk/checkpoint design before the adapters are enabled.

Secret root/device types cannot be serialized or formatted. Owned key and
plaintext buffers and Argon2 scratch memory are zeroized on drop. Remembered roots
use macOS Keychain or Windows Credential Manager, with scoped hashed entry names;
there is no fallback to the old file credential store. Setup/unlock uses the
native coordinator and supports explicitly remembered keys. Lock/account switching
awaits worker shutdown; the lock/recovery management UI remains incomplete.

SQLite uses WAL and FULL synchronous commits. Ciphertext snapshots, encrypted
device signing keys, encrypted local intent fingerprints, signed encrypted outbox
entries, encrypted root wrappers, and public routing metadata are the native
sync store contents. An acknowledgment marks the outbox entry;
only committed replay removes it. Pure reduction of a contiguous verified replay
page, its receipts, snapshot, cursor, and matching outbox deletions share one
transaction. Pending edits are a separate optimistic overlay, not input to the
committed-state reducer. The typed workspace/credential reducer validates changes before enqueue and
replays them transactionally. Local retention/checkpoint installation remains unfinished.

## Browser adapters still to implement

Keep native WebKit/WebView2 adapters and a portable cookie/storage representation,
not copied browser database folders. Observe available events and reconcile
missed changes. Support cookies, local storage, tab session storage, and
transferable IndexedDB needed by acceptance sites. Stage validation/import before
page network navigation; suppress import echoes and prompt before reloading an
active page. Invalid/unsupported state cannot be silently labeled restored.

Do not claim portability for arbitrary JS memory, passkeys, nonexportable or
device-bound keys, or sessions a website rejects. Encryption authenticates data
but does not by itself prevent a malicious server from replaying an old valid
head to a new device. Existing devices retain their highest accepted sequence.

Keys, revocation, and recovery are endpoint responsibilities. Revocation must
reject future writes and rotate future-data access; it cannot erase already
copied plaintext from an offline device. Losing all trusted devices and secrets
means no server-side recovery of the old vault. AI task execution retains a
separate ownership/action-receipt protocol; workspace sync cannot replay external
actions automatically.


## Renderer bridge and setup preview

The authenticated app frame mounts one workspace controller. It saves a recovery
copy of existing workspace persistence before the first projection, captures only
changed shared fields, and suppresses capture while applying a native projection.
The first empty snapshot must finish authenticated server replay before it can
seed a new vault. An existing cached document or native outbox can open offline.
Synthetic recovery layouts are never sent as shared entities: a structural user
edit materializes real IDs. Empty imported panes require an explicit navigation
instead of creating and echoing new Google tabs automatically.

Focus remains local. Projection retains local view timestamps, sidebar visibility,
pane history, Files state, and unchanged-page favicon caches. Shared navigation
and profile fields remain authoritative. Files paths are not included in shared
mutations. The current adapter covers global windows, website groups and saved sites.
Migration/recovery for retired scopes, old installation/provider bookmarks, and
the Files surface is unfinished.

A scoped renderer journal persists workspace edits in endpoint localStorage
before native IPC, each with a stable operation UUID. It contains workspace
metadata/URLs in plaintext, like the existing endpoint workspace store; it never
contains vault unlock secrets or cookie/browser-storage payloads. The native
SQLite transaction records the encrypted payload fingerprint with the outbox and
counter. Retrying a lost renderer reply returns the original ID even after replay
removed its outbox item, while reusing an ID with different bytes fails. Receipts
currently have no compaction policy. Renderer acknowledgment removes only the
first journal entry and only after native acceptance. A local journal write
failure blocks incoming projection so an in-flight read cannot erase the visible
unsaved edit. A later refresh retries capture.

Before account stores reset, the bridge unsubscribes synchronously and invalidates
pending callbacks. Locking native sync clears the displayed native session but now
keeps the current account's renderer controller subscribed. Metadata edits made
while that controller remains mounted enter the durable journal and are delivered
before the unlock projection. Their stable IDs also survive a subsequent renderer
restart. No credential capture or native-key retention is added by this behavior.

A cold start while the vault is already locked still needs draft-baseline recovery
or an interaction gate: there is no controller to capture edits made before the
first unlock in that process. The initial recovery backup is not a complete draft
recovery UI. No browser-import readiness is asserted by the renderer.

Settings > Device sync provides vault availability, generation of a native random
32-byte secret (standard padded Base64), password confirmation, saved-secret
confirmation, optional OS key retention, offline remembered-key unlock, and retry
errors. Form secrets stay in transient component state and native command arguments;
they are cleared after successful unlock and excluded from telemetry capture.
The UI reports workspace progress separately from full session portability. It
does not yet expose device revocation, key rotation, lock/draft recovery, or Continue
here. Those remain completion gates.

Verification for this integration: 31 focused frontend tests pass for projection,
field diffs, restart/lost replies, concurrent incoming/local edits, local journal
failures, account teardown, first replay, device-local state, and setup/unlock.
Frontend typecheck and targeted ESLint pass. The vault form was visually inspected
with the actual shared Settings components/styles and synthetic data. The Settings
registry suite passes 25 tests and retains one unrelated existing tree-indent CSS
expectation failure. The native crate passes 22 tests (OS store test opt-in) and
Clippy with warnings denied; the native application library compiles. These are
not real macOS-to-Windows browser session acceptance results.


## Browser navigation integration

The navbar now renders ordinary website groups without an Apps/Categories heading.
Default groups are Inbox, Social, Journal, Planner and Library. Each has a separate
expander and website-switcher pill. Users can create/rename/reorder groups, add any
HTTP(S) website to any group, pin/unpin sites, save the current page, and explicitly
open another tab. Selecting a saved website resumes its existing view in the
current virtual window. Its saved launch URL does not follow subsequent browsing.
No installation/catalog API is involved in this navbar.

Groups and saved websites live in the account workspace persistence and are
projected through the existing native document. The renderer journals only changed
fields; incoming navigation projection cannot echo edits. Expansion and selected
website stay local and are excluded from mutation records. New saved-site tabs
include their website reference in their creation mutation. New browser tabs now
use the native browser surface directly instead of an official-app route. Opening
in a requested split pane preserves its siblings and layout; an unqualified open
creates another tab.

Cmd/Ctrl+K and the navbar search button open a compact URL/Google search box. It
submits only on Enter; it makes no suggestion requests while typing. Account reset
clears the box. Cmd/Ctrl+L reveals the focused website address. Saved-site views
show their title in place of a persistent address input, hiding the address again
after blur/Escape. Explicit AI/command shortcuts remain separate. Startup choices
no longer include Spaces or Code, and retired desktop tool handlers and the dead
Discover header button were removed. The old Space/app runtime, mobile navigation,
Files extraction, and remaining shortcut definitions still require pruning.

Focused behavior tests cover custom groups and independent controls, arbitrary
website placement, saved launch addresses, per-window resume, group ordering,
account persistence, incoming navigation echo suppression, URL/search submission,
address reveal/Escape, and split placement. The desktop shell integration test,
replaced browser-workspace navbar tests, browser UI suite, typecheck, targeted lint,
and macOS native library check pass. The navbar, picker, search box and compact
address header were inspected in an isolated local preview using real components
and synthetic data. This does not establish real browser session transfer.


### Shell decoupling and lock capture (2026-09-23)

Desktop startup no longer loads Spaces, waits for its snapshot, canonicalizes its
routes, or mounts its realtime bridge. Agents retain their independent account SSE
invalidation stream; native browser workspace sync continues over WebSockets.
Activity refresh now reads capability approvals and browser interventions directly,
and marking historical activity read no longer invokes the retired Spaces inbox.
Existing activity history remains stored. The mobile resume bridge also stops
refreshing Spaces, but the mobile shell itself still requires migration.

The tour now explains browser search, saved website groups, tabs/splits and virtual
windows. Its installation demo/pinning panel and sharing walkthrough were deleted;
it suspends native webviews while visible and states that sign-ins do not transfer
yet. Shell route memory now includes the browser, retains agent conversation query
parameters, and falls back from retired startup destinations. Sign-in/registration
return to `/browser`; the old Files tray return action does too.

Verification: 83 tests passed across Activity, auth, route memory, interventions,
the desktop shell and onboarding. A separate 13-test controller/journal run passed,
including locked edits merged with an unrelated remote URL change and stable intent
replay after renderer restart. Typecheck and targeted ESLint pass. The actual tour
was visually checked against the actual website navbar in an isolated local preview;
that preview and its server were removed afterward. These are frontend checks, not
macOS-to-Windows signed-in-session acceptance.


### Native cookie adapter verification (2026-09-23)

`src-tauri/src/infra/browser_cookie_store.rs` now contains the macOS native-only
cookie read/write adapter. It is not connected to the live sync coordinator yet
and exposes no renderer IPC. Access requires a browser child label, a validated
64-character profile ID, and a matching actual WKWebsiteDataStore identifier.
Default/ephemeral stores and pre-macOS-14 profile mode are rejected. Integration
must retain the account lease, serialize profile imports, quarantine a timed-out
import, verify the applied store, and stage credentials before navigation.

The adapter uses WKHTTPCookieStore callbacks instead of treating scheduling as
completion. Conversion preserves host-only/domain scope, path, Secure, HttpOnly,
session/persistent expiry and effective SameSite policy. Read-back of a constructed
NSHTTPCookie detects lossy conversion before the live store is changed. Cookie
contents are not formatted into errors, logs, renderer events, or metadata.
Duplicate cookie identities normalize the optional leading domain dot while
preserving host-only versus domain scope, so aliases cannot address the same
engine cookie twice and distinct host/domain cookies can coexist.

Evidence: the native app library compiles, and five focused native tests pass.
One test exercises 40 Foundation conversion combinations across domain scope,
session/one-day expiry, SameSite, Secure and HttpOnly. Separate cases reject an
invalid cookie, a partitioned import, an unspecified policy, an invalid profile,
and a far-future expiry that Foundation shortens. The new export test rejects
native partition metadata and port restrictions instead of dropping them. The complete sync-crate suite
passes 23 tests with its opt-in OS keychain test ignored; the updated identity
test also confirms that host-only and domain cookies can coexist.

The separate `cookie_store_probe` example exercises the adapter in real Tauri
child webviews with fresh random named WebKit stores and synthetic cookies. It
passes 40 live round trips, reading through a second view on the same profile,
checking the other profile stays empty, and awaiting every write/delete callback.
It also verifies actual-store mismatch, ephemeral-store and host-label rejection,
plus coexisting host/domain cookies and deleting only the host-scoped cookie.
This is native-store evidence, not network-request behavior, Windows import,
process-restart persistence, or signed-in provider handoff.

Reproduce with `cargo run --manifest-path src-tauri/Cargo.toml --example cookie_store_probe`.
The complete probe exits successfully and removes its exact temporary named
profiles through WebKit's public removal API in a fresh process after the exercise
process exits. Cleanup initializes an ephemeral WebKit view first; the installed
runtime crashed when removal preceded WebKit run-loop initialization. Earlier
failed-attempt synthetic profiles were also removed. No user profile or real
credential was used. The probe has its own configuration, no IPC capabilities,
and uses only `about:blank` views.

The installed Foundation runtime shortened a ten-year cookie expiry to its own
limit. The adapter rejects that change rather than silently claiming an exact
restore. Foundation's nil SameSite policy is mapped to effective None as WebKit's
Cocoa conversion does; this preserves effective engine policy, not the original
Set-Cookie header syntax. An incoming unspecified policy is rejected until a
portable interpretation is proven. See [Apple domain semantics](https://developer.apple.com/documentation/foundation/httpcookie/domain)
and [WebKit's SameSite conversion fix](https://github.com/WebKit/WebKit/commit/45ce92c14115b2f8d56bc87301c6f1097a6f06cf).

Partitioned cookie coverage remains unproven: the public API used here does not
supply a portable partition key. Export now rejects any `StoragePartition`
property exposed by the Cocoa bridge and any native port list; absence is not
proof of complete coverage across OS versions. This check follows
[WebKit's Cocoa cookie conversion](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/network/cocoa/CookieCocoa.mm).
The coordinator must not publish a read from this
adapter as a complete credential snapshot or claim ready until coverage is known.
Windows, continuous capture, atomic import/recovery, storage/IndexedDB adapters and
actual Google/GitHub/Microsoft tests remain required. Existing browser profiles and
navigation are intentionally not switched to this adapter before those gates.

### Durable native import receipts (2026-09-23)

The native sync store now has an encrypted, revisioned browser-import journal per
profile. Preparation selects the complete credential target from authenticated
committed state at an exact cursor. It persists before browser side effects may
start; an unfinished import cannot be replaced by another one. AEAD binds the
journal to the account/workspace, device, profile and revision. The previous
verified target remains available during an interrupted replacement.

Worker commands expose this journal only to native callers. Completion requires
read-back of every target area, preserving cookie scope/security and storage
values. Cookie order/domain-dot aliases are normalized, and already expired
cookies need not be recreated. Missing live cookies, omitted storage, changed
HttpOnly attributes, stale revisions and mismatched receipts cannot complete.
Timeout quarantine retains the target and blocks completion. Recovery from a
quarantine still needs a host procedure that proves old native callbacks cannot
run; no automatic unquarantine is implemented yet.

Pending imports block new credential captures for that profile before allocating
an outbox counter, including after worker restart. Workspace edits remain usable.
Readiness now requires verified receipts matching all current committed credential
areas, including previously unseen profiles; a replay cursor alone is insufficient.
A later rotation/logout invalidates the old receipt even when earlier native work
finishes successfully. This gate does not claim that unsupported browser storage
has been captured in the first place.

Verification: the full sync suite passed 28 tests with the opt-in OS keychain test
ignored; after adding expiry handling, all six import-journal tests passed. These
cover restart/lost responses, partial or changed read-back, transaction rollback,
ciphertext substitution, quarantine, expiry and offline worker command delivery.
The native host library compiles. The updated real Rust-worker/Go-WebSocket/
PostgreSQL fixture also passes: pending restore survives worker restart, partial
import cannot echo into the event log, and a stale receipt cannot cover logout.
That fixture uses synthetic native observations, not real browser storage.

The host still needs to connect adapter calls to these transactions under its
account/profile lease, implement durable capture baselines and quarantine recovery,
and stage navigation/reload prompts. The existing browser profiles remain in place
until that integration preserves their local sessions. Windows, storage/IndexedDB,
provider acceptance and retired Spaces/apps pruning remain open.

### Staged native restore execution (2026-09-23)

`restore::restore_profile` now orchestrates native preflight, the worker's durable
import receipt, awaited browser writes, and actual read-back. Calls through cloned
worker handles serialize under one import lease. A reserved command slot lets a
dropped import future enqueue quarantine synchronously before another restore can
read the journal; timeout and read-back failures await durable quarantine. If the
worker has already stopped, its pending receipt remains the recovery barrier.
No automatic unquarantine or proof that a stopped engine has no late writes is
provided by this layer.

`infra/browser_cookie_restore.rs` implements that contract for an isolated,
quiescent macOS WebKit profile. It checks native representability before changing
cookies, rejects storage/IndexedDB and partitioned cookies rather than pretending
they were restored, preserves host/domain distinctions, skips expired targets,
and applies only necessary sets/deletions. A missing cookie area does not mean
logout; an explicit empty cookie area does. The staged-view check uses WebKit's
nullable URL API, avoiding Wry's panic on an un-navigated view. A blank URL alone
is not proof of profile quiescence: the host must own all clients/workers and the
account lease before calling this adapter.

The isolated `cookie_store_probe` now drives the real encrypted SQLite worker and
native cookie store together. It verifies replacement/removal, expired targets,
unsupported preflight without side effects, profile isolation, receipt persistence
across worker restart, and a newer explicit logout. The probe uses synthetic data,
random disposable profiles and no network pages; it removes both profiles in a
separate cleanup process. It does not exercise the live application's profile
registry, a provider login, Windows, or transport between devices. The full sync
crate suite passes 34 tests, with one opt-in OS keychain test ignored; five tests
cover restore orchestration including canceled writes. The native host compiles.

Production integration remains gated on a durable logical-to-physical profile
mapping, legacy profile migration, fresh-profile quarantine recovery, account
switch/shutdown coordination, navigation/reload staging, continuous capture and
storage adapters. Applied receipts from this helper are per-profile evidence,
not permission for the host to report full handoff readiness on their own.

### Device-local profile generations (2026-09-23)

`store::BrowserProfileBinding` now keeps an encrypted, device-local mapping from a
synced logical profile to native-generated physical stores. Each binding contains
an active generation, an optional stage and recoverable retired generations.
Physical IDs never come from a remote event or renderer path. Mapping ciphertext
is authenticated against logical profile, revision, device and vault scope.

Staging uses a revision compare-and-swap and an idempotent request ID. Replacing an
uncertain stage allocates a different physical store and atomically invalidates
its old pending/quarantined receipt in the same SQLite transaction. Late callbacks
cannot complete that superseded receipt. This isolates future writes; it does not
prove old engine callbacks have stopped. Retired stores must remain inaccessible
and may only be forgotten after their clients close and native deletion completes.
No automatic deletion is enabled.

The worker serializes allocation and activation against restore attempts. A staged
binding blocks credential capture and readiness even before a journal starts or
after its receipt finishes. `restore_staged_profile` checks generation identity
and physical backend identity, and uses that generation as the import receipt ID.
The macOS adapter validates the actual native store against the physical identity
while checking credential records against the logical identity. The older unmapped
restore entry point cannot bypass a registered binding. A retried successful
staged restore reads actual engine data again before acknowledging its receipt.

Activation requires the matching complete receipt and credentials equivalent to
the current committed document. A newer credential rotation/logout prevents it;
a workspace-only event does not force another cookie rewrite. Activation retains
the previous active store. These are durable metadata checks: the native host must
still hold its account/profile lifecycle lease, keep the stage quiescent and use
fresh read-back before activation, especially after engine/process restart.

Verification: the full sync suite passed 40 tests with one opt-in keychain test
ignored; the additional workspace-only replay case then passed with all eleven
import/profile tests (41 passing tests in the combined suite). Tests cover mapping
restart, encrypted database/WAL contents, ciphertext substitution, transaction
rollback across receipt and mapping, stale callbacks, receipt reuse, retired-store
protection, activation after logout, and capture/readiness gates. The native host
library compiles. The WebKit probe also verifies allocated profile restoration,
activation gating, mapping recovery after worker restart, predecessor preservation
and an explicit logout in a fresh physical store. All disposable native stores
were removed and the probe store directory was empty afterward.

Native view creation now resolves default/logical requests through this registry
when an activated binding exists. First use in the process verifies actual native
cookie observations before selecting the physical store. Unmigrated legacy stores
remain unchanged. Automatic staging/activation, legacy-profile migration and
continuous capture are not connected yet. Windows adapters, storage/IndexedDB,
provider sessions and macOS-to-Windows acceptance remain open.


### Browser lifetime and activated-profile selection

The host now serializes account replacement against native view creation with a
read/write lifetime barrier. Creation admitted before an account change must
finish first; queued creation from the prior account epoch fails instead of
reopening a page afterward. Synchronous WebKit popup creation declines while the
write barrier is held. Unlock/lock/forget operations use the same lock order.
Account changes stop and join the sync worker, revoke native agent leases while
retaining scope tombstones, close registered and partially created native browser
views, clear the selected-profile cache, and only then replace account cookies.
Forgetting an inactive saved account does not stop the current worker.

A default/logical browser request resolves an activated encrypted binding to its
native physical generation. Physical IDs remain native; agent observations and
browser Ask expose the logical profile identity. A non-secret selected-profile
cache survives vault locking so new tabs do not fall back to a different legacy
store merely because keys were locked. Staged or inconsistent bindings fail
selection. An unregistered legacy store is preserved until migration is available.

`restore::verify_active_profile` reads the actual engine through a native backend,
checks the current generation and import receipt, and revalidates every recorded
credential area against the committed document. It never applies browser writes.
The macOS host uses a temporary, off-screen about:blank view of the exact store,
closed on success/error/cancellation. Unsupported storage or mismatching native
values prevents selection. The isolated WebKit probe changes a cookie after its
receipt, verifies detection, and checks that the changed value was not overwritten.

This is a native selection/shutdown boundary, not the complete production import
loop. The initial legacy export, automatic allocation/restore/switch, continuous
capture/import, frontend reopen coordination and Windows/storage adapters remain
unfinished. Browser session bytes are still held by the browser engine locally;
this does not claim local browser stores are encrypted by the sync vault. No live
provider or macOS-to-Windows acceptance has been established by these checks.

### Durable native capture and offline coalescing (2026-09-23)

The native store now encrypts a capture journal per logical profile, bound to its
active physical generation. Complete engine observations include explicit empty
areas for logout. Missing recorded areas fail capture rather than implying deletion.
The journal holds the last verified baseline, latest observation, and at most one
in-flight credential batch with a stable operation ID. Intent persistence precedes
outbox insertion; restart completes that boundary without allocating another
operation or counter. Further native changes coalesce in the encrypted journal
until ordered replay establishes the first batch's actual outcome.

When replay rejects or supersedes that batch, capture does not rebase its old
tokens onto newer remote credentials. It preserves the local observation and
requires import. Native staging cannot replace a profile while its publication
outcome is unknown. A verified replacement can recover a resolved intent if a
crash occurred between acknowledgment and capture bookkeeping. Neither replay nor
the persisted observation acknowledges restoration: readiness needs a fresh
matching engine readback against committed state.

The macOS host now owns a hidden about:blank observer for an already activated
store, reads its native cookies every two seconds under an account lifetime lease,
and passes observations directly to the worker. No credential payload crosses
renderer IPC. The task stops and its view closes on vault lock/account replacement.
Read failures invalidate browser readiness and report a sanitized issue. Polling
is local; inter-device transport is still WebSockets.

Evidence: five capture tests cover restart/coalescing, remote logout winning over
stale tokens, partial/generation mismatches, failed outbox insertion, and the
acknowledgment/bookkeeping crash boundary. The live WebKit probe confirms actual
cookie observations enter the encrypted worker outbox and coalesce offline; its
temporary stores are removed. Native browser tests pass. These observations do
not yet establish provider-session continuity or a Windows implementation.

Initial legacy export/ownership and activation, automatic incoming restoration,
frontend reopening, non-cookie storage and Windows adapters remain required. An
unmigrated production profile has no active mapping, so this observer deliberately
leaves it unchanged. The Settings preview must continue to say that website
sign-ins do not transfer yet.

### Explicit cookie capture and profile switching (2026-09-23)

The desktop Settings preview now exposes experimental **Capture cookies** and
**Restore cookies and reload** controls on macOS 14+. Both require an unlocked,
connected vault with no pending workspace changes in the displayed state. They
flush frontend recovery before invoking native commands and ignore results from
an account/session replaced during the operation. The native restore additionally
rejects pending outbound changes and rechecks authenticated account identity.

Capture reads the actual browser cookie store without returning credential bytes
to the renderer. An unmapped legacy profile may seed a previously absent cookie
area, using base version zero; it cannot overwrite received credentials. Retrying
an identical pending/committed capture does not enqueue another batch. A different
received version requires restoration, including a remote logout. Already mapped
profiles use the durable observation/coalescing path.

Restore owns the browser/account write lifetime in a detached native task so a
canceled renderer invocation does not abandon a partially switched profile. It
allocates a fresh physical generation, restores and verifies it, stops agent runs
while retaining permission tombstones, closes old browser views, activates the
verified generation, and verifies it again before selecting it. A native event
invalidates frontend webview handles; visible panes recreate against the selected
profile while preserving workspace layout and navigation history. Frontend grants
are cleared. Account identity is checked again after old runtime work settles.
The previous physical store is retained; it is not deleted by restoration.

This is an explicitly limited cookie test. It does **not** transfer website
localStorage/sessionStorage/IndexedDB. Initial capture does not continuously
observe the legacy profile; after capture commits, explicit restore migrates the
visible workspace to a mapped cookie profile whose changes can be observed.
That profile does not contain the old store's non-cookie website data. Unsupported
cookie attributes or a failed native verification stop restoration. A failed
staged import may require another explicit restore before opening new tabs.
No real provider acceptance or Windows restoration is claimed.

Verification: 66 frontend tests passed across browser-workspace and the runtime
handoff tests; TypeScript and targeted ESLint passed. Native handoff tests cover
missing versus explicitly empty credentials, unsupported storage, initial-capture
idempotency, and refusing stale tokens after a received logout. The isolated live
WebKit probe passed 40 cookie round trips, profile guards, verified restoration,
restart recovery, explicit logout, native outbox capture and offline coalescing,
and removed its disposable profiles. These engine checks do not exercise the
complete logged-in Settings flow. A Windows cross-compilation attempt stopped in
`ring` because this Mac lacks Windows C SDK headers (`assert.h`); no Windows build
or native runtime result follows from the macOS checks.

See [the preview test checklist](browser-handoff-test-checklist.md) for the current
runnable checks and the gates still required for the requested cross-device test.

### Windows cookie adapter and build verification (2026-09-23)

The Windows host now shares the capture, staged restore, activation/readback,
agent shutdown and frontend-reopen coordinator with macOS. Hidden observers use
the same native-selected data directory as real browser panes. The legacy capture
alias resolves to the existing `browser-profile` folder; fresh physical IDs use
`browser-profiles/<validated-native-id>`. A pure resolver test covers that mapping
and rejects path-like inputs.

The adapter uses WebView2's native `CallDevToolsProtocolMethod` API, with fixed
`Storage.getCookies`, `Storage.setCookies` and `Network.deleteCookies` operations.
This is not a renderer-accessible CDP bridge. Each call reads the actual
`ICoreWebView2Environment7.UserDataFolder`, canonicalizes it against the expected
native folder, and verifies the default, non-private profile before proceeding.
Main/foreign webviews, mismatching folders and incognito profiles are rejected.
Errors never include native protocol payloads, and callbacks have a bounded wait.
The [official CDP schema](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json)
defines the cookie fields used by this boundary.

The portable model retains name/value/domain/path, host-only scope, secure,
HttpOnly, SameSite and whole-second expiry. A host-only import uses a URL without a
domain parameter; domain cookies retain their leading dot. Deletion uses exact
domain/path matching, avoiding URL-based deletion that could remove both scopes.
Unspecified SameSite remains unspecified on Windows; macOS rejects it when its
engine cannot preserve it. Partitioned/opaque-partition cookies are rejected,
never flattened. Chromium-only priority and source metadata are not part of this
portable model; this is not a complete Chromium profile export.

The new Windows probe opens only about:blank with synthetic cookies under a
supervisor-owned temporary root. It checks 32 variants, native completion,
profile boundaries, same-profile visibility, exact deletion, backend restore
readback and isolated logout, and removes its directories after the child exits.
The actual native COM adapter is compiled into the probe; only its expected-folder
resolver is redirected to the supervisor's temporary root.

Cross-compilation now passes for the Windows native library and the probe after
installing the missing cross-build prerequisites. This also caught and fixed two
macOS-only command registrations that lacked platform guards. Two portable codec
tests run on macOS and cover scope/session/expiry/SameSite encoding and refusing
partial or partitioned observations. Neither compile checks nor codec tests prove
that the real Windows WebView2 runtime passes the probe; that result is still
required before provider or macOS-to-Windows signed-in acceptance.

The Windows x64 probe also successfully **linked into an executable**. A local
5.7 MB ZIP is available under `artifacts/browser-handoff/windows-cookie-probe.zip`,
with the executable, a runner, instructions and its SHA-256. The executable hash
is `af3630af6f5dd1a599b99949f7a1455d54fa78c56688c8ea0c8d377e3dd4c616`.
Its PE imports use standard Windows libraries plus the Visual C++ x64 runtime;
WebView2 itself must be installed on the Windows machine. No Rust installation is
needed to run the packaged probe. This artifact remains unexecuted on Windows
until the user supplies the requested native result.
