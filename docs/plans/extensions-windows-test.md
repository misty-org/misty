# Windows extension test

Part of [extensions-sync-plan.md](extensions-sync-plan.md), Track 1 step 1. Record pass or fail and what you saw. Chrome Web Store extensions only.

## Run Misty

```powershell
npm run tauri -- dev
```

Open a new tab with ⌘T / Ctrl+T and go to the first store page below.

## Extensions to test

| Extension | Chrome Web Store ID | Why |
| --- | --- | --- |
| uBlock Origin Lite | `ddkjiahejlhfcafbddmgiahcphecmpfh` | The ad blocker offered in onboarding |
| Bitwarden | `nngceckbapebfimnlniiiahkandclblb` | Password manager; works without a desktop app |
| 1Password | search the store | Needs `nativeMessaging` for desktop unlock |
| Dark Reader | `eimadpbcbfnmbkopoojfekhnkhdbieeh` | Content scripts and page styling |

Store page: `https://chromewebstore.google.com/detail/<ID>`

## What was already checked without the app

On 2026-10-23 the four extensions below were loaded into a real WebView2 profile through Misty's own download, unpack, grant and staging steps (`cargo test --lib webview2_loads_real_store_extensions -- --ignored --nocapture`). Before a fix to staging, WebView2 refused all of them with "Access is denied"; now each loads under Misty's derived ID, enabled, and its popup page opens. That does not cover the install review, the Add to Misty button, or what each extension does on a page.

## What the live package check already showed

`cargo test -p misty-native --lib windows_limited_apis -- --ignored --nocapture` downloads each package and lists the APIs WebView2 does not offer extensions (2026-10-22):

| Extension | Asks for, of the limited APIs | Expect |
| --- | --- | --- |
| uBlock Origin Lite | none | Should work |
| Dark Reader | none | Should work |
| Bitwarden | `contextMenus`, `sidePanel`, `notifications` | Popup and autofill should work; right-click fill, side panel and notifications may not |
| 1Password | `nativeMessaging`, `contextMenus`, `downloads`, `notifications` | Desktop-app unlock is the likeliest failure |

## For each extension

| Step | Check | Result | Notes |
| --- | --- | --- | --- |
| 1 | The page shows **Add to Misty** in place of the store's own button, and no "Switch to Chrome" prompt | | |
| 2 | Clicking it opens the install review in Misty's window | | |
| 3 | The review lists permissions in plain language, with any "may not work on Windows" notes | | |
| 4 | Install completes; the button reads **Remove from Misty** | | |
| 5 | The extension appears in the toolbar's Extensions menu and in Settings › Browser › Extensions | | |
| 6 | Its popup or toolbar action opens | | |
| 7 | It does its job (below) | | |
| 8 | Restart Misty: it is still installed and still works | | |
| 9 | Turn it off, then on: it stops, then runs again | | |
| 10 | Remove it: the button returns to **Add to Misty** | | |

### Step 7, per extension

- **uBlock Origin Lite:** open a site with ads (a news site). Ads and trackers are reduced; the popup shows a blocked count.
- **Bitwarden:** log in. Open a login page; the fill menu or extension popup offers a saved login and fills it. Try the right-click menu.
- **1Password:** sign in from the extension. Note whether it asks for the desktop app, and whether biometric unlock works.
- **Dark Reader:** open any light page; toggling it darkens the page.

## Also check

- Agent access: Settings › Browser › Extensions has "Allow agents to use extensions" and a per-extension "Allow agents". Note the default for each installed extension.
- A private tab: the extension is off unless "Allow in private tabs" is on.

## Record

Paste results here or into the table above: which steps failed, any error text, and a screenshot of the install review for anything odd.
