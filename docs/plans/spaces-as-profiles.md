# Spaces as profiles: build plan

Status: planned 2026-10-16; nothing built. Design: [Spaces as profiles](../design/spaces-as-profiles/BRIEF.md).
Engine findings: [spike: separate website data per Space](spikes/space-web-data.md). It builds on
[Spaces, simplified](../design/spaces-simplified/BRIEF.md), which is in `main`.

A Space becomes a browser profile: one encrypted vault per person per Space, its own website data
store, its own OS windows, extensions, memory tree and integration picks. One sync password opens
every vault. The server stores the vaults only as ciphertext; it keeps each person's memory tree,
integration picks and Space items readable, and routes device jobs.

## Where the code stands

These are the single-Space assumptions the plan removes, with where they live today.

| Area | Today | File |
| --- | --- | --- |
| Server vault | One vault per user: `browser_sync_vaults` has `PRIMARY KEY (user_id)`; `BrowserSyncVault(userID)` reads it | `server/internal/sync/store.go`, baseline migration |
| Desktop sync | One `Session` per process (`static SESSION`) | `src-tauri/src/infra/browser_sync.rs` |
| Store choice | One `SELECTED_PROFILE`; switching errors until every view closes | `src-tauri/src/infra/browser_sync/profile.rs` |
| Store identity | `default_profile_id(scope)` hashes deployment, account and `vault_id` into the logical profile; the encrypted registry binds it to a physical store | `browser_sync/profile.rs`, `infra/browser_profile.rs`, `browser_create.rs` |
| Windows | One app window labelled `main`, about 155 `"main"` uses under `src-tauri/src`; virtual windows inside it | `src/features/workspace/windows.ts`, `windowColors.ts`, `DesktopLayout/WorkspaceWindowMenu.tsx` |
| Device profiles | `profile:<id>` scopes, each with a random store and its own virtual windows | `src/features/workspace/browserProfiles.ts`, `DesktopLayout/BrowserProfileMenu.tsx`, `infra/browser_profile_cleanup.rs` |
| Extensions | One `static MistyExtensionHost *host`; `configureStore:` rebuilds the controller on store change; packages under `extensions/<account>` | `src-tauri/native/macos/MistyExtensions.m`, `infra/extensions/mod.rs` |
| Collections | `bookmarks`, `tab_groups`, `history`, `extension_sync`, `passwords` | `src-tauri/crates/browser-sync/src/collections.rs`, `server/internal/sync/store_records.go` (`syncRecordCollections`) |
| Device-local data | Site permissions (per store, in `misty.db`), downloads and history (`misty.db`), search engine and custom bangs (settings store) | `browser_site_permissions_db.rs`, `browser_library.rs`, `workspace/browserSearchEngine.ts`, `settings/store/useSettingsStore.ts` |
| Memory | `memory_events`, `memory_backlog`, `misty_memories`, `agent_methods`, `agent_method_versions`, `agent_method_lessons`, `ai_recaps`; tools `memory.pref.*`, `memory.history.*`, `memory.workflow.*` run on the server | `server/internal/platform/postgres/{memory_events,misty_memories,agent_methods,agent_method_lessons,ai_recaps}.go`, `httpapi/{agent_memory_tools,recall_agent_tools,agent_method_tools}.go` |
| Device jobs | `workflow_device_node_jobs`, claimed by the device; runs wait on a deadline | `httpapi/device_job_wait.go`, `device_job_claim_wait.go`, `device_agent_tools.go` |
| Integrations | Composio holds every account; one `composio_sessions` row per user; no per-Space choice | `server/internal/integrations/composio/`, migration `20271004050000_composio_sessions.sql` |
| Agents | `misty_ask_identities` with `space_agents(space_id, agent_id, owner_user_id)` membership; no home Space | migration `20271024000000_space_agents.sql` |
| Storage | Plans limit cloud storage and AI usage, not Spaces; `cloudusage` measures vault bytes per account | `server/internal/cloudusage/`, migration `20271003120000_account_cloud_measurements.sql` |
| macOS | `minimumSystemVersion` 12.0; 12–13 fall back to ephemeral stores (`browser_requires_ephemeral_store`) | `src-tauri/tauri.conf.json`, `browser.rs`, `browser_macos.rs` |

## Phases at a glance

| Phase | Ships | Needs | Runs alongside |
| --- | --- | --- | --- |
| 0. macOS 14 | Builds and runs only on 14+; ephemeral fallback gone | — | 1, 8 |
| 1. Vaults per Space on the server | API that lists, creates and opens one vault per person per Space | — | 0, 8 |
| 2. Sync per vault on the desktop | One password opens every vault; one sync loop per open vault | 1 | 3 |
| 3. One OS window per Space | Space windows with their own store; virtual windows removed | 1 | 2 |
| 3b. Switch Spaces in a window; Space row | Arc-style switching in place; Space controls in the sidebar | 3 | — |
| 4. One extension host per Space | Extensions installed and running per Space | 3 | 5, 6, 7 |
| 5. New sync-tree collections | Extensions list, site permissions, search engines and bangs, downloads list sync per Space | 2 (apply side of extensions: 4) | 4, 6, 7 |
| 6. Device profiles folded into Spaces | `profile:` scopes and their menu gone; site routing moves to Spaces | 3 | 4, 5, 7 |
| 7. The memory tree | Memory per person per Space on the server, searched by meaning | — | everything |
| 8. The integrations tree | Connect once, pick per Space | — | everything |
| 9. Private and public layers, agents in a Space | Agents have a home Space; one access check guards every private layer | 7, 8 | — |
| 10. Onboarding teaches Spaces | First run creates and explains Spaces | 3, 6, 9 | — |

Start 0, 1, 7 and 8 at once. After 1, run 2 and 3 side by side. After 2 and 3, 4, 5 and 6 can
each go to their own session; 4 and 6 both touch window code, so give them separate worktrees and
merge 3 into both first. 9 waits for 7 and 8; 10 comes last.

There is no Space limit on any plan: plans limit cloud storage and AI usage. Phase 1 makes sure every
Space vault's bytes count toward its owner's storage through `cloudusage`, as the one vault does
today.

Every phase follows the repo's rules: goose migrations under
`server/internal/platform/postgres/migrations/` dated after `20271027000000`, server DB tests through
`server/test.sh`, contract gates in `src/tests/contracts`, CRLF kept in the files that use it, and the
check in the Tauri shell rather than the bare Vite port. There are no users, so nothing is migrated
for people: local data becomes the personal Space and the rest is dropped.

---

## Phase 0. Raise macOS to 14

**Goal.** Make named website data stores a guarantee, not a branch.

**Touches.**
- `src-tauri/tauri.conf.json`: `bundle.macOS.minimumSystemVersion` to `14.0`.
- `browser_requires_ephemeral_store` and its callers (`browser.rs`, `browser_macos.rs`,
  `browser_create.rs`, `browser_page_tools.rs`, `browser_profile_cleanup.rs`):
  remove the macOS 12–13 ephemeral fallback; keep the legacy fixed store only where the personal
  Space still reads it.
- `src-tauri/Cargo.toml` and native build flags: `MACOSX_DEPLOYMENT_TARGET=14.0` for the ObjC in
  `src-tauri/native/macos/` so `@available` checks below 14 can go.
- Release notes and the download page's system requirements.
- Extensions keep their own `@available(macOS 15.4, *)` gate (`misty_extensions_supported`).

**Migrations.** None.

**Tests.** `cargo test` for browser creation; a release build launched on macOS 14
opens a page in a named store (the `space_store_probe` example from the spike, run on 14).

**Done.** The app refuses to install below 14, no code path picks an ephemeral store for a normal tab,
and extensions still turn off below 15.4.

**Built 2026-10-17 (unverified).** `minimumSystemVersion` is 14.0 (the Tauri CLI passes it on as the
deployment target) and `browser_requires_ephemeral_store`, with every branch that used it and the
unregistered `browser_profile_persistence` command, is gone. Left for a cleanup pass: `@available`
checks for macOS 14.0 and below in `src-tauri/native/macos/` (now always true) and the xcap screenshot
fallback for 12–13 in `cursor_companion/platform.rs`.

**Risks.** Small. Anyone on 12–13 loses the app, which is acceptable with no users. Check that the
updater refuses to offer the 14-only build to older Macs rather than installing a broken one.

## Phase 1. Vaults per Space on the server

**Goal.** Let one account hold one vault per Space it belongs to, all opened by the same sync
password, without the server learning anything new.

**Design.**
- A vault belongs to a person and a Space: `browser_sync_vaults` gets `space_id`, its primary key
  becomes `vault_id`, and `UNIQUE (user_id, space_id)` keeps one vault per person per Space. The
  personal Space adopts the vault the account already has, so its `vault_id`, logical profile and
  store don't change.
- **One password, many vaults.** Only the personal vault keeps the password-wrapped
  `key_envelope` (`VaultRoot::wrap`). Each other vault's root is sealed to the personal root
  (a new `space_key_envelope`, AEAD under a key derived from the personal root with the new
  `vault_id` as associated data). Unlocking the personal vault opens every other root without a
  second password; a password change rewraps one envelope. The server only stores the sealed bytes.
- **Devices.** A device already admitted to the personal vault grants itself into each Space vault,
  signing the grant with that vault's root (the root it just opened). `browser_sync_devices` rows stay
  per vault, so revoking a device revokes it in every vault in one transaction.

**Touches.**
- `server/internal/sync/store.go`: `BrowserSyncVault(userID)` becomes `BrowserSyncVaults(userID)` and
  `BrowserSyncVaultForSpace(userID, spaceID)`; `CreateBrowserSyncVault` takes the Space and either a
  password envelope (personal) or a Space envelope (other Spaces); revoke spans vaults.
- `server/internal/sync/http.go` and handlers: `GET /sync/vaults`, `POST /sync/vaults` (create for a
  Space the caller is a member of), the existing per-vault routes keep taking `vault_id`.
- `server/internal/platform/postgres/devices_unified.go`, `devices_lists.go`: device lists span vaults.
- `server/internal/platform/postgres/spaces_create.go` and Space delete/leave: deleting a Space or
  leaving it deletes that member's vault rows (ciphertext only) through the existing object deletion
  jobs.
- `src-tauri/crates/browser-sync/src/crypto.rs`: `VaultRoot::seal_space_root` /
  `open_space_root`, with vectors.
- `src-tauri/crates/browser-sync/src/transport.rs`: list and create calls.

**Migrations.**
- `2027102800…_sync_vault_per_space.sql`: add `space_id`, backfill it with each user's personal Space
  (`misty_ensure_personal_space`), swap the primary key, add `UNIQUE (user_id, space_id)` and
  `space_key_envelope`, with a check that exactly one of the two envelopes is set. Update the RLS
  policies and the `account_cloud_measurements` trigger that looks vaults up by `vault_id`.

**Tests.** Store tests (`store_test.go`, `store_vectors_test.go`) for two vaults per user, the unique
rule, membership checks on create and cascade on leave; crypto vectors in the crate
(`tests/encryption.rs`) for sealing and opening a Space root and refusing a root sealed for another
`vault_id`; contract test in `server/test/contract/http/api/` for the list and create routes.

**Done.** A test account can create a second vault for a Space it belongs to, list both, and open
the second with only the personal root; a non-member can't create one.

**Risks.** Changing a primary key under the busiest sync tables; do it while there are no users and
keep every per-vault query keyed by `vault_id`. The Space envelope makes the personal root the one
key that matters; losing it loses every vault, the same as today.

**Built 2026-10-16.** Migration `20271028100000_sync_vault_per_space.sql`; `store_vaults.go`
(`BrowserSyncVaults`, `BrowserSyncVaultForSpace`, `BrowserSyncVaultByID`; `CreateBrowserSyncVault`
takes the Space and `SyncVaultKeys`); `GET`/`POST /sync/vaults`. A Space vault is granted only to a
device already in the personal vault under the same key. `GET /sync/vault`, `GET /sync/devices`
(without `vault_id`), device controls and `DeviceVaultRoot` keep meaning the personal vault; the
socket's welcome frame sends the ticket's vault. Device revoke and rename span every vault. Leaving,
being removed from or deleting a Space deletes those vault rows in the same transaction (vault data
is all in Postgres, so no object jobs are involved), and a hard-deleted Space cascades. The sync
tables have no RLS and the `cloud_bytes` trigger already finds a vault's person by `vault_id`, so
neither needed changes. Crate: `VaultRoot::seal_space_root` / `open_space_root`, `SpaceVault`,
`Transport::vaults` / `create_space_vault`. For Phase 2: the crate's `Vault` still requires
`key_envelope` (`deny_unknown_fields`), so the welcome frame for a Space vault won't parse until it
accepts `space_key_envelope`.

## Phase 2. Sync per vault on the desktop

**Goal.** Run one sync session, sign-in capture/restore loop and lease per open Space vault, with one
unlock.

**Touches.**
- `src-tauri/src/infra/browser_sync.rs`: `SESSION` becomes `HashMap<VaultId, Session>`.
  Functions that read "the" session (`device_admission_authority`, `extension_sync_handle`,
  `is_account_browser_profile`, the views) take a `vault_id` or the personal vault. Device admission
  keeps using the personal root.
- `src-tauri/src/infra/browser_sync/profile.rs`: `SELECTED_PROFILE` becomes a map keyed by `vault_id`;
  `select_bound_profile` is checked per vault, so opening a second Space no longer errors with
  "The browser profile changed". `BrowserProfileLease` carries the vault.
- `browser_sync/vault_open.rs`: `open_vault_with` opens the personal vault, then each Space vault
  from `GET /sync/vaults`, granting this device into vaults it isn't in yet. The guard "Switch the
  active browser account before opening a different vault" becomes per account, not per vault.
- `browser_sync/database.rs`: `database_path` and `lock_database` take the `vault_id`, so each vault
  has its own encrypted local store.
- `browser_sync/capture.rs`, `collect.rs`, `device_data.rs`, `history.rs`, `handoff.rs`: one loop per
  session, each with its own `CaptureView` opened in that vault's physical store (already supported
  by `CaptureView::open(app, physical)`).
- `browser_sync/account.rs`: lock, stop and change account close every session.
- **Clipboard:** one ring per account. `CLIPBOARD` stays in the personal vault only; every Space
  window reads and writes it through the personal session (`src-tauri/src/infra/cloud_clipboard/`).
- Frontend: `src/features/browser-workspace/` sync status (`BrowserSyncBadge`, `BrowserSyncSettings`)
  shows one state for the account and names a Space only when it is the one with a problem.

**Migrations.** Local only: the existing local database is renamed to the personal vault's path on
first launch. No server change.

**Tests.** `browser_sync/tests.rs` with two vaults: both open on one unlock, a lock closes both,
capture in Space A never reads Space B's store (`CookieStoreError::Profile`), sessions survive one
vault failing. Crate tests unchanged. A live check on the isolated stack: two Spaces, sign in to a
site in one, see it restored on a second device in that Space only.

**Done.** Unlocking once opens every Space vault; a sign-in captured in one Space restores only in
that Space on another device.

**Risks.** Lock ordering: `browser_lifecycle()` is one `RwLock` for every vault; keep it for account
changes and add a per-vault lock for store selection so one vault's restore doesn't stall another
Space's tabs. Background cost: N vaults mean N sockets; use the sync batching policy and open sockets
only for vaults with an open window, pulling the rest on a timer.

**Built 2026-10-16.** Sessions live in a registry keyed by `vault_id` (`browser_sync/sessions.rs`),
each in its own `Arc<Mutex<Option<Session>>>`, so one Space's restore never stalls another's pages.
Account-wide services (device admission, extensions, passwords, the clipboard, the account event
feed, control advertisement) use the personal vault. `SELECTED_PROFILE` is a per-vault map that
remembers the personal vault while locked (`profile_selection.rs`), and each vault has a store lock:
leases take its read side, restores and store switches its write side, and `browser_lifecycle()`
stays for account changes (order: lifecycle, store lock, session). `BrowserProfileLease` carries
`vault_id`; a lease with no profile uses the personal vault, a named logical profile its own vault.
Restores and store switches close only that profile's pages (`close_profile_views_except`).
Databases live at `.local/sync/<account>/vaults/<sha256(vault_id)>/workspace.sqlite`; the older
single database moves to the personal vault's path on first launch, and a `personal-vault` file
names it. Unlock opens the personal vault, then `space_vaults::open_all` opens every Space vault
from `GET /sync/vaults` (or, offline, from local caches with a `space` marker) with
`open_space_root`; a device not yet in a vault joins with its personal device id and key, and its
worker enrolls it. A Space session's legacy capture never falls back to the pre-sync store.
Crate: `Vault` takes `key_envelope` or `space_key_envelope` (both optional, exactly one checked in
`CachedVault::verify`), `SyncApi::for_vault` scopes the device roster, enrollment finds a Space
vault through `vaults()`, and `WorkerHandle::set_live(false)` makes a worker pull every
`batch::pull_interval()` (5 min scaled by sync frequency) and publish queued changes, holding no
socket in between. Space vaults start dormant; `browser_sync_space_window(space_id, open)` creates
the Space's vault if the person has none, opens it and keeps its socket open while a window shows
it. **Phase 3 must call it** when a Space window opens and closes, and pass the Space's logical
profile to `browser_profile_lease`. Status: the personal view carries `space_problems` and the
badge names a Space only when its vault is the one in trouble. Not done: agent tasks still stop
account-wide on a store switch (`stop_account_tasks`), and the isolated-stack live check (two
Spaces, a sign-in restored on a second device in one Space only) hasn't run.

## Phase 3. One OS window per Space; virtual windows removed

**Goal.** Every Misty window belongs to one Space, opens its pages in that Space's store, and takes
the Space's color. Virtual windows go away.

**Touches.**
- **Window labels.** A new helper module (`src-tauri/src/infra/space_windows.rs`) owns labels of the
  form `space-<vault short id>` and answers `space_for_window(label)` and `windows_for_space(id)`.
  Every `"main"` under `src-tauri/src` (about 155: `browser.rs`, `browser_create.rs`,
  `browser_profile_view.rs`, `extensions/native.rs` `trusted`, `browser_sync/*`, `agent_dock*`,
  `cursor_companion/*`, `tray.rs`, `app_menu.rs`, `device_channel.rs`, `web_fetch.rs`,
  `page_state/`, `lib.rs`) moves to it: events go to the Space's windows (`emit_to` per window or
  `emit_filter`), and trust checks accept any Space window.
- **Store from the window, never the renderer.** `browser_create.rs` resolves the store natively from
  the creating window's Space (logical profile from the vault scope, physical from the registry).
  Popups (`browser_popups.rs`), hidden capture views and agent pages inherit it.
- **Opening a Space.** A native command opens or focuses a Space's window; the app menu, Dock menu
  and ⌘⇧N list Spaces with checkmarks for open ones. Closing the last window of a Space ends its
  views; quitting remembers which Spaces were open.
- **Frontend.** `src/features/workspace/windows.ts`, `WorkspaceWindowsState` (`windowsByScope`,
  `activeWindowIdByScope`), `WorkspaceWindowMenu.tsx`, `WindowColorPopover.tsx`,
  `useWindowTransition.ts`, `closedWindows.ts`: removed. Each renderer boots with its Space from the
  native side and has one layout. `windowColors.ts` becomes the Space color; the picker moves to the
  Space's menu. `WorkspaceScopeKey` keeps `space:<id>` and drops `global`.
- **Sync tree.** The workspace tree keeps window → tab → pane → view; a "window" is now an OS window
  of that Space, with the same stored names (`docs/design/sync/BRIEF.md` vocabulary is frozen).
- **Windows platform.** `browser.rs` `with_browser_data` already points views at
  `~/.misty/profiles/<profile>/webview`; give each Space its own folder (option 1 in the spike).
- **Incognito windows replace private tabs.** An incognito window belongs to a Space; all of that
  Space's incognito windows share one temporary session, erased when the last one closes, as in
  Chrome. Patch the vendored wry (recorded in `src-tauri/vendor/wry/MISTY-PATCH.md`) so
  `private_data_store` is no longer one thread-local: the caller passes a session key (Space plus
  incognito session) and gets a fresh `nonPersistentDataStore` per key, dropped with the session.
  Incognito windows get their own label (`incognito-<space>-<n>`), never join the sync tree,
  recovery snapshots, history, memory or agent tools, and have no extension host unless an
  extension is allowed in incognito. Remove private tabs: `src/features/workspace/privateBrowsing.ts`,
  the `private` flag on browser view state and `wry`'s shared `extension_private_data_store` use.
- **AGENTS.md.** Rewrite the virtual-window color exception as the Space color exception.

**Migrations.** Frontend `workspaceMigrations.ts`: drop virtual windows; the active window's tabs
become the personal Space's window. No server change.

**Tests.** Vitest for the workspace store without windows; `windowColors.test.ts` becomes the Space
color test; Rust tests that `space_for_window` rejects unknown labels and that a page created from a
Space window gets that Space's store; the spike's `space_store_probe` adapted into a test that opens
two Space windows. Contract gate: no new `"main"` literal under `src-tauri/src` outside the helper.

**Done.** Two Spaces open side by side in two OS windows, signed in to the same site as different
people, each tinted with its Space color; the window menu and virtual-window UI are gone. An
incognito window in Work starts signed out, stays apart from Personal's incognito windows, and
forgets everything when the last one closes.

**Built 2026-10-17 (unverified in the Tauri shell).**
- **Labels.** `infra/space_windows.rs` (with `space_windows/{registry,lifecycle,commands}.rs`)
  owns `space-<key>` and `incognito-<key>-<n>`. The key is `personal` for the personal Space and the
  Space id's 32 hex digits otherwise, not the vault id: a window must open before sync is set up,
  when a Space has no vault yet. No `"main"` literal remains under `src-tauri/src` (contract gate
  `src/tests/architecture/spaceWindows.contract.test.ts`; git branch fixtures are exempt).
  Account-wide events go to every Space window (`emit`), what the person acts on (menus, dictation,
  the cursor agent) to the window used last (`emit_to_focused` / `emit_to_primary`), page events to
  the tab's own window, and trust checks accept Space windows; incognito windows get the app's
  commands minus sync, recovery, history, clipboard sharing, voice and agents
  (`app_command_policy.rs`).
- **Store from the window.** `browser_create.rs` reads the Space from the calling window (agent
  windows inherit the Space window that opened them, `space_windows::adopt`). The personal Space
  keeps the account's vault store through `browser_profile_lease`; every other Space gets
  `space_store_identity(key)`, a named store hashed from its Space id. When Phase 2 lands, swap that
  hash for the Space vault's logical profile and registry binding. Device profiles still pass their
  own store id, only in the personal window, and never another Space's.
- **Opening Spaces.** One window per Space. The Window menu lists Spaces with checkmarks for open
  ones, the Dock menu does too (`native/macos/MistySpaceDock.m`; Tauri has no Dock menu), ⌘⇧N pops
  the same list, ⌘⌥N opens an incognito window and ⌘⇧W closes the window. The open Spaces, their
  names and colors and the window used last are kept in `~/.misty/space-windows.json`; launch
  reopens them. Links from other apps go to the last focused Space window.
- **Frontend.** Virtual windows are gone (`windowsByScope`, `activeWindowIdByScope`,
  `closedWindowsByScope`, the window menu, color popover, transition, swipe and closed-window
  history). Each renderer reads its Space from its label (`workspace/spaceWindow.ts`), keeps one
  layout under `space:<id>` (`space:personal` for the personal Space) and one `activeWindowId` for
  the sync tree. Device profiles keep their own layouts until Phase 6. The Space menu
  (`SpaceWindowMenu.tsx`) replaces the window menu: Spaces, New incognito window, Space color,
  Close window. Each Space window saves its own recovery record; the personal one keeps the old
  record, so its active virtual window's tabs come back. Until Phase 2 only the personal Space's
  window syncs.
- **Incognito.** Vendored wry keeps one non-persistent store per session id (MISTY-PATCH.md); a
  Space's incognito windows share one, erased when the last closes. Private tabs and the `private`
  view flag are gone; incognito windows never save, sync, record history or run agents, and have no
  extension host.
- **Space deletion.** Deleting or leaving a Space closes its windows, then erases its store a few
  seconds later through `browser_profile_cleanup.rs`.
- **Not done.** The Windows incognito session is WebView2 InPrivate in the Space's data folder;
  site permissions for every incognito session clear together on Windows. Extension events still go
  to every Space window (Phase 4 gives each Space its own host); new tabs an extension asks for open
  in the window used last.

**Risks.** The label sweep is wide and easy to get half right: an event still sent to `main` silently
does nothing. The contract gate catches literals; a grep for `get_webview_window(` catches the rest.
WebKit keeps a store alive briefly after its last view closes, so Space deletion removes the store in
a later step (`removeDataStoreForIdentifier:`), as `browser_profile_cleanup.rs` does.

## Phase 3b. Switch Spaces in a window; the Space row

Decided 2026-10-17, after phases 0–9 were built and merged: a window is no longer tied to one
Space for its life. It shows one Space at a time and switches in place, Arc-style; see the brief's
"Windows" and "The Space row".

**Goal.** Switching a window's Space swaps its tab strip, and the store, extension host, sync vault,
memory, agents and color follow. The Space's controls move into a sidebar row; the Space settings
page goes away.

**Touches.**
- `src-tauri/src/infra/space_windows*`: labels stop naming a Space (`window-<n>`,
  `incognito-<n>`). The registry keeps each window's current Space, saved with the open windows at
  quit; `space_for_window(label)` reads it, so its callers keep working. A
  `space_window_switch` command (Space checked against the account's listed Spaces) changes it and
  tells that window. `space_window_open` always opens a new window. Incognito sessions stay per
  Space; a switching incognito window moves to that Space's session.
- `browser_sync/view.rs` and the edit commands: a window's sync view and edits use its current
  Space's vault, not always the personal one.
- `src/features/workspace/spaceWindow.ts`: the window's Space becomes state that changes on switch.
  `windows.ts` and `browser-workspace/source.ts` keep one layout and one sync-tree window id per
  Space scope (`layoutsByScope`), so switching shows that Space's tabs and back restores them.
- Pages of the Space switched away from stay alive briefly, then suspend, as background tabs do.
- The Space row in the sidebar (`DesktopLayout`), its ⌄ menu (Spaces with checkmarks, Open in new
  window, New Space, Rename, Color, Leave or Delete), and Home, Chat, People. The collapsed
  sidebar puts the avatar and name at the start of the tab strip.
- Remove the Space settings page (`SpaceSettings.tsx`, General and Members); members move to People.
- AGENTS.md: the Space color applies to the window's current Space; the Space row is allowed beside
  the tab strip.

**Migrations.** None.

**Tests.** Rust: switching changes `space_for_window`, a page opened after a switch uses the new
Space's store, a switch to an unknown Space is refused. Vitest: switching swaps layouts and back;
the sync view follows the switch.

**Done.** In one window, switch from Work to Family: Family's tabs appear signed in as Family; switch
back and Work's tabs are where they were.

**Risks.** Pages of several Spaces alive in one window cost memory; suspend them. The Spaces UI is
being redesigned in another session; the Space row replaces its in-page header, so the two meet at
merge.

**Built 2026-10-17 (unverified in the app): the switching, not the Space row.** Window labels are
`window-<n>` and `incognito-<n>`; the native registry keeps each window's current Space (saved per
window at quit) and `space_window_switch` changes it. A window's sync view uses its current Space's
vault, and the sync bridge restarts on a switch. The workspace keeps a layout and a sync-tree window
id per Space (`layoutsByScope`, `windowIdsByScope`); a Space the window hasn't shown brings back its
last saved tabs from recovery. The Window menu, ⌘⇧N and the window's Space menu switch the window;
"Open in new window" opens another. Agent jobs run in the oldest open window and move when it
closes. Waiting for the Spaces redesign to land: the Space row, removing the Space settings page,
and suspending pages of a Space switched away from.

## Phase 4. One extension host per Space

**Goal.** Extensions are installed, run and keep their storage per Space, so an extension's own
requests never carry one Space's cookies into another.

**Touches.**
- `src-tauri/native/macos/MistyExtensions.m`: `static MistyExtensionHost *host` becomes a dictionary
  keyed by Space identity. Each host owns its `WKWebExtensionController`
  (`configurationWithIdentifier:` with a UUID derived from the Space), `defaultWebsiteDataStore` set to
  the Space's store, and its own contexts, tabs and windows. `configureStore:` no longer tears down a
  controller; a host is made once per Space and freed when the Space closes. Every C entry point
  (`misty_extensions_request`, `_configuration`, `_register_tab`, `_tab_event`, `_navigation`) takes
  the Space key.
- `src-tauri/src/infra/extensions/{native.rs,runtime.rs,mod.rs,install.rs,catalog.rs}`: pass the
  Space; packages move from `extensions/<account>` to `extensions/<account>/<space>`.
  `extension_popup.rs` opens popups in the right Space window.
- `src-tauri/src/infra/extensions/native_windows/`: WebView2 extensions are already per profile
  (`AddBrowserExtension` on the view's profile); point them at the Space's folder.
- Toolbar and Settings management (`src/features/extensions/`) act on the current window's Space.
- `extensions/sync.rs`, `sync_exchange.rs`: synced extension settings go to the Space's vault
  (`extension_sync_handle` takes the vault).

**Migrations.** Local: today's installed packages move under the personal Space.

**Tests.** The spike's `src-tauri/tests/webextensions/space-probe.m` becomes a kept native probe;
`sync_tests.rs` per vault; a live check that a content script and extension storage stay in their
Space.

**Done.** The same extension installed in two Spaces keeps separate storage and sign-ins, and
removing a Space removes its controller data.

**Risks.** Memory: one controller and background page set per open Space. Free a Space's host when
its last window closes. Hidden coupling in the ObjC file to a single host (event callbacks without a
Space) shows up only at runtime; route every callback through the host that raised it.

## Phase 5. New sync-tree collections

**Goal.** The four Space-wide collections the brief adds travel with the Space's vault.

**Touches.**
- `src-tauri/crates/browser-sync/src/collections.rs`: add `EXTENSIONS` (installed id, version and
  on/off; packages are fetched from the store on each device), `SITE_PERMISSIONS` (origin → camera,
  microphone, notifications, pop-ups), `SEARCH` (default engine, custom engines, custom bangs) and
  `DOWNLOADS` (url, file name, size, finished time, device that holds the file). All sealed like the
  others; extensions and site permissions native-only, never projected to a renderer.
- `server/internal/sync/store_records.go`: add the names to `syncRecordCollections`.
- `src-tauri/src/infra/browser_site_permissions*.rs`: read and write through the Space's collection;
  `misty.db` keeps a cache keyed by store (it already keys by `profile_key`).
- `src-tauri/src/infra/browser_library.rs`, `browser_downloads.rs`: record finished downloads into
  the Space's collection; the file stays where it is; other devices show "On <device>".
- `src/features/workspace/browserSearchEngine.ts`, `settings/store/useSettingsStore.ts`: search
  engine and custom bangs leave the settings store and become Space data. The Settings rows stay
  where they are and edit the current window's Space, with helper text saying so.
- Extensions apply side (needs phase 4): a device installs or removes packages to match the
  collection, and asks before installing on a device that has never had it.

**Migrations.** Local: the device's current values seed the personal Space's collections once
(`Store::import_once`). Server: none beyond the allowlist.

**Tests.** `collections_tests.rs` for each new collection (seal, keyed id, last writer wins, deletes
not recreated); server `store_records_test.go` accepts the new names and rejects unknown ones;
Vitest for the search settings reading Space data.

**Done.** Turning an extension off, blocking a site's camera, adding a bang or downloading a file in a
Space shows up on the same Space on another device, and not in other Spaces.

**Risks.** AGENTS.md says settings stay on the device; these four are Space data, not settings, and the
brief decided it. Say so in the Settings helper text so it doesn't read as account-synced settings.
Downloads lists can grow; cap them like history.

**Built 2026-10-17 (unverified in the app).** Record kinds `extension`, `site_permission`,
`search_default`, `search_engine`, `search_bang`, `download` (`document/entities.rs`); only bookmarks
and tab groups are projected to the renderer (`collections::PROJECTED`). The worker counts other
devices' changes per natively applied collection (`SyncState::revisions`, never serialized), and
`browser_sync/space_data.rs` watches them per vault: site choices replace the `misty.db` cache for
the vault's selected store, search and downloads emit `misty:space-search-changed` /
`misty:space-downloads-changed`, extensions call `extensions::space::changed` (the phase 4 hook, a
no-op today). `space_vault(space)` never falls back to another Space; `window_space(label)` returns
the personal Space until phase 3 maps window labels. Site choices made while a vault is locked are
held in memory and sent when it opens. The downloads list caps at 1,000 per Space. The personal
Space seeds once per vault (`space-collections:<vault>`) once its browser store is selected;
extensions arrive with the next reconcile. Bangs fall back to the device's settings while no Space
vault is open.

## Phase 6. Fold device browser profiles into Spaces

**Goal.** One concept: a Space. Today's device-only browser profiles go away.

**Touches.**
- Remove `src/features/workspace/browserProfiles.ts`, `DesktopLayout/BrowserProfileMenu.tsx`, the
  `profile:` scope in `model.ts`, `scopeTarget`, and their use in `NavRail.tsx`, `WorkspaceCanvas.tsx`,
  `BrowserWorkspace.tsx`, `BrowserRuntimeBridge.tsx`, `externalLinks.ts`, `workspaceStorePersistence.ts`.
- **Site routing carries over.** A profile's `sites` (links from other apps open here) becomes a Space
  setting, "Open these sites in this Space", stored in the Space's vault and read by
  `externalLinks.ts` and `default_browser.rs`.
- **Unclaimed links** open in the last-focused Space's window; with no window open, the last Space
  used opens.
- `src-tauri/src/infra/browser_profile_cleanup.rs` becomes Space store cleanup (phase 3 uses it).
- `browser_sync.rs` `is_account_browser_profile` and the device-profile guards go.
- Browser import (`src/features/browser-import/`): importing a Chrome profile can create a Space
  for it instead of a device profile.
- Site permission and settings screens that list profiles (`BrowserPermissionSettings.tsx`,
  `settings/profiles/`) list Spaces.

**Migrations.** Frontend: drop `browserProfiles` from persisted state. Native: remove device-profile
stores on first launch (no users, nothing to keep).

**Tests.** Remove the profile tests; add tests for Space site routing in `externalLinks`; contract
gate that `profile:` scopes are gone.

**Done.** There is no profile menu; a link from Mail for a work site opens in the Work Space window.

**Risks.** Low. The import flow change is the only new behavior.

**Built 2026-10-17 (unverified in the Tauri shell).**
- **Gone.** `browserProfiles.ts`, `BrowserProfileMenu.tsx`, `browserProfileResolver.ts`,
  `scopeTarget`, the `profile:` scope (`WorkspaceScopeKey` is `space:${string}`),
  `browser_device_profile_delete`, the unused `browser_profile_remove` and
  `is_account_browser_profile`. Pages in the personal Space no longer pass a renderer-chosen store:
  `browser_create.rs` takes every Space's store from its window. Contract gate:
  `src/tests/architecture/spaceProfiles.contract.test.ts`.
- **Site routing.** The sites live in a native-only `space_settings` collection (kind
  `space_sites`, one `sites` record per vault, server allowlist in `store_records.go`), edited in
  Space settings › General ("Open these sites in this Space") through
  `browser_sync_space_sites` / `browser_sync_set_space_sites`. Each open vault copies them to the
  Space registry (`space-windows.json`, `SpaceEntry.sites`) on open and every minute, so links
  route while the vault is locked. Links are routed natively (`space_windows/links.rs`): macOS
  open-URL events (`app_lifecycle.rs`), Windows launch arguments and second-instance links. A
  link goes to the Space that claims its host (subdomains included, most specific wins), else to
  the last focused Space window, else the Space used last; that window opens or comes forward and
  takes its queue (`app_take_launch_urls`, `misty://space-links`). The renderer no longer handles
  web links from the deep-link plugin; `misty://` links still go to the last focused window.
- **Import.** Native picks the import target from the calling window's Space
  (`browser_import/mod.rs` `space_store`), not the focused tab. The review step offers "Make a
  Space for this profile": it creates the Space, hands the import to the new window through shared
  storage (`browser-import/spaceImport.ts`) and that window runs it (`SpaceImportRequest`).
- **Settings.** Website permissions list each choice with its Space's name; `settings/profiles/`
  holds device preferences only and listed no browser profiles, so it is unchanged.
- **Migration.** Saved `browserProfiles` and `profile:` layouts and tab groups are dropped; their
  stores are erased once per device (`browser_retired_profiles_erase`, marker
  `~/.misty/retired-device-profiles`), never a Space's store or one a vault uses.
- **Not done.** Non-personal Spaces still use Phase 3's `space_store_identity(key)` store rather
  than the Space vault's logical profile from Phase 2 (`browser_profile_lease(Some(logical))`),
  and only the personal window runs sync in the renderer (`AppFrameLayout.tsx` `syncAllowed`).

## Phase 7. The memory tree on the server

**Goal.** Each person has one memory tree per Space (moments, summaries, facts, workflows), kept on
the server, always private, and searched by meaning. It is not in the vault and not end-to-end
encrypted (decided 2026-10-17). Needs only Spaces, which exist, so it can start now.

**Touches.**
- **A Space on every memory row.** `memory_events` and `memory_backlog` (moments), `ai_recaps`
  (summaries), `misty_memories` (facts) and `agent_methods`, `agent_method_versions`,
  `agent_method_lessons` (workflows) gain `space_id`; owner-only RLS by `(space_id, owner)`. The table
  names stay; Moments, Summaries, Facts and Workflows are the names people and agents see. Go stores:
  `memory_events.go`, `misty_memories.go`, `agent_methods.go`, `agent_method_lessons.go`,
  `ai_recaps.go`, `workflow_schedules.go`.
- **Capture in the window's Space.** `src/features/recall/api.ts` and `httpapi/memory_api.go` send
  the Space of the window the moment came from; incognito windows send nothing.
- **Embedding search.** Memory search is by meaning; there is no full-text search. The server
  embeds each record's text through the runtime's AI SDK (Misty's keys, billed to the owner as
  background work) and keeps the text and vectors in `memory_chunks(space_id, owner_user_id, branch,
  record_id, chunk, text, embedding vector(768))` on the existing pgvector setup, with an HNSW index.
  If the retrieval path in `ai_retrieval.go` (`ai_retrieval_chunks`) has no other callers, fold it into
  this table instead of keeping both.
- **Agent tools stay on the server.** `memory.pref.*`, `memory.history.*` and `memory.workflow.*`
  (`agent_memory_tools.go`, `recall_agent_tools.go`, `agent_method_tools.go`) read and write the run's
  Space only, and register only when phase 9's check allows the private layer. No device jobs and no
  waiting for a device.
- **Learning and recaps on the server,** as today, now per Space: lessons are written into the run's
  Space's workflows, and day recaps are built per Space from its moments.
- **Workflow schedules** (`workflow_schedules.go`, `workflow_schedule_devices.go`) keep pointing at
  `agent_methods` rows; a schedule runs in its workflow's Space.
- **Memory pages** in the app show the current window's Space.
- **Retention:** moments are kept until the person deletes them; no expiry job. They count toward
  storage like everything else.

**Migrations.** `…_memory_per_space.sql`: add `space_id` to the memory tables, backfill each row with
its owner's personal Space, set `NOT NULL`, replace RLS policies with owner-and-Space ones, and create
`memory_chunks` with its index. Embeddings for existing rows are backfilled by a background job.

**Tests.** Go store tests that a row written in Work is invisible from Personal and to every other
member; search ranking on fixtures ("my seat preference" finds "I like aisle seats"); tool tests that
memory tools are absent from a teammate's run; a recap built from one Space's moments only.

**Done.** An agent remembers a preference in Work, finds it by meaning the next day from any device,
can't find it from Personal, and works with every device asleep.

**Risks.** Embedding every moment costs money: batch moments hourly, skip near-duplicates and count
the calls as the owner's background AI usage. Stored text and vectors count toward the owner's
storage. Say plainly on the privacy page and in Settings helper text that memory is kept on Misty's
server, readable by the service, and private to you within each Space.

## Phase 8. The integrations tree

**Goal.** Connect each account once; each Space picks which of your accounts it uses.

**Touches.**
- Server: a new owner-only table `space_integration_picks(space_id, owner_user_id,
  connected_account_id, toolkit)`; Composio keeps the tokens (`integrations/composio/accounts.go`).
  A run in a Space passes only that Space's picked accounts to Composio
  (`integrations/composio/sessions.go`, `proxy.go`); a toolkit with no pick in the Space asks to
  connect or pick, as `agent_app_requests` does today.
- API: list your connected accounts with the Spaces that use each; set picks for a Space.
- Desktop: the Integrations page shows the tree (account → Spaces using it) and each Space's
  settings show its picks with checkmarks. `BrandIcon` logos per AGENTS.md.

**Migrations.** `…_space_integration_picks.sql`: the table with RLS; seed the personal Space with
every connected account.

**Tests.** Go tests that a run in Work can't use an account picked only in Personal, and that
nobody but the owner reads picks; Vitest for the tree.

**Done.** Work Gmail answers in Work and personal Gmail in Personal, from one Composio connection
each.

**Risks.** Composio's per-session tool filtering must accept a list of connected accounts per call;
verify it before building, or filter in the proxy.

**Finding (2026-10-16).** Composio's `POST /tool_router/session` takes `connected_accounts`, a map of
toolkit to account IDs that pins which accounts the session uses (one per toolkit unless
multi-account is on). Its docs don't say pinning keeps the person's other accounts out, and pinning
would need one Composio session per person per Space. So Misty keeps one session per person and
enforces picks itself (`httpapi/apps_space.go`): `integration.execute` always passes the picked
account explicitly and refuses any other, `integration.search` and `integration.connected` show only
the Space's picks, and `integration.connect` shows a pick card (`agent_app_requests.kind = 'pick'`,
with the request's `space_id`) when the person has accounts the Space doesn't use. Connected
accounts live in Composio, so the migration can't seed them: the first listing that sees an account
picks it in the personal Space once (`space_integration_seen`), and an account connected from a
run's Connect card becomes that Space's pick. The direct proxy callers (inbound +misty email and
Slack, GitHub repos for code projects) still use the person's first active account; move them onto
picks with phase 9.

**Built (2026-10-16).** Migration `20271027080000_space_integration_picks.sql`;
`postgres/space_integration_picks.go`; API `GET /integrations/apps` (each account lists the Spaces
using it), `PUT /integrations/apps/spaces/{spaceID}`, `POST /me/app-requests/{id}/pick`. Desktop:
the Integrations page's account card shows each account's Spaces; Space settings › Apps checks the
accounts that Space uses; the chat card offers "Use <account>" for a pick.

## Phase 9. Private and public layers; agents belong to a Space

**Goal.** Public and private layers are the only permission system, and agents are built on them.
Every Space item has a private/public toggle, except the layers that are always one or the other.
One check, in one place: a private layer opens only for its owner, and for the owner's own agents on
runs the owner asked for. Agents have a home Space. The layer map is in the
[brief](../design/spaces-as-profiles/BRIEF.md#private-and-public).

**Touches.**
- **Layers in the code.** Every agent tool, device job and read path declares the layer it touches
  (`agenttools.Registration` gets a `Layer`: `public` or `private`), the way it already declares
  `Locality`. Registering a tool without a layer fails at startup.
- **One check.** `privateLayerAllowed(run, layerOwner)` is true only when the run's asker, the agent's
  owner and the layer's owner are the same person. Private tools are not even registered on other
  runs, so the model never sees them: memory tools (7), device tools
  (`device_agent_tools.go` folders, tabs, bookmarks), integration picks (8), private chats and
  agent settings.
- **The private/public toggle.** Gallery items (`space_notes`, `space_drawings`, `space_nodes` for
  files and images, `space_code_projects`) and agents in a Space (`space_agents`) get
  `visibility text NOT NULL CHECK (visibility IN ('public','private'))` and an owner column where
  one is missing. Every list, read, search and change query adds "public, or owned by the viewer",
  enforced in the RLS policies so a forgotten filter still can't leak. Private agents don't appear
  in member lists or @mention suggestions, and an @mention of one by someone else is refused.
  Channels, threads and the Space's name, color and members have no toggle; the sync, memory and
  integrations trees and DMs are always private. The toggle sits in each item's menu with a
  checkmark, and a private item shows a lock icon with the word "Private".
- **Teammates' asks.** When someone else @mentions your agent, the run is theirs (they pay, as
  today) and sees only the public layer: the gallery, channels and threads of that Space. Its answer
  lands in the public thread it was asked in.
- **Home Space.** `misty_ask_identities` gets `space_id`. `space_agents` stays for membership in
  other Spaces. The Agents page (`src/features/agents/`) groups agents by home Space; the quick agent
  panel still just lists agents, and a request runs in the current window's Space.
- Runs record the Space they ran in; the run's Space decides which vault its device jobs target.
- **Leaving or deleting a Space** deletes everything of the leaver's in it in one job: their vault
  (phase 1), their memory rows and chunks, their private items and their integration picks. The
  confirm names what goes. On each device, the Space's windows close and its store is removed
  (phase 3).

**Migrations.** `…_agents_home_space.sql`: add `space_id`, backfill with each agent's owner's personal
Space, `NOT NULL`. `…_space_item_visibility.sql`: add `visibility` (default `public`; `private` for
items in a Space with one member) to the gallery tables and `space_agents`, plus the RLS policy
changes.

**Tests.** RLS tests that a member can't list, read, search or change another member's private
item, and that a private agent can't be @mentioned by someone else; a table-driven Go test of the
check across asker, agent owner and layer owner; a startup
test that every registered tool has a layer; contract test that private tools are absent from a
teammate's run.

**Done.** A note toggled private in a shared Space disappears for everyone else and their agents.
Your agent sees your private memory and apps when you ask it, and only the gallery and
chat when a teammate asks it; a teammate's agent never sees your private layer.

**Risks.** A new tool or read path that reaches private data while declared public. Review every
`Layer: public` registration that reads device or vault data.

## Phase 10. Onboarding teaches Spaces

**Goal.** A new person understands a Space as a profile per part of their life, each with its own
memory and agents, and makes their second one.

**Touches.** `src/features/setup/FirstRunSetup.tsx`, `SetupPreviews.tsx`, `src/features/welcome/`,
`src/features/agents/workspace/AgentGetStarted.tsx`, the browser import flow (a Chrome profile can
become a Space). Copy follows the no-headlines rule: short sentences, not slogans. Skeletons, never
loading text.

**Migrations.** None.

**Tests.** `setup.test.tsx` paths for one and two Spaces; a check in the Tauri shell end to end.

**Done.** First run ends with the personal Space open, an offer to make a second (named, colored,
with its own sign-ins), and a short explanation of what stays inside each Space.

**Risks.** Onboarding written before 3–9 settle will drift; build it last.

## Open questions

None. Decisions from 2026-10-17 are in the brief's "Smaller decisions" and in the phases above.
