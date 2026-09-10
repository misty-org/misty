# Extensions

Mode: Operate. Misty has no Extensions page or catalog. People find extensions the
way they would in Chrome or Firefox: on the Chrome Web Store
(`chromewebstore.google.com`) and Firefox Add-ons (`addons.mozilla.org`), opened in
an ordinary browser tab. Old `/extensions` routes and `misty://extensions` open
Settings › Browser › Extensions, and saved Extensions tabs reopen as the Chrome Web
Store.

## Adding an extension

On an extension's store page, Misty's page script (`browser_extension_store.js`)
shows a monochrome "Add to Misty" button in a closed shadow root. It reacts only to
trusted clicks and sends a tokened host message that names no extension. Misty reads
the extension from the tab's real address (`browser_extension_store.rs`), downloads
it from the store itself and opens the install review in Misty's own window
(`ExtensionInstallRequest`). The most a page can do is ask Misty to review the
extension it shows. The button sits in place of the store's own install button,
and Misty hides the stores' "Switch to Chrome" and "get Firefox" prompts and popups.

When the extension is already added, the button reads "Remove from Misty". The page
asks Misty for that one extension's state; removing opens Misty's own confirmation.

Packages are checked before anything unpacks:

- Firefox Add-ons: the add-on's API entry names the file and its SHA-256, and the
  download must come from Mozilla's hosts.
- Chrome Web Store: Google's update service names the CRX, its version and its
  SHA-256. `crx.rs` then verifies the CRX3 header the way Chromium does: every proof
  must verify, one must be the developer key the extension ID derives from, and one
  must be the Chrome Web Store's publisher key. A package the store did not sign, or
  one signed for another ID, never installs.

Installation is a permission review, with private access selected by default. While
Misty downloads and checks the package, the dialog shows a skeleton of the review.
A store that takes an extension down (Google's `error-unknownApplication`, a 404 or
`is_disabled` from Mozilla) stops it running at the next update check, with a plain
explanation in Settings.

## Managing extensions

Two places, nothing else:

- The browser toolbar's Extensions menu lists installed extensions. Each row runs the
  extension's action and has its on/off switch. The menu also opens either store and
  "Manage extensions".
- Settings › Browser › Extensions has rows that open each store, the account-wide
  agent access switch, and one plain section per extension: Enabled, Review access
  (only when a version asks for more), Allow in private tabs, Allow agents, its own
  settings, each granted access with Remove access, its store page and Remove.

Account intent and actual local runtime state are distinct. The Enabled switch is the
account's intent; its helper line says what this device is doing. A failed or
unsupported runtime is never represented as running. Extension artwork keeps its
official colors. All preferences use the server-backed account settings system.

Installed extensions sync as `extensions.installations`. Firefox IDs are stored as
numbers so older versions of Misty keep reading them; Chrome Web Store IDs are 32
letters a–p and are their own identity (`guid == id`). A Firefox identity never looks
like a Chrome ID, so approvals and extension origins cannot collide.

## Runtime

The runtime is the system `WKWebExtension`, which provides most WebExtension APIs
itself (runtime, storage, tabs, windows, scripting, action, alarms, commands, menus,
cookies, webNavigation, declarativeNetRequest, permissions, i18n). Misty adds a
compatibility layer (`kiri/src/extensions/compat/`, part of Kiri) for the commonly
used Firefox and Chrome APIs WebKit lacks. Its scripts load before an extension's
own and define only missing APIs:

- Backed by Misty: notifications, downloads, history, topSites, search, sessions,
  browsingData, find, idle, tts, bookmarks (Misty's bookmarks; Favorites and Apps
  stay private) and tab groups (`tabs.group`, `tabGroups`, current window).
- `chrome.js`: side panels open in a tab; offscreen documents run as a frame in the
  extension's hidden host page; contentSettings and fontSettings read as Misty's
  and are not changed by extensions; power requests are accepted and ignored.
- `declarative.js`: Chrome page rules, checked against tab addresses in the
  background and kept across restarts in the extension's own IndexedDB.
- `userscripts.js`: Chrome and Firefox user scripts. The native host stores each
  script's code as a file in the extension's package (`__misty_user_scripts__/`,
  bounded in size and count) and it registers as a content script, so host
  permissions apply. Registrations are restored when the background starts.
- `capture.js`: tab and screen capture through WebKit's screen sharing, so macOS
  asks what to share each time; Chrome-style `chromeMediaSource` constraints work.
- `shims.js`: self-describing and Firefox-only additions, and honest "not
  available" answers that keep startup code running. It also smooths over where
  WebKit differs from both browsers: menu filters with non-web patterns, a missing
  `requestIdleCallback`, `webNavigation.onCreatedNavigationTarget` and
  `webRequest.handlerBehaviorChanged`.
- `detached.js` (last): binds every API function to its namespace. Chrome and
  Firefox let extensions call `const t = chrome.i18n.getMessage` or
  `vAPI.getURL = browser.runtime.getURL` detached; WebKit returns nothing.

Popup windows an extension opens for its own pages (`windows.create` with type
`popup`, as 2048 does) open as small native windows, as in Firefox and Chrome,
not as Misty windows (`MistyExtensionPopupWindows.m`). Their window and tab are
real to the extension. Uncaught errors in an extension's background are reported
to Misty's log.

An extension's new-tab page (`chrome_url_overrides.newtab`) opens in new tabs
while it runs; the most recently added one wins, private tabs keep the homepage, and
the address bar stays empty there. Replacement bookmarks and history pages are not
used.

Packages installed under an older layer get the current scripts the next time they
load. Calls that need Misty's data go through the hidden host page; the native host
checks the account's granted permission per namespace, and `compat/` in this folder
answers them. Install review blocks only `debugger` and `proxy`; partially covered
permissions are listed as findings, never presented as fully working.

WebKit gives extensions no way to block or rewrite requests one at a time:
blocking `webRequest`, `filterResponseData` and `proxy` cannot be built on it.
Extensions built on them, such as the full uBlock Origin, may not start and cannot do their
main job; their declarativeNetRequest counterparts (uBlock Origin Lite) work.
