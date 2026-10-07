# Browser import and export

Status: implemented (2026-10-06), all six phases. Branch `new-onboarding`. "As built" records where the implementation differs from the plan below.

## As built

- **Nesting without a migration.** A folder with no `parent_id` sits in Other bookmarks, so existing folders keep their records unchanged and devices on older versions see nested folders as flat ones. The roots have fixed IDs: `group:bookmarks-bar`, `group:bookmarks` (Other bookmarks, the former default folder) and `group:bookmarks-mobile`.
- **The sync gate reuses `control_version`.** This version advertises 2 (the server now accepts 1–2). `nested_bookmarks()` in `worker/collections.rs` requires every active device at 2; until then `write_records` drops `parent_id` and `added_at` instead of failing, and the app refuses to create a folder below anything but Other bookmarks (`canNestBookmarkFolders`). A device rename no longer bumps `control_version`, which used it as a counter by mistake. Folder writes are checked for cycles and depth.
- **Bookmarks bar** under the tab strip (`features/bookmarks/BookmarksBar.tsx`), with an overflow menu, folder submenus and Other bookmarks at the trailing edge. "Show bookmarks bar" is an account setting (`browser_bookmarks_bar`, on by default). Links open through `openFromChrome`, which asks the focused browser tab to navigate.
- **Native module** `src-tauri/src/infra/browser_import/`: `discover`, `chromium`, `firefox`, `safari`, `netscape`, `history`, `settings`, `cookies`, `chromium_key`, `cookie_writer`, `extensions`, `snapshot`. Commands: `browser_import_discover`, `_preview`, `_bookmarks`, `_bookmarks_file`, `_save_bookmarks`, `_history`, `_settings`, `_signins`. All `browser_import_*` commands are limited to the main window.
- **Bookmarks merge in the app** (`features/browser-import/bookmarks.ts`), each root into Misty's matching root, reusing same-named folders and skipping links already in a folder, so a repeated import changes nothing. Safari bookmarks come from `Bookmarks.plist`; its Reading List becomes a folder in Other bookmarks.
- **History** goes into `browser-library.sqlite` under the focused tab's profile, skipping visits already there; they sync like local visits.
- **Settings** map to search engine (when Misty offers it), homepage, reopening the last session, the bookmarks bar, and camera and microphone decisions (macOS; only sites still set to Ask change).
- **Sign-ins** write straight into the profile's WebKit data store on macOS (`dataStoreForIdentifier`, macOS 14+), and through an open browser tab of that profile on Windows. Chrome's `v20` values are counted as locked. Linux Chromium and Safari report why they can't import.
- **Extensions** are listed with a Find button that opens Misty's catalog searching for them (`/extensions?q=`).
- **Entry points:** the onboarding step after the welcome dialog (desktop only, skippable), Settings > Browser > Other browsers, and the Bookmarks page header.
- **Zen** (a Firefox fork) imports through the Firefox readers from its own profile folder: `~/Library/Application Support/zen`, `%APPDATA%\zen`, or `~/.zen` (and its Flatpak path) on Linux. No logo collection has its artwork, so it shows a monochrome globe.
- **Logos** are original artwork in the shared brand registry (gilbarbara/logos, and SVGL for Chromium); `AGENTS.md` extends the brand-logo exception to this flow.

New users bring their browser with them, the way VS Code imports another editor's setup: bookmarks, history, settings and the accounts they are already signed in to. Bookmarks also export to every major browser.

## Decisions

- **Sources:** the Chrome family (Chrome, Edge, Brave, Arc, Vivaldi, Opera share one profile format) and Firefox first; Safari later (it needs Full Disk Access).
- **File format:** the Netscape bookmarks HTML file, which every major browser imports and exports. It is the only file format: no browser imports history or settings from a file.
- **Bookmarks follow the Chrome and Firefox model:** a tree of folders with links and folders sharing one order inside each folder, under three roots: Bookmarks bar, Other bookmarks and Mobile bookmarks.
- **A visible bookmarks bar** sits under the tab strip and shows the Bookmarks bar root.
- **The Bookmarks page** lists a folder's subfolders as rows above its links, with a breadcrumb for the path. No tree sidebar.
- **Browser logos** appear in the import flow, through `BrandIcon` (needs new Chrome, Firefox, Edge, Brave, Arc, Vivaldi, Opera and Safari artwork; none exists yet). `AGENTS.md` needs the exception extended to this surface.
- Settings stay account settings on the server; there are no device-only imports.

## What is imported

| Data | Chrome family | Firefox | Lands in |
|---|---|---|---|
| Bookmarks | `Bookmarks` (JSON) | `places.sqlite` | Synced bookmark records |
| History | `History` (SQLite) | `places.sqlite` | `browser-library.sqlite`, then the synced `history` collection |
| Search engine | `Web Data` → `keywords`, `Preferences` | `search.json.mozlz4` | Account setting `browser_search_engine_index` when it matches a listed engine |
| Homepage and startup pages | `Preferences` | `prefs.js` | Account settings, where Misty has an equivalent |
| Site permissions | `Preferences` → `profile.content_settings.exceptions` | `permissions.sqlite` | `browser_site_permissions` |
| Signed-in accounts | `Cookies` (encrypted) | `cookies.sqlite` (plain) | The profile's cookie store via `browser_cookie_store` |
| Extensions | `Extensions/` IDs | `extensions.json` | A list matched against the extension catalog, each with Install |

Out of scope: saved passwords and payment methods (Misty has no password manager), open tabs and sessions.

Source files are only read, never written. SQLite files are copied to a temporary folder first, with their `-wal` files, because the browser locks them while it runs.

### Signed-in accounts

- **Firefox:** `cookies.sqlite` is unencrypted; read it directly.
- **Chrome family on macOS:** cookie values are AES-128-CBC encrypted with a key derived from the "Chrome Safe Storage" Keychain item (Edge, Brave and others use their own item names). Reading it shows the person one Keychain prompt per browser. This is a read of another app's item only; Misty's own credentials still never use the Keychain.
- **Chrome family on Windows:** Chrome 127+ uses app-bound encryption (`v20` cookies), which other apps cannot decrypt. Older `v10` values decrypt with DPAPI. On Windows, show sign-ins as unavailable for Chrome and say why; Firefox works.
- Cookies are written through the native cookie transport, which is unavailable to the renderer, one profile at a time, while holding the sync lease. Never write to Misty's own authentication webview.

## Bookmark model changes

Folder records gain a parent folder, and both kinds share sibling order:

- `Folder` gains `parent_id` (`None` only for the three roots). Validation rejects cycles and missing parents, and limits depth (64).
- The roots get fixed IDs. The existing default folder, `group:bookmarks` (shown as Unfiled), becomes **Other bookmarks**. Existing named folders move inside it.
- Removing a folder moves its links and subfolders to its parent.
- **Sync gate.** `Folder` uses `deny_unknown_fields`, so devices on older versions would reject a folder that has a parent. Follow the tab-group pattern in `crates/browser-sync/src/worker/collections.rs`: devices advertise that they understand nested folders, and nested folder records are written only when `all_upgraded()`. Until then, import says which device needs an update.
- Stored names stay frozen (`group`, `website`, `group_id`); the renderer boundary in `document/renderer.rs` adds the new field.

## Mapping between browsers

| Misty root | Chrome family | Firefox | Safari | HTML file |
|---|---|---|---|---|
| Bookmarks bar | `bookmark_bar` | Bookmarks Toolbar | Favorites | Folder with `PERSONAL_TOOLBAR_FOLDER="true"` |
| Other bookmarks | `other` | Other Bookmarks, plus Bookmarks Menu as a folder inside it | Bookmarks Menu | Everything else |
| Mobile bookmarks | `synced` | Mobile Bookmarks | — | — |

- Separators (Firefox, Safari) are dropped, as Chrome does.
- `ADD_DATE` and `LAST_MODIFIED` are kept. Saved favicons are skipped; Misty fetches site icons itself.
- Re-importing never duplicates: a link that already exists with the same URL in the same folder is skipped.
- Export writes the HTML file with the bar marked `PERSONAL_TOOLBAR_FOLDER`, so Chrome, Firefox and Safari put it back on their toolbar.

## Architecture

**Native** (`src-tauri/src/infra/browser_import/`)

- `discover.rs`: installed browsers and profiles per OS (Chrome `Local State`, Firefox `profiles.ini`).
- `chromium.rs`, `firefox.rs`, `netscape.rs` (read and write), `cookies.rs`.
- `model.rs`: one neutral bundle (bookmark tree, visits, settings, cookies, extension IDs) that every source produces.
- Commands: `browser_import_discover`, `browser_import_preview` (counts per data type), `browser_import_run` (progress events), `browser_bookmarks_export`.
- New dependency: `lz4_flex` for Firefox's `mozlz4` files. `rusqlite` is already present.

**App** (`src/features/browser-import/`)

- One `ImportFlow`, used by onboarding, Settings → Browser (an Import and export section) and the Bookmarks page header.
- Shows detected browsers with their logos and profiles, and a checkmark per data type with its count. A skeleton shows while it scans.

**Bookmarks bar** (`src/app/layouts/DesktopLayout/`): a row under `WorkspaceTabStrip`. Folders open menus; links open in the current view. Overflow goes into a trailing menu. A Browser setting shows or hides it.

**Onboarding:** an import step after `TourWelcomeModal`, before the tour, with Skip.

## Phases

1. **Bookmark tree:** the sync model with its gate and migration of existing folders, the Bookmarks page breadcrumb, and the bookmarks bar.
2. **Bookmarks import and export:** the Chrome family, Firefox and HTML files.
3. **Import flow and onboarding step**, with browser logos.
4. **History and settings:** search engine, homepage, site permissions.
5. **Signed-in accounts:** Firefox cookies, then Chrome family cookies on macOS.
6. **Extensions and Safari.**

## Tests

- Fixtures in `docs/fixtures/browser-import/`: a Chrome `Bookmarks` file, a small `places.sqlite`, and HTML exports from Chrome, Firefox and Safari.
- Round trips: Chrome → Misty → HTML → Chrome-shaped tree is unchanged, and the same for Firefox.
- Sync: nested folders are not written until every device is upgraded; cycles and missing parents are rejected.
