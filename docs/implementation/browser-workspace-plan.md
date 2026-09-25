# Browser workspace: accepted implementation plan

Status: implementation in progress; not a release claim.

Browser completeness work is tracked in [the browser implementation ledger](browser-ledger.md). Complete the everyday browsing baseline before expanding browser agent features.
This replaces the earlier app-store direction and single-writer handoff prototype.

## Spaces restoration (September 23)

Spaces remains an optional built-in destination alongside Files and Agents. Inside
its workspace pane, Chat, Planner, Journal, and Library use vertical pull tabs and
animated sheets. The sheet header reuses the avatar Space switcher. These controls
are Space-local; they do not replace global navigation or change split geometry.
Space routes, tabs, account-scoped realtime, and invitation redemption are restored.
The sync document supports Space tool routes without browser credentials. Existing
backend Space routes and permissions remain authoritative. Earlier removal notes
below describe migration history and are superseded for Spaces by this decision.

## Accepted simplification and persistence direction

Latest user decisions supersede the earlier replay-first delivery plan below:
PostgreSQL holds versioned endpoint-encrypted snapshots; WebSockets notify online
clients after commit; reconnecting devices fetch current state rather than
requiring delivery of every missed intermediate edit. Concurrent replacements
must compare their expected revision; clients reconcile conflicts because the
server cannot decrypt or merge contents. Keep stable request identities and a
small durable sender queue. No per-offline-device delivery mailbox is required.

Misty's own workspace state, recovery copies and pending writes must move out of
localStorage/sessionStorage/IndexedDB into native encrypted SQLite. A separate
OS-protected local key permits workspace recovery while the sync vault is locked.
This restriction does not apply to websites: their cookies, localStorage,
sessionStorage and supported IndexedDB data remain part of the handoff goal.

Reduce writes and bandwidth through client change detection, bounded batching
(initially 400 ms quiet time, maximum 2 seconds), and separately encrypted large
website-data components referenced by a snapshot. Do not rewrite credential data
for a tab/layout edit. Do not change an in-flight request. Publish acknowledgments
and notifications only after durable PostgreSQL commit. Prefer transient presence
over a database update for every heartbeat; Redis is optional, not a prerequisite.
Explicit handoff must flush and confirm a committed server revision. Initial
timings are implementation defaults to measure, not proven performance targets.

The currently running transport is still the earlier event-log implementation.
Snapshot/CAS publication, component references and transient presence remain to
replace it; frontend batching alone does not establish this revised architecture.

Implemented first migration slice: a native encrypted recovery database with a
separate OS-protected key, revision-checked/idempotent writes, immutable archives,
record/byte limits and unchanged-value suppression. Main-window-only commands
hold the account lifetime across blocking disk/key-store operations, including
IPC cancellation, and discard the local key owner on account replacement.
The sync bridge now migrates its pre-sync backup and frontend pending-edit journal
into that store. Conflicting pending journals preserve both copies and require
recovery; exact legacy values are removed only after native acknowledgment.
Workspace edits are batched at 400 ms quiet time with a 2-second maximum delay;
account transitions flush the active capture/journal before changing credentials.

The main native desktop workspace now hydrates from that independent recovery
store before mounting the browser. Owned legacy layouts are archived/migrated,
account transitions await writes, and failures preserve the previous records.
Browser/mobile/official-app builds still retain their earlier persistence paths.
The new snapshot transport is not implemented.

Verification for this slice: 49 sync-core tests passed (one OS-keychain test is
opt-in), including actual encrypted SQLite/WAL inspection, unchanged-write
suppression, restart, wrong-key/account rejection and immutable archives; 37
frontend tests passed, including 50 rapid edits becoming one publication,
bounded continuous-edit delay, native-write failure and lost-response recovery.
Native compilation, two account-lifecycle tests, two command-policy tests,
TypeScript, targeted ESLint and core Clippy passed. This is not a live desktop
migration, OS-recovery-key provisioning or Windows/provider acceptance result.

## Current handoff integration

Account startup now opens a remembered vault automatically, or requests setup /
unlock directly. The native loop captures and restores supported website data
without manual cookie controls. Workspace selections follow the most recent
server-ordered resume record without echoing imported changes. Native adapters
cover cookies, localStorage, per-tab sessionStorage and a bounded portable
IndexedDB codec. Incoming credential updates reopen browser views and stop active
agent actions. Changed credential areas alone are published.

The Mac and Windows code compile; device/provider acceptance is deliberately left
to the user. See the [current test flow and limitations](browser-handoff-test-checklist.md).
The existing encrypted event-log backend is retained for this runnable iteration.
Snapshot/component transport, complete retired-feature cleanup and large/unsupported
website-storage formats remain unfinished. No hosted server was deployed.

## Product and navigation

Misty is a browser workspace that follows the user across devices. Retain the
browser, website groups, Files with local/LAN access, and Agents. Remove Spaces,
Discover, app installation, and other standalone native tools.

Preserve the navbar's charcoal styling, density, icons, individual expanders,
website-switcher pills, pinned destinations, and reorder behavior. There is no
Apps, Groups, Categories, or Sites section heading. Use “New group”, “Add website”,
and “Save to group” in actions. Start with existing website-oriented groups and
allow arbitrary custom groups and websites. A group is organizational; it never
changes the login profile or limits valid destinations. Files and Agents are
global tools.

Home and New Tab open Google in the shared native browser runtime. Cmd/Ctrl+K
opens a URL/search box; Enter navigates or opens Google results. Cmd/Ctrl+L reveals
the current address. Preserve explicit agent and command shortcuts. Categorized
websites have minimal chrome without a persistent address bar. Launch URLs remain
separate from live page URLs. Focus an existing saved-site view in the current
virtual window unless the user explicitly opens another tab.

## Shared state and device behavior

Both devices can edit concurrently. Share groups, saved sites, browser tabs,
layouts, split trees, virtual windows, profile references, and supported browser
storage. Merge disjoint edits; the latest server-accepted change wins for the same
workspace field. Server sequences, not device clocks, establish order.

Focus, active virtual window, expanded groups, selected website pills, and physical
window geometry remain device-local. An encrypted device-resume record supports
“Continue here” without continuously steering another device's focus.

Use native typed change events, a durable encrypted SQLite outbox, and WebSockets
for mutations, acknowledgments, replay, presence, and agent notifications. HTTPS
handles account authentication, device enrollment/revocation, and large encrypted
checkpoints. Details and implementation evidence live in
[browser-handoff-protocol.md](browser-handoff-protocol.md).

## Files and Agents

Keep local file operations and authorized, same-account LAN browsing, preview,
and explicit download/copy. Users choose exposed folders. Preserve source device,
root ID, and relative path. Verify copied bytes, recover interrupted transfers,
and report offline sources honestly. Browser uploads and agent attachments can
use explicitly fetched local copies. Disable relay/public-network file transport.
Automatic folder replication and destructive remote file operations are deferred.

Remove Space dependencies from pairing and root authorization. Preserve browser
control, agent threads, approvals, and task context. A received sync operation
never authorizes an external action. Execution ownership and action receipts are
separate from multiwriter workspace synchronization.

## Privacy and portability

Encrypt in native clients. The server gets neither vault plaintext nor unlock
secrets. Protect remembered keys using macOS Keychain and Windows OS protection,
not the legacy private-file credential helper. Enroll devices with account access
and proof of vault authorization. Revoke future access and rotate keys without
claiming remote erasure of data already decrypted on offline devices.

Continuously synchronize supported cookies and origin/tab storage. Prevent stale
offline credential batches from replacing newer credential versions. Prompt
before reloading an active page. Explicitly report unsupported engine-specific
storage, nonexportable keys, passkeys, live JS memory, and rejected website
sessions. The privacy promise covers backend sync storage; AI-provider disclosure
and unlocked endpoint access remain separate boundaries.

## Removal and migration

Delete retired frontend/backend services, routes, stores, subscriptions, native
commands, jobs, package entries, build tasks, and obsolete dependencies/tests.
Do not merely hide them. Preserve only genuinely shared browser/Files/agent
infrastructure, moving it to neutral modules first.

Migrate useful tabs, windows, saved sites, profiles, and agent references with
stable IDs and repeatable import behavior. Back up existing records for recovery
or export. Retain historical database migrations, but remove old runtime
implementations. Legacy routes use small redirects/explanations without loading
retired features. Preserve unrelated user changes in the worktree.

## Ordered work and completion gates

- [ ] Replace provisional single-writer storage with authenticated multiwriter
      events, replay, checkpoints, device enrollment/revocation, and presence.
- [ ] Native encrypted persistence, OS-protected keys, device signing, and one
      coordinator/connection per account/device across app windows.
- [ ] Browser/group model and navbar, search, defaults, and legacy-state migration.
- [ ] macOS/Windows native cookie/storage capture, import, and continuous updates.
- [ ] Local/LAN Files and agent context decoupled from Spaces/app installations.
- [ ] Retired source/dependencies/builds removed; browser/mobile shells consistent.
- [ ] Update PRODUCT.md, onboarding, website, and relevant docs after verification.
- [ ] Failure, security, migration, visual, and real-device acceptance completed.

Backend acceptance includes concurrent writers, duplicate/conflicting operations,
lost acknowledgments, ordering/gaps, server restart, multiple server processes,
compaction recovery, and transaction rollback. Native acceptance includes capture
races, cookie attributes/expiry/logout, origin isolation, credential rotation,
import-echo prevention, interrupted restore, wrong keys, and ciphertext tampering.

UI acceptance includes both navbar controls, arbitrary URLs, custom groups,
keyboard actions, independent focus, and valid concurrent split layouts. Files
acceptance includes folder permissions, path/symlink escapes, interrupted copies,
offline peers, and disabled relays. Agent handoff must never execute an action
twice. Typecheck, appropriate suites, production builds, and dependency audits are
required; replacing tests with assertions that merely mirror implementation is
not acceptance.

Final test: sign into Google, GitHub, and Microsoft on macOS; configure multiple
windows/splits/tabs and saved sites; restore and edit from Windows; test restart,
offline recovery, logout propagation, an authorized LAN file, and agent context.
The user will run the Windows build and report results. Keep the goal active until
that evidence and the cleanup requirements are satisfied.


### Implemented navigation slice (2026-09-23)

The desktop navbar has unlabeled website groups, independent expansion/switcher
controls, arbitrary URL addition, pins, custom names and ordering, and Save to
group. Groups/sites join the native encrypted edit flow; expansion/selection stay
local. Saved-site selection resumes the current window's matching browser tab.
Cmd/Ctrl+K opens URL/Google search and Cmd/Ctrl+L reveals the current address; saved
sites use title-only address chrome at rest. New browser views use `/browser`
instead of installed-app routes. Retired desktop tool handlers, the Discover
header button, and obsolete Spaces/installed-app navbar tests were pruned.

The overall navigation/migration gate stays unchecked: global Files is not yet
extracted, mobile still needs migration, and old installation/provider bookmarks
need recovery/import. Browser credential adapters, compaction/revocation and the
full retired-runtime cleanup remain required. See the protocol document for exact
verification and remaining limits.


### Implemented shell decoupling slice (2026-09-23)

Removed the desktop Spaces load/socket dependency and its onboarding prerequisite.
Activity now refreshes personal agent requests directly while retaining saved
history. The browser tour replaces installation/sharing steps, and the unused
installation demo components are deleted. Browser startup and sign-in route memory
no longer favor Spaces. Mobile foreground refresh no longer fetches its inbox;
the rest of the mobile shell remains to migrate.

The renderer keeps capturing metadata edits during an in-process vault lock and
replays them before unlock projection. A cold start already locked still needs
explicit draft-baseline recovery or an interaction gate. This partial improvement
does not close the lock/recovery or native credentials acceptance gates.


### Native cookie adapter slice (2026-09-23)

Implemented the native-only macOS cookie adapter with actual store-identifier
checks and awaited WKHTTPCookieStore callbacks. Foundation conversion tests cover
40 combinations and reject silently changed expiry/security semantics. Cookie
payload validation rejects duplicate domain-dot aliases while preserving distinct
host-only/domain identities. Five focused native tests pass, including refusing
to discard native partition/port restrictions. The isolated native probe passes
40 real-store round trips, callback completion, profile isolation and selective
host/domain deletion. The adapter is not wired
into live capture/import yet; Windows, partition coverage, storage adapters and
provider acceptance remain open. No credential-handoff gate is closed by this work.

### Native import recovery slice (2026-09-23)

Added encrypted per-profile import receipts to the native SQLite store and worker.
Pending or quarantined imports block credential capture, and readiness requires
complete verified read-back matching current committed credential areas. Receipts
survive restart, preserve previous applied state, and cannot be reused to cover a
newer logout. Six focused recovery tests and the updated real Rust/Go/PostgreSQL
WebSocket fixture pass; the native host compiles. Browser adapter invocation,
durable capture baselines, quarantine recovery and navigation staging still need
host integration. These results do not close the full native handoff gate.

### Browser shell cleanup and recovery slice (2026-09-23)

Desktop Files now opens the built-in explorer directly. Files tabs keep their IDs,
local state, and selected paths through migration; agent run queries also survive.
Mobile starts in the browser workspace, renders Browser/Files/Agents directly,
and no longer mounts the Space socket bridge, Space section renderer, installed-app
runtime, or retired desktop-tool handoff UI. Its navigation menu exposes the same
unlabeled website groups, alongside account and settings access; search opens the
shared URL/Google search dialog. Android explicitly uses the external-browser
fallback because the child-webview host is not implemented there.

Removed the unused Space switcher, Space tools navigator, installed-app navigator,
and app section navigator with their obsolete tests. Shared legacy icon rendering
is isolated in `NavigatorDestinationIcon.tsx` until remaining consumers are pruned.
Mobile Files no longer offers uploads into a Space Library. New Agents conversations
use personal scope; reopening historical conversations preserves their identity and
saved scope. That compatibility is not complete removal of Space references in
agent execution or backend storage.

Persistence version 14 preserves the exact old dock record and each legacy account
record before migration. A failed recovery write blocks overwriting the original.
Recovery records use the original local-storage key plus
`:before-browser-workspace:v14`; account removal clears that account's recovery
record as well. This preserves data still present at upgrade time; it cannot
reconstruct data previously overwritten by an earlier build. Recovery export UI,
legacy scope flattening, and browser-profile migration remain open.

Validation: 208 targeted tests across 15 files pass, including quota failure,
account isolation, historical conversation resume, new personal conversations,
Files migration, mobile navigation, and sync projection/controller tests. TypeScript
passes. Desktop and mobile production builds succeed. Removed the obsolete build
check that prohibited built-in Browser/Files screens; retained native file-picker
and preview resolution adapters. A temporary isolated preview verified
tablet and 390px phone navigation, website selection, menu closure, and 44px website
controls without horizontal overflow; the preview was removed. Retired Space planner
and editor chunks still appear in the production build through remaining dependencies.
Full source/backend/dependency pruning and actual cross-device session handoff are
not complete.

### Native staged restore slice (2026-09-23)

Connected the encrypted worker journal to a macOS staged cookie adapter in the
isolated native probe. Preflight rejects unsupported storage or cookie attributes
before writes; real read-back must match the full target before finishing the
receipt. Imports serialize, and cancellation/timeout/mismatch quarantine prevents
a retry from racing unfinished writes. A missing area leaves local data alone;
an explicit empty cookie area restores logout. The native probe verifies this
through worker restart and cleans up its random profiles. The full sync suite
passes 34 tests (one opt-in keychain test ignored), including five orchestration
tests. The native host compiles. Production profile ownership/migration, capture,
storage, Windows and provider acceptance remain unfinished; no full handoff gate
is closed by this slice.

### Native profile generation slice (2026-09-23)

Implemented the encrypted device-local logical/physical profile registry, native
worker allocation/activation commands, staged capture/readiness barriers and
receipt-to-generation validation. A failed stage can be replaced in a fresh store
without accepting late callbacks from its predecessor; previous active stores
remain recoverable. Native cookie restoration now distinguishes logical credential
identity from physical engine identity.

Verified SQLite transaction rollback, restart, authenticated mappings, activation
against newer logout, workspace-only replay and stale callbacks. The isolated
WebKit probe passed restoration into native-allocated stores, activation gating,
worker restart and logout while preserving predecessor cookies. Native host check
passes; all synthetic native stores were cleaned up. Combined sync test coverage
is 41 passing tests plus one ignored opt-in keychain test.

Next integration work remains native ownership of staged views and account
lifetime, legacy profile migration, production capture/reload coordination and
Windows/storage adapters. This slice does not make the cross-device acceptance
test ready. Remaining frontend/backend Spaces/apps pruning remains in scope.

### Retired runtime and agent workspace slice (2026-09-23)

Removed the Space-creation onboarding flow and marker logic, the installed-app
route runtime, its downloaded/embedded feature loaders and mobile aliases, and
unused Spaces page/section/invitation/navigation entry components. Removed the
old browser Ask provider-binding helper and unused agent Space-name resolver.
The previous user-data stores and migration recovery copies were not deleted.
Account sign-in/switch/resume no longer reloads Spaces and redirects legacy Space
locations to the browser. Remaining Files dependencies still use parts of the
library runtime; that dependency is explicit rather than treated as pruned.

Agent admission now uses the verified account and session generation, including
switch-away-and-back detection, rather than installation-store identity. New
conversations use personal scope; prompt text cannot select a Space. Explicitly
reopened historical conversations retain their recorded scope. Live context
attachments address the global workspace/windows/tabs/panes and do not implicitly
attach today's workspace to historical conversations. Browser Ask attaches the
native source page and registered device without requiring a Space or installed
provider; opening Ask does not submit a task. Native task/action checks remain
responsible for authorizing execution.

The Agents activity feed now loads personal runs by default. `/ai/activity` accepts
an absent/empty Space filter; its PostgreSQL query keeps the caller's identity and
personal scope predicates on both invocations and delegated runs. Explicit legacy
filters still require membership. Runs whose local execution lease is gone remain
paused. The focused real-PostgreSQL test covers NULL/empty personal scope, owner
isolation, agent filtering, delegated runs, expired/missing leases, and historical
membership. It uses a disposable schema and minimal fixture tables, not a complete
production migration or provider session test.

Verification: 81 focused workspace/agent/auth/security tests, six activity UI tests
and 17 account-lifecycle tests pass (104 total). TypeScript and targeted lint pass;
the Go HTTP package compiles and the personal activity PostgreSQL test passes.
Desktop and mobile builds no longer emit the retired SpacePlanner or
NoteBlockEditor chunks. These are build/runtime removals, not a claim that all
retired source, server routes, jobs, packages or dependencies have been removed.

Still open: remaining Spaces/search/settings/Files couplings, installation
assignment/integration paths inside agent execution, old packaged app sources,
backend pruning and recovery exports; production sync profile ownership/capture,
Windows/storage adapters, checkpoints/revocation, and the actual cross-device
provider acceptance test. No deployment or public privacy promise was changed.


### Personal agent execution without installed apps

Removed the agent installation-assignment API, its profile input and SDK schemas,
frontend assignment methods, and installed-provider destination discovery. Historical
website-account storage and native profiles are not deleted. The remaining legacy
SDK destination-registration method explicitly reports that it is unsupported;
pruning the rest of that SDK/app host is still outstanding.

Personal agents now start one browser scope using the same native default profile
as BrowserWorkspace. They do not derive a separate provider/app profile hash.
This is still the legacy default store: production account-owned encrypted profile
selection, migration, capture, and switching remain unfinished. This change does
not establish cross-device session portability or production profile isolation.

The backend checks the owned, enabled agent and supplies built-in browser/file
families instead of reading user_app_installations. Exact native scope, window,
lease, connected-account, file, and consequential-action checks remain applicable.
Personal runtime preparation resolves browser grants even when space_id is empty,
and no longer discovers installed SDK tools or retrieves legacy Space/account
content automatically. Retired feature tools and Space context references are
excluded. Historical conversations remain readable. Agent prompts now describe
browser workflows rather than Apps installation or Space navigation.

Native leases and worker windows accept an empty historical Space field while
preserving exact account/agent/task/window/scope comparisons. Frontend startup
checks the authenticated account generation across awaits and lease renewals,
closes late/partially created views, and rebuilds incomplete startup contexts on
resume. A late failure cannot pause its replacement task.

Validation for this slice:

- 29 frontend tests covering local execution, workspace autopilot, and browser Ask;
  5 SDK contract tests; TypeScript and focused ESLint checks.
- 7 native agent-workspace tests, including empty-Space acquire/renew, expiry,
  cross-account/scope/window rejection, and stale task actions.
- Real PostgreSQL tests in disposable schemas: built-ins without installation or
  Space tables; disabled/deleted/foreign agent rejection; a personal tool manifest
  with only granted browser capabilities; expired execution denial. Focused Go
  policy tests and HTTP/app package compilation also pass.
- Clean desktop and mobile Vite builds. Existing large-chunk warnings remain.

These are implementation/fixture checks, not a live model-run or macOS-to-Windows
acceptance result. Provider sessions, production sync integration, the remaining
retired feature/backend pruning, and device acceptance remain active work.


### Native browser lifetime and activated profile selection

Connected default/logical native view creation to the encrypted profile registry
for already activated bindings. macOS checks the actual engine store against its
current receipt before first selection; the check does not overwrite mismatches.
Physical generation IDs are kept out of browser Ask and agent observations.
Locked-vault tab creation retains the selected native store instead of falling
back to legacy storage. Legacy profiles without a binding remain unchanged.

Account replacement now waits for native creation, rejects queued creation from
the prior account epoch, stops the worker, revokes agent leases while preserving
scope tombstones, and closes browser views before swapping account cookies.
Synchronous popups cannot reopen a page during that boundary. Removing an inactive
saved account leaves the current worker running.

Verification: 51 native browser tests and eight agent-workspace tests; the sync
crate's 41 passing tests (one explicit OS-keychain test remains opt-in); and the
isolated live macOS WebKit probe with 40 cookie round trips and additional active
profile mutation/readback checks. The probe confirms a changed native cookie is
rejected without rewriting it and removes its temporary native stores afterward.
These tests are not a live multi-window account-switch or provider acceptance run.

Still required: automatic first-profile export/staging/activation, continuous
capture and incoming import orchestration, reopening frontend views after profile
switches, Windows and browser-storage adapters, checkpoints/revocation, remaining
feature/backend pruning, and the full cross-device acceptance test. This slice
must not be presented as completed session handoff or production account isolation
for unmigrated legacy stores.

### Native cookie capture queue

Added an encrypted per-profile observation journal and native worker commands.
It retains the newest engine observation while one credential operation awaits
ordered replay, recovers interrupted outbox insertion with a stable operation ID,
and refuses to rebase stale tokens over a remote logout. Unresolved publication
blocks staging. A fresh engine observation is needed to confirm readiness after
acknowledgment; the server response alone does not establish restoration.

The macOS host polls cookies in already activated stores every two seconds under
the account lifetime lease. Lock/account replacement stop the task and close its
hidden observer view. The network transport remains WebSockets. Five capture
tests, the native browser suite, and the real WebKit probe passed; the latter now
captures actual engine observations into the encrypted offline queue.

This does not yet activate the path for unmigrated production profiles. Prioritize
initial profile ownership/export/staging and incoming restore/reopen integration
next, then Windows and non-cookie storage. The remaining cleanup, recovery,
checkpoint/revocation and full provider/macOS-to-Windows acceptance gates remain
open; the product must not claim completed signed-in handoff.
