# Sync

Sync is something a person thinks about once, when they create the vault. After that, Misty feels like
one workspace everywhere they're signed in. Settings › Sync is the only place it shows, apart from four
notices that need the person.

## The model

```
Account (Misty login)
├─ Vault: one per account, one password, known only to clients
│  ├─ Profile: School
│  ├─ Profile: Work           tabs, tab groups, cookies, localStorage, history, bookmarks,
│  └─ Profile: Business       passwords, extensions, site permissions, search, downloads list
├─ Signed-in sessions: each Misty install signed in to the account
└─ Spaces: the same set in every profile, pulled from the server
```

- **Vault.** The encrypted container: one per account, one local database, one connection.
- **Profile.** One browsing identity with its own native browser store. Any signed-in session can open any
  profile. The first is called `personal` on every computer and can't be deleted.
- **Signed-in session.** One Misty install signed in to the account. Interface text and docs say this, or
  "computer" when they mean a place; only older tables such as `trusted_devices` keep the old word.
- **Window.** A local OS window showing one profile. Sync never tracks windows.
- **Space.** Shared content. It owns no tabs or sign-ins and is never in the vault
  ([spaces](../spaces/README.md)).

## What syncs

Everything in a profile syncs in the background to every session with the vault open, whether or not that
profile is open there.

| Data | Behavior |
|---|---|
| Tabs, splits, tab groups, pinned tabs | Same everywhere. The newest tabs from elsewhere load ahead of being opened |
| Bookmarks, history, downloads list | Same everywhere. Downloaded files stay where they were downloaded |
| Saved passwords | Same everywhere, within the profile |
| Cookies | Merged per cookie, newest wins. Signing out of a site signs out everywhere |
| localStorage | Whole origin, newest wins, up to 8 MiB per site |
| Back/forward list, scroll, form state | Per tab. Sensitive fields stay excluded |
| Extensions, their settings, permissions, search engines | Same everywhere, within the profile. Each computer fetches packages from the store |
| Profile list: name, color, order | Same everywhere |
| Shared clipboard | A small ring of sealed clips with a 24-hour expiry ([clipboard](clipboard.md)) |

Never synced: incognito, agents' own tabs, which tab has focus, window layout, session settings.

### Closing things

- **Closing a tab** closes it everywhere, including a profile's last tab. It can be reopened for 90 days.
- **Closing a window** says nothing to sync. Its tabs stay in the profile and move, asleep, into that
  profile's next open window on that computer. Closing the last window, or quitting, only closes it there;
  the tabs are back next time.
- Nothing on one computer ever closes a window on another.
- Native code owns which window holds a tab (`infra/profile_data/tabs.rs`). A tab that left a window counts
  as closed only if no other window claims it within 2 seconds, so dragging one across isn't a close. During
  those 2 seconds nothing hands it back to a window as if new, or a closing tab would reappear and be saved again.
- A tab from elsewhere is loaded ahead of being opened, so going to it is instant (`workspace/tabPreload.ts`). It waits
  8 seconds first, because a tab travels ahead of its site's cookies, and loads again once if its sign-in lands within
  the next minute. At most 5 wait unopened, the newest first; the rest load when clicked, and after a restart they all
  do. Until it's opened a preloaded page adds no history and sends nothing, or a redirect to a sign-in page would move
  the tab on the computer it came from. Tabs opened on this computer load in the background as before.
- A page that came from another computer, or moved because of one, plays nothing while nobody is looking at it: its
  window isn't focused or it isn't the tab showing. Starting media is refused the way a browser refuses autoplay, and
  sites show their play button. Looking at the tab lifts the hold; nothing starts by itself (`webviews/mediaHold.ts`,
  `browser/scripts/media_hold.js`). Web Audio that starts without being resumed isn't caught on Windows.

### What won't carry over

- **IndexedDB, none of it.** Web apps that keep work there start empty elsewhere. Sites using Firebase Auth
  keep their sign-in there, so they ask once per session.
- **Cache API, service workers and OPFS.** Sites rebuild them when visited.
- **Passkeys,** which are tied to the OS or hardware.
- **Partitioned cookies.**

Some sites may ask for a sign-in again anyway: those that bind a session to a machine, IP or browser, and
those with rotating refresh tokens if two sessions use the site at once.

## Vault password and keys

- **Separate from the Misty password,** with the same strength rules (`password.rs`). The server never
  receives it in any form.
- **Derivation.** Argon2id on the client (`argon2id-m131072-t3-p1.vault-v1`, recorded in the envelope), with a
  random salt stored with the sealed key.
- **Sealing.** The vault root is 32 random bytes, sealed by the derived key. The server stores only the sealed
  copy and the root's public key. A wrong password simply fails to open it.
- **Creation.** One screen after first sign-in, with **Not now**. Skipping keeps everything local and Misty
  never asks again; Settings can start it later.
- **New session.** Sign in and enter the vault password, once. It's the only way in. The root then stays in the
  OS keychain's protection, with no checkbox. A failed keychain read is not a missing key: it retries.
- **Change password.** From any open session. It reseals the root and signs the change, so a hostile server
  can't swap the sealed key. Other sessions keep working.
- **Forgotten password.** No recovery. An open session can set a new one; otherwise destroy the vault and create
  another, and every computer uploads what it has.
- **Signing out** forgets the key on that computer and keeps local browsing data, which stays readable by anyone
  using that computer. Signing back in asks for the password once.
- **Destroying** deletes the server's data and stops sync everywhere; each session keeps its local data. It needs
  the vault password, or the account password, or a Google sign-in within the last 10 minutes.

## How it works

Local data comes first. Each account has one encrypted record store on each computer (`LocalStore`, in
`crates/browser-sync/src/local.rs`), which works with no vault and no account. The vault link
(`crates/browser-sync/src/vault/`) only copies records to and from the server, so pausing, losing the connection
or destroying the vault leaves everything on the computer as it is. Native data such as history, cookies and
extensions is copied into and out of records by `infra/vault/` and `infra/profile_data/`.

The server stores opaque records: `scope` (HMAC of profile and collection), `record_key`, `version`, and the sealed
body. One cursor per vault, compare-and-swap on version, newest edit (`edited_at`) wins, 256 KiB per record, 1 MiB
per page. Deletes are sealed records kept for 90 days. An edit carries a hybrid clock, so clock skew can't win
forever, and an idle session loses a tie to an active one.

### Never stuck

| What happens | Response | Visible? |
|---|---|---|
| Offline, server down, timeout, 5xx | Retry forever with backoff | No |
| One record is invalid or can't be opened | Set it aside and carry on | Settings lists it |
| Record kind or frame from a newer version | Keep it untouched, or ignore the frame | No |
| Site over the localStorage cap | Sync the rest | Settings names the site |
| Password changed elsewhere, key no longer opens | Stop and keep local data | One notice |
| This session was removed | Stop and keep local data | One notice |
| Storage full | Hold uploads, keep downloading | One notice |
| Vault destroyed elsewhere | Stop and keep local data | One notice |

### Cookies and localStorage

- `infra/vault/site_data/`. Cookies upload as one sealed record per site, compared against what this session last
  saw. Passes run after navigations, every 15 seconds while active, every 60 seconds when idle, and on hide and
  quit. Applied cookies update the baseline, so they're never echoed back. Applying never closes a page.
- Windows reads and writes through `Network.*`, which answers for the view's own store, and falls back to `Storage.*`.
- Settings › Sync shows each profile's cookie and site counts from the last check on this computer, or that a check
  couldn't finish. Those counts and "Couldn't sync" describe only the computer you're looking at.
- The computer in use wins. Sites like Google keep refreshing tokens in background tabs, so a refresh made on an idle
  computer doesn't replace a copy made in use within the last hour, or sites end up half signed in. Past that hour it
  sticks. Idle means no Misty window focused for 5 minutes, or no keyboard or mouse input on the computer for 5
  minutes. Watching a video without touching anything counts as idle, so two idle computers can still trade tokens.
- What a store has been brought up to is kept per cookie, not per site. A cookie that arrived while a computer was
  closed always lands there, even if its edit is older than the site's newest, and is never read as a sign-out.
- WebKit reads a store as empty until its file has loaded, for a few seconds after launch. What the first non-empty
  read finds was there all along, not a change made now, so it never beats a copy from elsewhere. The Mac also never
  believes an empty read in that time.
- Foundation reports `SameSite=None` as unspecified, and WebKit enforces unspecified as `None`. So a secure cookie
  read as unspecified on Mac is recorded as `None`, or Windows would treat it as `Lax` and break cross-site logins.
- localStorage is read from an isolated script world so a site can't observe it, after load, every 30 seconds, on
  hide and on quit, and skipped when unchanged. A force-quit can lose the last 30 seconds of a site's edits here.
- New localStorage from elsewhere never lands under an open page. It waits until the site's last other tab closes,
  or until its only tab reloads or navigates from the toolbar, which waits for it first. A link clicked inside the
  page can't wait, so that site gets it at the next load.
- Mac writes through a hidden document given its HTML directly. The startup script that writes the document on
  Windows must never run on Mac: rewriting a document mid-parse leaves it loading forever.

### Store identity

Each computer keeps a local mapping of profile to native store (`~/.misty/profiles.json`), never derived from the
vault. The first profile adopts the store already in use, so nobody gets signed out by turning on sync. New profiles
get a new store. Destroying and recreating the vault changes nothing about which store is used.

## Profiles and windows

As in Chrome: each profile opens in its own OS windows, one app process. Switching profile opens or focuses that
profile's window and tabs never swap under you. A session opening a profile for the first time shows its tabs in one
window; new tabs from elsewhere join the most recently used window of that profile; nothing opens a new OS window on
its own. Window color comes from the profile. Deleting a profile removes it everywhere after a confirmation, including
each session's browser store. Offline sessions do this when they reconnect.

With two or more profiles, the sidebar's footer shows a round button for each, between Downloads and the pane layout
(`features/profiles/ProfileSwitcher.tsx`). A letter names it and the full name shows on hover. Clicking opens or focuses
that profile's window, and right-clicking edits that profile. Past five, the rest sit behind a `⋯` button, and this
window's profile always stays visible. With one profile, and in incognito, the row is hidden. Adding a profile stays in
the account menu and Window › Add Profile. The buttons are black, white and gray: only window chrome takes the color.

## Settings › Sync

Status (Up to date, Syncing with what's left, Paused, or Off), Start and Pause for this session only, storage used by
profile and by kind (the server reports sizes under opaque names and the client names them), data transferred over 30
days, what couldn't sync, signed-in sessions (name, last seen, rename, remove), change password, destroy vault.

## Security and privacy

**The server can see:** the account, that a vault exists, session names and platforms, connection times, IP addresses,
opaque scope and record IDs, how many records there are, padded record sizes and storage totals.

**The server can't see:** the vault password or key, profile names, tabs, URLs, history, bookmarks, saved passwords,
cookies or localStorage.

| Threat | Answer |
|---|---|
| Server reads vault data | Sealed on the client; the server has no key |
| Server moves a record, or changes its ID or version | Associated data binds all three, so it fails to open |
| Server serves old data | Sessions remember the highest version seen and refuse lower ones |
| Server forges a delete | Deletes are sealed |
| Server swaps the sealed key | Changes are signed by the root and checked against the pinned public key |
| Stolen login session | Can't open the vault, and can't destroy it without further proof |
| Stolen computer | Remove its session and the server refuses it. Its local copy can't be recalled, and it still holds the key; for full lockout, destroy and recreate the vault |
| Script in the app's web layer | Keys stay in native code, and the password is cleared after use |
| Site tries to observe capture | Isolated script world |

What the vault protects is browsing. Spaces, chats and agent conversations live on the server without vault
encryption ([agents](../agents/README.md)).

## Where the code lives

| Piece | Path |
|---|---|
| Records, keys, exchange, link | `src-tauri/crates/browser-sync/src/{local.rs,vault/}` |
| Link lifecycle, commands, history, usage, site data | `src-tauri/src/infra/vault/` |
| Local records and tabs | `src-tauri/src/infra/profile_data/` |
| Profiles and windows | `src-tauri/src/infra/profile_windows/` |
| Server | `misty-server/internal/browsersync/`, routes in `internal/app/server_mount_public_routes.go` |
| Interface | `src/features/vault/`, `src/features/settings/sections/SyncSection.tsx`, `src/features/workspace/profileTabs.ts` |

The live test `crates/browser-sync/tests/vault_live.rs`, driven by `misty-server/test/contract/http/api/sync_vaults_rust_test.go`,
runs real Rust sessions against the real server.
