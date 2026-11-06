# Browsing without an account: design brief

Status: approved 2026-10-23, with its open questions answered the same day (see Decided).
All four phases are written in the `claude/friendly-thompson-857543` worktree, not yet built,
tested or committed (see Build status). Parity item C16 in
[docs/competitors.md](../competitors.md). Mockups:
[mockups/no-account.html](mockups/no-account.html) (seven states: first run, signed out, the sign-in sheet, Settings ›
Sync, merging on sync, signed in, signing out). It builds on [Sync](../sync/README.md), and it
sits beside C17 (open-sourcing the desktop app), which keeps the sync crate open. C18
(importing Arc's Spaces) was dropped on 2026-10-23.

## The idea

Misty opens straight into a full browser. Tabs, groups, favorites, bookmarks, history,
downloads, saved passwords, extensions, search shortcuts, site permissions, browser import and
incognito all work with no account, and nothing is sent to Misty. An account is asked for only
when someone turns on sync, creates or joins a Space, or uses an agent. When they sign in, the
browsing they already have stays where it is in this computer's first profile, with nothing
reloaded and no tab closed.

The people Misty wants from Zen, Helium and Brave reject browsers that need an account, and
Arc users leaving before 2026-12-22 want to try Misty before they commit to it. Browsing
without an account comes first for both.

## What the person sees

### First launch

The welcome screen (`WelcomePage`) shows once, on first launch, in the small fixed window it
uses today. **Start browsing** is the primary button and **Sign in** sits beside it. **Sign in**
goes to the sign-in page, which first shows **Choose a server** if this device has none (a device
starts with no server): Misty Pro or Self-hosted. A sign-in link isn't entered here; it opens the
app through `misty://setup`. A development build asks too, with its dev server's address filled
in under Self-hosted. The wizard only comes after signing in: a sheet with the
model step, this computer's import and extensions, then which side the tabs sit on. If this device
has already run it, signing in asks "Run setup again?" instead, with **Continue**. **Start
browsing** opens the browser straight away and, on first run only, asks which side the tabs sit on.
Backing out of sign-in on a later run shows the welcome again, and Start browsing then asks nothing.
Every later launch opens the browser directly, signed in or not. Help › Run setup again opens the same steps in the sheet.

### A signed-out window

The same window as today, minus what needs an account:

- **A Space bar that asks to sign in.** Everything in it needs an account: Home, Chat, Agents,
  Library, Memory and New. The bar still shows them, so people can see what is there, and pressing
  any of them goes to the welcome page. It has no Space menu or People, since there is no Space yet.
  Its auto-hide button still works.
- **No Space color.** A signed-out window shows no Space, so the window chrome keeps the plain
  workspace color.
- **The account row reads Sign in.** Below the sidebar card, "Sign in" goes to the welcome page;
  Settings stays beside it. The Sync button is not shown until there is an account.
- **No AI chrome.** No Agents button, no composer chips, no selection menu on pages. The
  cursor companion, dictation, capture and recall don't mount (they already
  mount only with an account).

### Where sign-in is asked

Everything goes to the welcome page, in the small signed-out window, with **Sign in** and **Create
account**; signing in returns to the page that asked. The sign-in pages have no back button: the
logo in the bar goes to the welcome page, and someone adding an account gets back from there. An expired
session skips straight to the sign-in page with its email filled in. Popups don't explain what an
account is for: people can explore. There is no forgot-password form: a sign-in link comes from whoever runs the server, so
the form says to ask the server's owner for a sign-in link or get one at
`https://mistysys.com/sign-in`.

Google sign-in doesn't run in a webview of ours: Google's policy rules out embedded webviews, WKWebView
by name, so a small window of our own was declined on November 3, 2026. It opens in the person's
default browser, and the page there hands the code back through a `misty://` link or for typing.
While Misty is the default browser that would land in one of its own tabs, so on macOS it uses the
system's web authentication session instead (`src-tauri/src/infra/google_sign_in_sheet.rs`), which
catches the link and closes. macOS asks permission first and opens another browser's window, Safari
unless that browser supports these sessions, and Misty can't size or place it.

| What the person did | Where |
| --- | --- |
| Pressed Sign in | Account row, a new Misty › Sign In… menu item |
| Turned on sync | Settings › Sync, Settings › Devices |
| Pressed a control in the Space bar, or asked for a new Space | The Space bar, a new Spaces › New Space… menu item (beside Open Space…), the account row's menu |
| Opened a Space invite link | `misty://invite/…` or the web invite page |
| Used an agent shortcut | Companion and dictation hotkeys |

Nothing asks on its own: no timed prompts, no banners, no badge on the account row.

### What works without an account

| Works signed out | Needs an account |
| --- | --- |
| Tabs, tab groups, favorites, pinned tabs, focus mode | Sync and the signed-in sessions list |
| Bookmarks, history, downloads | Spaces, members, invites |
| Saved passwords and autofill | Space Home, Chat, People, Memory and the memory tree |
| Extensions from the Chrome and Firefox stores | Agents, the companion, dictation, capture, recall |
| Search engines and `!bangs`, site permissions | Cloud clipboard, connected devices |
| Browser import (bookmarks, history, settings, sign-ins, extensions) | Journal and Library items kept on your Misty server |
| Incognito windows, night light, every device setting | |
| App updates | |

### Signing in

Signing in changes nothing about the browsing on this computer: it stays in the first profile, on
the store it already uses, so no site signs out. The window stays open, the Space bar goes live and
the account row shows the person with Sync beside Settings.

### Turning on sync

Once, right after the first sign-in, one screen offers to create the vault, with **Not now**. Skipping
keeps everything on this computer and Misty never asks again; Settings › Sync can start it later.
Another signed-in session asks for the vault password once, which is the only way in.

Joining merges silently into the vault's first profile, with nothing to confirm: everything local
uploads, and records merge by newest edit ([Sync](../sync/README.md#how-it-works)). Local data stays
on the computer whatever happens to the vault.

### Signing out

Signing out no longer ends at the welcome screen. Sync, Spaces and agents stop on this computer and
the vault key is forgotten; the window keeps browsing with its tabs, bookmarks, passwords, history
and extensions, which stay readable by anyone using this computer. Signing back in asks for the vault
password once. The sheet has one checkbox, off by default: "Also remove my browsing data from this
Mac", which erases them and the website sign-ins here (a synced copy stays in the vault).

### When the session expires

A session the server rejects no longer signs the person out to the welcome screen. Browsing
carries on; sync pauses and agents stop. The account's name and picture leave the account row and
the Space bar, which look signed out, and a notice says to sign in. Nothing on the computer is
removed, and signing in brings the account back.

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

### The local scope

Everything Misty keeps per account today is keyed by `(deployment, account id)`. Signed out,
those same paths take a fixed local identity, `deployment = "local"` and `account = "local"`,
so the existing code paths run unchanged:

- **Workspace recovery** (tabs, groups, bookmarks, saved layouts) opens its encrypted store
  under the local identity. `browser_recovery_open` stops requiring a signed-in API client for
  it; only a real account checks the session.
- **Extensions** install under `extensions/local/personal/packages`.
- **First-run setup** is about the device: it runs once, inside the welcome's sheet, signed in or not (`useSetupStore` keeps only `welcomed`).
- **History and downloads** are already account-free in `misty.db`.
- **Website data**: the first profile adopts the store already in use (`~/.misty/profiles.json`),
  so sites stay signed in across signing in and out.
- **The window's Space** has no Space id until Spaces load (`spaceWindow.ts`); signed out it simply
  never gets a Space record.

### Local records

Saved passwords, bookmarks, site permissions, search engines and bangs, the downloads list and the
extensions list are records in each computer's encrypted local store (`LocalStore`,
`crates/browser-sync/src/local.rs`), which works with no vault and no account. Its key is kept in
Misty's credential store (the keychain-held master key). Turning on sync later copies those same
records, so there is no second store and nothing to migrate.

### Adoption

Signing in from the local scope carries this computer's browsing into the account, and signing out
hands it back. Nothing reloads either way.

1. **The app stays mounted.** `RootLayout` keys its page tree on `outletKey`, which changes
   only when switching between two accounts, not when signing in from the local scope or
   signing out to it.
2. **Windows and tabs**: the ones on screen become the account's workspace
   (`adoptAccountWorkspace`, which opens the account's recovery store and saves the live
   windows into it). A record the account already had on this computer is archived first, never
   lost. The local scope's copy is then removed. Signing out does the reverse.
3. **Saved passwords** are records like any other. They stay on this computer until sync turns on,
   then merge silently with the rest.
4. **Extensions belong to the computer,** as their install list (a device setting) does, so
   signing in or out leaves them installed and running with nothing to move.
5. **Setup** done while signed out counts for whoever signs in: it is about the computer.

Removing browsing data on sign-out erases this profile's history, downloads, website sign-ins and
cached files, and the local scope's saved windows; a synced copy stays in the vault.

## Inventory of code that assumes an account

| Area | Where | What it assumes today | Change |
| --- | --- | --- | --- |
| Startup route | `src/app/routing/RouteConfig.tsx` (`StartupRedirect`) | No user means `/welcome` | Welcome only on first run; otherwise the last route |
| App frame | `src/app/layouts/AppFrameLayout.tsx` | No user means `/signin`; recovery gate waits for `recovery.accountId === user.id` | No redirect; recovery gate uses the profile id |
| Root remount | `src/app/layouts/RootLayout.tsx` (`<Outlet key={user?.id ?? "anonymous"} />`) | A new identity remounts the app | Keep mounted across adoption |
| Small sign-in window | `DesktopLayout/useSignedOutWindow.ts` | Auth routes shrink and lock the window and hide the others | First-run welcome only; sign-in becomes a sheet |
| Shell | `DesktopLayout/index.tsx` | `isAuthRoute` branch; Sync badge and account row take `user?.id` | Account row shows Sign in; Sync hidden signed out |
| Account row and menu | `DesktopLayout/AccountIsland.tsx`, `ProfileMenu.tsx` | A signed-in person with a menu | Signed-out variant opens the sheet |
| Space bar | `DesktopLayout/SpaceBar.tsx`, `src/features/spaces/components/spaceRow/` | A Space from the server list (`useWindowSpace`) | Its controls open the sheet without an account |
| Window color | `src/features/workspace/windowColors.ts`, `spaceWindow.ts` | The Space record's color | None signed out |
| First-run setup | `src/features/auth/signInSheet/SignInSheet.tsx`, `src/features/setup/SetupSteps.tsx` | A dialog over the browser after the welcome | The last part of the welcome's sheet; never over the browser |
| Welcome | `src/features/welcome/WelcomePage.tsx` | Sign in and Create account only | Start browsing first; first run only |
| Sign in and register | `src/features/auth/SignInPage.tsx`, `RegisterPage.tsx`, `components/` | Full-window routes | Content reused in the sheet |
| Sign-out | `src/features/auth/provider/useDeactivateToChooser.ts`, `useLogout.ts` | Saves or removes the account workspace, navigates to `/welcome` | Reverse adoption, keep browsing |
| Session expiry | `src/features/auth/provider/useAccountSideEffects.ts` (`useInvalidSessionHandling`), `src/api/client/session` | A dead session signs out to `/welcome` | Notice and Sign in again; keep browsing |
| Workspace restore | `useNativeWorkspaceRecovery`, `src/features/workspace/nativeWorkspaceRecovery.ts`, `workspaceAccountState.ts` | Restores per account id | Restores per profile id |
| Recovery store | `src-tauri/src/infra/workspace_recovery.rs` (`browser_recovery_open`) | Calls `account_api`, which needs a signed-in cookie client; folder hashed from deployment and account | Local identity skips the account check |
| Records | `src-tauri/src/infra/profile_data/` (`LocalStore`) | Nothing: records work with no vault and no account | None |
| Extensions | `src-tauri/src/infra/extensions/spaces.rs`, `src/features/extensions/useExtensionsRuntime.ts` | Packages under `extensions/<account>`; runtime keyed by `user?.id ?? ""` | Keyed by the device (`local`), signed in or not |
| Browser import | `src/features/browser-import/runImport.ts`, `src-tauri/src/infra/browser_import/mod.rs` | Sign-ins go to the vault | Sign-ins go to the profile's records |
| Updates | `src/features/updater/UpdateNotices.tsx` | Returns early with no account id, so no update notices | Show them signed out |
| Tab archive | `src/features/workspace/tabArchive.ts`, `browser/internal/ArchivedTabsList.tsx`, `webviews/useBrowserRuntimeServices.ts` | Archiving and the list need an account id | Use the profile id |
| Settings pages | `settings/sections/PasswordsSettings.tsx`, `devices/AddThisDevice.tsx`, `MistySection.tsx` | Read `useSyncController(user?.id)` or `user.id` | Local vault for passwords; sign-in rows elsewhere |
| Deep links | `src/app/routing/navigation.ts`, `SpaceInvitationRedemption` | Invite route works signed out, then asks to sign in in the small window | Invite opens the sheet over the window |
| Account-only features | `src/features/agents`, `misty`, `journal`, `ai-surface`, `voice`, `recall`, `library`, `connected-devices`, `infra/cloud_clipboard` | An account | Unchanged: hidden signed out, or the sheet when invoked |

No license check blocks browsing: `allows_use` on the native session is read but gates nothing.

## Build plan

About four and a half weeks, so it ships by early December, before Arc stops working. Phases
build in order but release together: nothing ships until phase 2's local records work
(decision 12).

**Phase 1: browse signed out (about 1 week).** Remove the startup and frame redirects; local
identity for workspace recovery (native check skipped for
`local`); first-run welcome with Start browsing, and no small window afterwards; no Space bar
or Space color without an account; Sign in on the account row; the sign-in sheet replacing the
`/signin` and `/register` routes inside the shell; first-run setup for `guest`; update notices
and tab archiving without an account; session expiry keeps browsing. Done when a fresh install
browses, quits and reopens with its tabs, and makes no request to Misty's API while signed out.

**Phase 2: local records (about 1 week).** Saved passwords (saving, autofill and the Passwords
list) and the rest of a profile's records work with no vault. Done when a password saved signed
out autofills after a relaunch.

**Phase 3: adoption (about 1 week).** Keep `RootLayout` mounted across sign-in and sign-out;
the live windows and tabs carried into the account and back; the sign-out sheet with its remove option. Done when signing in
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
- The app's Rust tests for the command policy, app menu, workspace recovery, sync and
  passwords pass.
- New component tests cover the sign-in sheet (a title per reason, Not now, Create account
  in the same sheet), the sign-out sheet (keeps data unless removal is checked), the
  signed-out account row (Sign in, no Sync; the same row and a notice when expired), the first-run
  welcome (Start browsing passes it for good), setup carrying over to an account, and the
  windows on screen moving into the account at sign-in and back at sign-out.

Tried by hand on 2026-10-23 in the desktop app (a separate `c16` dev profile on a fresh data
folder, against the local development server):

- First run shows the small welcome with Start browsing and Sign in. Start browsing runs setup
  in the sheet over the welcome, then grows the window into the browser, and the welcome never
  returns.
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
notice said "encrypted with your sync vault" (it now shows only its title, the account and site, and its buttons); the
profile menu said "Log out" (now "Sign out…", like the sheet); and the credential store fell
back to `~/.misty` when a custom data folder didn't exist yet, splitting keys from their data
(`src-tauri/src/lib.rs` now creates the folder first; this only affected dev profiles with a
custom data root).

## Decided

Answered 2026-10-23. Nothing blocks the build.

1. **Spaces need an account.** Signed-out people have none.
   Importing Arc's sidebar (C18) is dropped: Arc users get bookmarks, history, sign-ins and
   extensions through the normal Chromium import, and no Spaces, pinned tabs or folders.
2. **Signing out keeps the browsing data** on the device. Removing it is the opt-in checkbox
   in the sign-out sheet.
3. **Add account stays.** The local scope is adopted by the first account that signs in, and an
   added account starts empty. Signing out of the last account on the computer returns the
   window to the local scope, carrying that account's browsing back with it (decision 2).
4. **Joining merges silently** into the vault's first profile, with no sheet and no counts
   (updated by [Sync](../sync/README.md); the sheet in the mockup is gone).
5. **No telemetry while signed out.** Nothing is sent to Misty until someone signs in. Since
   October 31, 2026 the app sends no analytics or crash reports at all: PostHog was removed.
6. **The Terms and Privacy footer stays** on the first-run welcome.
7. **No AI chrome while signed out.** Only the agent shortcuts reach the sign-in sheet.
8. **Local records live in the sync crate** (`crates/browser-sync`), with no second store. This
   replaces the earlier plan to split out a `misty-profile-store`.
9. **The first profile adopts the store in use,** so the signed-out browsing's website sign-ins
   carry through adoption. Two accounts on one computer share website sign-ins, as today.
10. **Invite links use a generic title,** "Sign in to join a Space". The Space's name shows
    after sign-in, so the server needs no unauthenticated invite preview.
11. **No Space bar while signed out.** The page takes its height, and the bar slides in once
    someone signs in.
12. **The release waits for local records.** C16 is not released with phase 1 alone, so the
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
