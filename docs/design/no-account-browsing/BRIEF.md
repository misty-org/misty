# Browsing without an account: design brief

Status: approved 2026-10-23, with its open questions answered the same day (see Decided).
All four phases are written in the `claude/friendly-thompson-857543` worktree, not yet built,
tested or committed (see Build status). Parity item C16 in
[docs/plans/ai-browser-comparison.md](../../plans/ai-browser-comparison.md). Mockups:
[mockup.html](mockup.html) (seven states: first run, signed out, the sign-in sheet, Settings ›
Sync, merging on sync, signed in, signing out). It builds on
[Spaces as profiles](../spaces-as-profiles/BRIEF.md) and [Sync](../sync/BRIEF.md), and it
sits beside C17 (open-sourcing the desktop app), which keeps the sync crate open. C18
(importing Arc's Spaces) was dropped on 2026-10-23.

## The idea

Misty opens straight into a full browser. Tabs, groups, favorites, bookmarks, history,
downloads, saved passwords, extensions, search shortcuts, site permissions, browser import and
incognito all work with no account, and nothing is sent to Misty. An account is asked for only
when someone turns on sync, creates or joins a Space, or uses an agent. When they sign in, the
browsing they already have becomes their account's personal Space on this device, with nothing
reloaded and no tab closed.

The people Misty wants from Zen, Helium and Brave reject browsers that need an account, and
Arc users leaving before 2026-12-22 want to try Misty before they commit to it. Browsing
without an account comes first for both.

## What the person sees

### First launch

The welcome screen (`WelcomePage`) shows once, on first launch, in the small fixed window it
uses today. **Start browsing** is the primary button and **Sign in** sits beside it, with one
muted line: "No account needed. Sign in later to sync, share Spaces or use agents." Create
account moves into the sign-in sheet. Start browsing runs first-run setup (import from your
browser, which side the tabs sit on), then the window grows to its normal size. Every later
launch opens the browser directly, signed in or not.

### A signed-out window

The same window as today, minus what needs an account:

- **No Space bar.** Everything in it needs an account: the Spaces menu, Home, Chat, People,
  Memory and the Agents button. The bar is not drawn and the page takes its height.
- **No Space color.** A signed-out window shows no Space, so the window chrome keeps the plain
  workspace color.
- **The account row reads Sign in.** Below the sidebar card, a hollow person glyph and "Sign
  in" open the sign-in sheet; Settings stays beside it. The Sync button is not shown until
  there is an account.
- **No AI chrome.** No Agents button, no composer chips, no selection menu on pages. The
  cursor companion, dictation, capture, recall and screen memory don't mount (they already
  mount only with an account).

### Where sign-in is asked

One sheet, opened over the browsing window, for every reason. Its title and one line say what
asked, and **Not now** returns to the page. It reuses the sign-in form that exists today
(`AuthCard`, `GoogleSignInButton`, `ForgotPasswordForm`) with Create account as a link inside
it.

| What the person did | Where | Sheet title |
| --- | --- | --- |
| Pressed Sign in | Account row, first-run welcome, a new Misty › Sign In… menu item | Sign in to Misty |
| Turned on sync | Settings › Sync, Settings › Devices | Sign in to turn on sync |
| Asked for a new Space | A new Spaces › New Space… menu item (beside Open Space…), the account row's menu | Sign in to create a Space |
| Opened a Space invite link | `misty://invite/…` or the web invite page | Sign in to join a Space |
| Used an agent shortcut | Companion and dictation hotkeys | Sign in to use agents |

The sheet never appears on its own: no timed prompts, no banners, no badge on the account row.

### What works without an account

| Works signed out | Needs an account |
| --- | --- |
| Tabs, tab groups, favorites, pinned tabs, focus mode | Sync and the device list |
| Bookmarks, history, downloads | Spaces beyond the personal one, members, invites |
| Saved passwords and autofill | Space Home, Chat, People, Memory and the memory tree |
| Extensions from the Chrome and Firefox stores | Agents, the companion, dictation, capture, recall, screen memory |
| Search engines and `!bangs`, site permissions | Cloud clipboard, connected devices |
| Browser import (bookmarks, history, settings, sign-ins, extensions) | Journal and Library items kept on Misty's servers |
| Incognito windows, night light, every device setting | Billing and plans (on the website) |
| App updates | |

### Signing in

- **A new account** takes this device's browsing as its personal Space. Nothing to confirm.
- **An existing account that has never synced** does the same.
- **An existing account that already syncs from other devices** keeps this device's browsing
  on the device until sync turns on (next section).

Either way the window stays open: the Space bar slides in, the window takes the personal
Space's color, and the account row shows the person with Sync beside Settings. A short notice
says "Signed in. Your browsing on this Mac is now your personal Space." with **Turn on sync**.

### Turning on sync

For a new account, this device's data seeds the personal Space's vault. For an account that
already has synced data, one sheet asks first, with counts per kind: "Add this Mac's browsing
to your account?" **Merge and turn on sync** or **Not now**. Merging skips duplicates
(bookmarks by URL within a folder, passwords by site and username with the newest kept,
history visits by URL and time) and adds the rest. Tabs never merge: every device keeps its
own workspace in the sync tree, so this device's tabs simply appear beside the others.

### Signing out

Signing out no longer ends at the welcome screen. Sync, Spaces and agents stop on this device;
other Spaces' windows close; the window keeps browsing with the personal Space's tabs,
bookmarks, passwords, history and extensions, which belong to no account again. The sheet has
one checkbox, off by default: "Also remove my browsing data from this Mac", which erases them
and the website sign-ins here (the account keeps its synced copy).

### When the session expires

A session the server rejects no longer signs the person out to the welcome screen. Browsing
carries on; sync pauses and agents stop, and the account row shows "Sign in again" with the
same sheet. Today `useInvalidSessionHandling` sends the window to `/welcome`.

### Settings

Settings already belong to the device (`DevicePreferencesBridge` scopes them to the device and
applies them on the sign-in screen), so every device setting works signed out. Account pages
change like this:

- **Sync** and **Devices** keep their page: "Sync is off" with a **Sign in** button, and a
  section saying that without an account everything stays on this device, encrypted with a key
  in the OS keychain.
- **The Agents group** (Conversations, Cursor, Apps, Memory, and agent defaults) is hidden
  until there is an account.
- **General › About** shows "Not signed in" with **Sign in**.

`settingsRegistry.tsx` lists no pages in this checkout, so these states land when the pages
return.

## How it works

### The local profile

Everything Misty keeps per account today is keyed by `(deployment, account id)`. Signed out,
those same paths take a fixed local identity, `deployment = "local"` and `account = "local"`,
so the existing code paths run unchanged:

- **Workspace recovery** (tabs, groups, bookmarks, saved layouts) opens its encrypted store
  under the local identity. `browser_recovery_open` stops requiring a signed-in API client for
  it; only a real account checks the session.
- **Extensions** install under `extensions/local/personal/packages`.
- **First-run setup** already records completion under a `guest` key (`useSetupStore`).
- **History and downloads** are already account-free in `misty.db`.
- **Website data**: the personal Space already uses the device's `default` WebKit/WebView2
  store, so sites stay signed in across signing in and out.
- **The window's Space** is already `personal` with no Space id until Spaces load
  (`spaceWindow.ts`); signed out it simply never gets a Space record.

### The local vault

Saved passwords live only in the personal Space's vault, and a vault opens only after
sign-in and a sync unlock, so signed out (or signed in without sync) they could not be
saved at all ("Unlock your sync vault to use saved passwords.").

Every device gets a local vault on first use: the same encrypted store and records as a
synced vault, with a root made on the device and kept in Misty's credential store (the
keychain-held master key), and a worker that never connects (`local_vault.rs`, and
`Worker::local` in the sync crate). Passwords use it whenever no synced personal vault
exists. It is a local mode of the existing `crates/browser-sync`, not a second store, so
turning on sync later connects the same records.

The rest of a Space's data already works without a vault: site permissions, search
engines and bangs, the downloads list and the extensions list keep this device's own values
while no synced vault is open, and the personal vault copies them in once when sync turns on
(`seed_personal_space`).

### Adoption

Signing in from the local profile carries this device's browsing into the account, and
signing out hands it back. Nothing reloads either way.

1. **The app stays mounted.** `RootLayout` keys its page tree on `outletKey`, which changes
   only when switching between two accounts, not when signing in from the local profile or
   signing out to it.
2. **Windows and tabs**: the ones on screen become the account's workspace
   (`adoptAccountWorkspace`, which opens the account's recovery store and saves the live
   windows into it). A record the account already had on this device is archived first, never
   lost. The local profile's copy is then removed. Signing out does the reverse into the
   local profile.
3. **Saved passwords** stay in the device's local vault while no synced vault exists. When
   sync turns on they join the account (`browser_passwords_device_merge`): silently for an
   account with no passwords yet, after one question with a count otherwise. Signing out keeps
   a copy of the account's passwords in the local vault (`browser_passwords_device_keep`).
4. **Extensions belong to the device,** as their install list (a device setting) does, so
   signing in or out leaves them installed and running with nothing to move.
5. **Setup** done while signed out counts for whoever signs in: it is about the device.

Removing browsing data on sign-out erases the local vault's passwords, history, downloads,
website sign-ins and cached files, and the local profile's saved windows; the account keeps its
synced copy.

## Inventory of code that assumes an account

| Area | Where | What it assumes today | Change |
| --- | --- | --- | --- |
| Startup route | `src/app/routing/RouteConfig.tsx` (`StartupRedirect`) | No user means `/welcome` | Welcome only on first run; otherwise the last route |
| App frame | `src/app/layouts/AppFrameLayout.tsx` | No user means `/signin`; recovery gate waits for `recovery.accountId === user.id` | No redirect; recovery gate uses the profile id |
| Root remount | `src/app/layouts/RootLayout.tsx` (`<Outlet key={user?.id ?? "anonymous"} />`) | A new identity remounts the app | Keep mounted across adoption |
| Small sign-in window | `DesktopLayout/useSignedOutWindow.ts` | Auth routes shrink and lock the window and hide the others | First-run welcome only; sign-in becomes a sheet |
| Shell | `DesktopLayout/index.tsx` | `isAuthRoute` branch; Sync badge and account row take `user?.id` | Account row shows Sign in; Sync hidden signed out |
| Account row and menu | `DesktopLayout/AccountIsland.tsx`, `ProfileMenu.tsx` | A signed-in person with a menu | Signed-out variant opens the sheet |
| Space bar | `DesktopLayout/SpaceBar.tsx`, `src/features/spaces/components/spaceRow/` | A Space from the server list (`useWindowSpace`) | Not drawn without an account |
| Window color | `src/features/workspace/windowColors.ts`, `spaceWindow.ts` | The Space record's color | None signed out |
| First-run setup | `DesktopLayout/useDesktopRouteEffects.ts`, `src/features/setup/FirstRunSetup.tsx` | Starts and shows only with a user id | Runs for the local profile (`guest` key exists) |
| Welcome | `src/features/welcome/WelcomePage.tsx` | Sign in and Create account only | Start browsing first; first run only |
| Sign in and register | `src/features/auth/SignInPage.tsx`, `RegisterPage.tsx`, `components/` | Full-window routes | Content reused in the sheet |
| Sign-out | `src/features/auth/provider/useDeactivateToChooser.ts`, `useLogout.ts` | Saves or removes the account workspace, navigates to `/welcome` | Reverse adoption, keep browsing |
| Session expiry | `src/features/auth/provider/useAccountSideEffects.ts` (`useInvalidSessionHandling`), `src/api/client/session` | A dead session signs out to `/welcome` | Notice and Sign in again; keep browsing |
| Workspace restore | `useNativeWorkspaceRecovery`, `src/features/workspace/nativeWorkspaceRecovery.ts`, `workspaceAccountState.ts` | Restores per account id | Restores per profile id |
| Recovery store | `src-tauri/src/infra/workspace_recovery.rs` (`browser_recovery_open`) | Calls `account_api`, which needs a signed-in cookie client; folder hashed from deployment and account | Local identity skips the account check |
| Vault collections | `src-tauri/src/infra/browser/host_messages/passwords.rs` (`vault_handle`); `infra/search/space/vault.rs`, `infra/extensions/space.rs`, `infra/browser_library/space.rs`, `infra/site_settings/permissions/space.rs` (`space_vault`, `store_vault`) | Passwords need an unlocked synced vault; the others fall back to the device's own values | Passwords use the local vault when no synced one exists; the others stay as they are |
| Vault storage | `src-tauri/src/infra/browser_sync/database.rs`, `space_data.rs`, `crates/browser-sync/src/secure_store.rs`, `worker/run_loop.rs` | Folders and roots keyed by deployment and account; the worker always connects | Local scope; a worker mode with no transport |
| Extensions | `src-tauri/src/infra/extensions/spaces.rs`, `src/features/extensions/useExtensionsRuntime.ts` | Packages under `extensions/<account>`; runtime keyed by `user?.id ?? ""` | Keyed by the device (`local`), signed in or not |
| Browser import | `src/features/browser-import/runImport.ts`, `src-tauri/src/infra/browser_import/mod.rs` | Sign-ins go to the vault | Work through the local vault |
| Updates | `src/features/updater/UpdateNotices.tsx` | Returns early with no account id, so no update notices | Show them signed out |
| Tab archive | `src/features/workspace/tabArchive.ts`, `browser/internal/ArchivedTabsList.tsx`, `webviews/useBrowserRuntimeServices.ts` | Archiving and the list need an account id | Use the profile id |
| Settings pages | `settings/sections/PasswordsSettings.tsx`, `devices/AddThisDevice.tsx`, `MistySection.tsx` | Read `useSyncController(user?.id)` or `user.id` | Local vault for passwords; sign-in rows elsewhere |
| Telemetry | `useTelemetryIdentitySync`, `src/telemetry/` | Anonymous until `/me` verifies | Send nothing while signed out (decision 5) |
| Deep links | `src/app/routing/navigation.ts`, `SpaceInvitationRedemption` | Invite route works signed out, then asks to sign in in the small window | Invite opens the sheet over the window |
| Account-only features | `src/features/agents`, `misty`, `journal`, `ai-surface`, `voice`, `recall`, `screen-memory`, `library`, `connected-devices`, `infra/cloud_clipboard` | An account | Unchanged: hidden signed out, or the sheet when invoked |

No license check blocks browsing: `allows_use` on the native session is read but gates nothing.

## Build plan

About four and a half weeks, so it ships by early December, before Arc stops working. Phases
build in order but release together: nothing ships until phase 2's local vault works
(decision 12).

**Phase 1: browse signed out (about 1 week).** Remove the startup and frame redirects; local
identity for workspace recovery (native check skipped for
`local`); first-run welcome with Start browsing, and no small window afterwards; no Space bar
or Space color without an account; Sign in on the account row; the sign-in sheet replacing the
`/signin` and `/register` routes inside the shell; first-run setup for `guest`; update notices
and tab archiving without an account; session expiry keeps browsing. Done when a fresh install
browses, quits and reopens with its tabs, and makes no request to Misty's API while signed out.

**Phase 2: the local vault (about 1 week).** A local mode in the existing sync crate: a
root made on the device, a worker that never connects, and saved passwords (saving, autofill
and the Passwords list) falling back to it whenever no synced personal vault exists. Site
permissions, search shortcuts, downloads and extensions already keep the device's own values
signed out. Done when a password saved signed out autofills after a relaunch.

**Phase 3: adoption (about 1 week).** Keep `RootLayout` mounted across sign-in and sign-out;
the live windows and tabs carried into the account and back; passwords merged into the
account when sync turns on, with the question for accounts that already have some, and kept
on the device at sign-out; the sign-out sheet with its remove option. Done when signing in
and out keeps every tab open and every bookmark and password in place.

**Phase 4: entry points and polish (about 1 week).** Misty › Sign In… and Sign Out…, and
Window › New Space…, in the app menu and the command palette (`account.sign_in`,
`account.sign_out`, `workspace.new_space`); the agents shortcut opens the sheet signed out;
invite links open it; Sync settings' signed-out state; no telemetry while signed out; the
AGENTS.md lines below. System-wide hotkeys (companion, dictation) open the sign-in sheet
for agents while signed out, armed only when Input Monitoring is already granted
(`global_hotkey/signed_out.rs`), so browsing without an account never asks for it.
Settings' other signed-out states wait for the Settings rebuild (its registry lists no pages
today). The C16 row goes on the website once it ships.

## Build status

Written 2026-10-23, all phases, in the `claude/friendly-thompson-857543` worktree, not
committed. Checked so far:

- `tsc --noEmit` passes with no errors.
- `cargo check --all-targets` passes (the only warnings are older Objective-C ones).
- The frontend suite passes except three architecture-baseline tests about files this work
  doesn't touch (stale size baselines and `ChatSidebar.tsx`); they name only those files. Tests that asserted the old behaviour were updated: the app frame no longer redirects to
  sign-in, an expired session keeps the account and marks it expired, and the Space bar tests
  run signed in.
- The sync crate's tests all pass, plus a new one (`worker/local_tests.rs`) showing a local
  vault saves, deletes and reopens records with no server reachable.
- The app's Rust tests for the command policy, app menu, workspace recovery, sync and
  passwords pass, including new ones for the password merge rules (`passwords/device.rs`).
- New component tests cover the sign-in sheet (a title per reason, Not now, Create account
  in the same sheet), the sign-out sheet (keeps data unless removal is checked), the
  signed-out account row (Sign in, no Sync; Sign in again when expired), the first-run
  welcome (Start browsing passes it for good), setup carrying over to an account, and the
  windows on screen moving into the account at sign-in and back at sign-out.

Tried by hand on 2026-10-23 in the desktop app (a separate `c16` dev profile on a fresh data
folder, against the local development server):

- First run shows the small welcome with Start browsing and Sign in. Start browsing grows the
  window, runs setup, and the welcome never returns.
- Signed out, the window has no Space bar and no Space color, the account row reads Sign in,
  and there is no Sync button. The app menu has Sign In…, Sign Out… and New Space….
- Tabs survive a relaunch. A password saved signed out is offered again after a relaunch.
- The sign-in sheet names its reason: Sign in to Misty (account row), Sign in to create a
  Space (New Space…), Sign in to use agents (⌘⇧K). Create account opens in the same sheet,
  and Not now or Escape returns to the page.
- Creating an account kept all three open tabs without a reload, and the Space bar slid in.
  Signing out showed the sheet with removal off, kept the tabs and the saved password, and a
  relaunch afterwards opened signed out with the same tabs.

Fixed along the way: the welcome was skipped on first launch (the shell sent "/" to the
active tab first; the app frame now redirects before the shell mounts); the save-password
notice said "encrypted with your sync vault" (now "encrypted and kept in Misty"); the
profile menu said "Log out" (now "Sign out…", like the sheet); and the credential store fell
back to `~/.misty` when a custom data folder didn't exist yet, splitting keys from their data
(`src-tauri/src/lib.rs` now creates the folder first; this only affected dev profiles with a
custom data root).

## Decided

Answered 2026-10-23. Nothing blocks the build.

1. **Spaces need an account.** Signed-out people have the one personal Space and no others.
   Importing Arc's sidebar (C18) is dropped: Arc users get bookmarks, history, sign-ins and
   extensions through the normal Chromium import, and no Spaces, pinned tabs or folders.
2. **Signing out keeps the browsing data** on the device. Removing it is the opt-in checkbox
   in the sign-out sheet.
3. **Add account stays.** The local profile is adopted by the first account that signs in,
   and an added account starts with an empty profile. Signing out of the last account on the
   device returns the window to the local profile, carrying that account's personal Space
   data back with it (decision 2).
4. **Merging asks once,** with counts, when sync turns on for an account that already syncs
   from other devices (as mocked).
5. **No telemetry while signed out.** Nothing is sent to Misty until someone signs in.
6. **The Terms and Privacy footer stays** on the first-run welcome.
7. **No AI chrome while signed out.** Only the agent shortcuts reach the sign-in sheet.
8. **The local vault is a local mode of the existing sync crate** (`crates/browser-sync`), with
   no second store. Sync is not proprietary: the crate stays whole in the open-source app,
   and only the agent runtime and Spaces stay closed (C17). This replaces the earlier plan to
   split out a `misty-profile-store`.
9. **One website data store per device.** Every personal Space keeps using the `default`
   store, so the signed-out profile's website sign-ins carry through adoption. Two accounts
   on one device share website sign-ins, as today.
10. **Invite links use a generic title,** "Sign in to join a Space". The Space's name shows
    after sign-in, so the server needs no unauthenticated invite preview.
11. **No Space bar while signed out.** The page takes its height, and the bar slides in once
    someone signs in.
12. **The release waits for the local vault.** C16 is not released with phase 1 alone, so the
    first signed-out version saves passwords, search shortcuts and site permissions like a
    complete browser.
13. **First run keeps the small welcome window** (760×640), which grows into the full browser
    after Start browsing.

## AGENTS.md

Added with the build: one bullet saying browsing never needs an account, sign-in goes
through the shared sheet that names its reason, and a signed-out window shows no Space (no
Space bar, no Space color) with Sign in on the account row.

## Rules followed

These come from AGENTS.md: black, white and gray, with the Space color only once a Space
exists; checkmarks in menus; no loading text (the "Restoring account" and "Restoring
workspace" labels are screen-reader text only, under Misty's flight); plain-language
failures; settings stay on the device and never sync.
