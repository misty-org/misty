# Windows parity ledger

What macOS can do that Windows couldn't, and how each gap was closed. Audited 2026-10-12 on `main`
at `1b667b60`; brought to parity on 2026-10-13.

Every row is now done (✓), decided not needed (—), or a recorded Windows limit (◐, with the reason
in [Known Windows limits](#known-windows-limits)). Rows keep their original IDs so earlier
references still resolve.

Legend: ✓ done · ◐ done with a stated Windows limit · — not needed on Windows.

## Where it stands

| Area | ✓ | ◐ | — | Rows |
| --- | --- | --- | --- | --- |
| Phase 0 | 9 | 1 | 0 | 10 |
| Foundations | 6 | 0 | 0 | 6 |
| Shell, system and release | 15 | 1 | 5 | 21 |
| Browser and Kiri | 27 | 2 | 1 | 30 |
| Extensions | 14 | 9 | 0 | 23 |
| Agents and desktop control | 19 | 1 | 2 | 22 |
| Files and the document worker | 2 | 0 | 0 | 2 |

Verified on Windows 11 (x64):

- **Native tests:** 371 pass in `cargo test --lib`, plus the `windows-confine`, `agent-code` and
  `agent-files` crate suites. Clippy is clean for every file this work touched.
- **Type-checks for other targets:** the desktop crate and the release CLI type-check for
  `aarch64-apple-darwin`, and the desktop crate for `aarch64-pc-windows-msvc`.
- **Frontend:** typecheck, lint and every test pass. The `SpaceWorkspaceRail` test was checking
  usage meters it never supplied; it now checks the usage dialog opens.
- **Server:** builds, vets and passes every package that runs without Postgres. Docker wasn't
  running, so the Postgres-backed tests didn't run.

Real-system probes that run here:

- WebView2 loads an MV3 extension under Misty's ID. Updates keep its storage. Disable and remove
  work, and WebView2's own extensions are left alone.
- FFmpeg converts inside an AppContainer and can't read the person's files or reach the network.
- Windows' `tar.exe` lists archives inside the container.
- A networked container can't reach loopback.
- The pane dim lets clicks through.
- The Kura pipe refuses a second owner.

## Testing alongside macOS

These need a person, a signed build or tools this machine lacks:

- **Extensions:**
  - Install one MV3 extension from the Chrome Web Store.
  - Check its button, popup and options page.
  - Check content scripts on a granted site and not on an ungranted one.
  - Update it and confirm its settings stay.
  - Turn it off, remove it, and open a private tab.
- **Desktop control and the dock:**
  - Run a desktop task with "ask first".
  - Press Escape mid-task.
  - Dock an agent window and open the carousel.
- **Window chrome:**
  - Hover the maximize button (Snap Layouts opens on Windows 11).
  - Round the workspace corners over a page.
  - Dim panes by focusing another pane.
  - Click a dimmed page (it activates its pane).
- **Browser:**
  - A download with progress and Cancel.
  - A mixed-content page (no "Encrypted connection").
  - Import sign-ins from Edge with no tab open.
  - Chrome sign-ins, which may be locked (B-26).
- **Kura:** Kura's Windows client connects to `\\.\pipe\com.misty.desktop.clipboard.<user SID>`.
- **Release:**
  - A signed release build: `misty release check`, then build, which now runs `signtool verify`.
  - An update from one signed build to the next.
  - The ARM64 installer on an ARM64 machine (the build machine needs the Visual Studio "MSVC
    ARM64 build tools").
- **Uninstall:** confirm Misty leaves the default-browser and launch-on-login entries behind
  no more.

## Known Windows limits

- **Code projects:**
  - Commands run in `cmd.exe`, not bash.
  - Commands can't install packages: AppContainers can't reach the package proxy on loopback.
  - Commands see the project on a mapped drive letter.
  - A command can create new `.env.*` files: the secret rules cover files that exist when the
    project is prepared.
- **Extensions (WebView2):**
  - Manifest V3 only.
  - The toolbar shows the manifest's static icon and title: no dynamic badges.
  - The popup opens as a small floating window.
  - Buttons without a popup can't run their click action.
  - No `tabs`/`windows` proxy, native messaging, `notifications`, `contextMenus`, `storage.sync`,
    permission prompts after install, or popup inspection by agents.
  - Updates take about a second to restart the extension.
- **Media downloads:**
  - Need the standalone `yt-dlp.exe`; a pip-installed one launches a Python the sandbox can't reach.
  - The worker reaches public hosts directly with `internetClient`. Windows keeps it off loopback
    and the local network, but unlike the macOS proxy it doesn't block routed private ranges such
    as a VPN's.
- **Pages:**
  - Rounded page corners are clipped with a window region, so their edge isn't anti-aliased.
  - Snap Layouts opens through Win+Z on Windows 11, at the top of the window rather than under the
    button.
- **Archive previews** read RAR through 7-Zip or WinRAR's UnRAR, from Program Files or Scoop.
- **Chrome 127+ sign-ins** use app-bound encryption and can't be imported (B-26).

## Phase 0: before shipping any Windows build

| ID | Item | State | What was done |
| --- | --- | --- | --- |
| P0-1 | Windows compile gate | ✓ | `.githooks/checks.sh` runs `desktop-windows`: `cargo xwin check` for the Windows target on macOS and Linux, covered by `desktop-crate` on Windows. |
| P0-2 | Credentials stored as plaintext | ✓ | `misty-credential-store` seals files with DPAPI and gives the folder an owner-only DACL (`restrict_private_directory`, `restrict_private_file`). |
| P0-3 | Deep links lost while Misty is running | ✓ | Single-instance `deep-link` feature; launch arguments forwarded; `app_take_launch_urls` for the first window. |
| P0-4 | Untrusted files parsed in the main process | ✓ | Decode limits, and documents, previews and agent document prep run in the confined worker (F2). |
| P0-5 | Hide UI that fails on Windows | ✓ | Every gated surface now has a Windows backend, so the gates were removed as each one landed. |
| P0-6 | macOS wording on Windows | ✓ | Platform-neutral copy, `formatShortcut`, `ms-settings:` links (`microphoneSettingsHint`, `fileManagerName`). |
| P0-7 | Mounted devices list is always empty | ✓ | `devices_windows`: logical drives, type, volume information, free space; substituted drives skipped. |
| P0-8 | Popups lose `window.opener` | ✓ | `NewWindowRequested` adopts the popup into a tab, as macOS does. |
| P0-9 | Stale Windows window config | ✓ | Window sizes match macOS; the window starts hidden and reveals once its background matches the theme. |
| P0-10 | Release pipeline on Windows | ◐ | An unsigned dry run on Windows builds the release app and the NSIS installer, with the uninstall hooks, the embedded WebView2 bootstrapper and the compatibility manifest. A signed run needs the release secrets and the Authenticode certificate: the updater signature needs `TAURI_SIGNING_PRIVATE_KEY`. The CLI now has signing checks (S-17), ARM64 builds (S-19), owner-only private files on Windows, and a pruned task list (S-20). |

## Foundations

| ID | Foundation | State | What was done |
| --- | --- | --- | --- |
| F1 | WebView2 CDP helper | ✓ | `infra/webview2.rs`: `with_core`, `cdp_checked`, awaitable evaluation, isolated worlds, input, screenshots, snapshots. |
| F2 | Confined worker launcher | ✓ | `crates/windows-confine`: AppContainer, kill-on-close job with memory, CPU and process caps, handle-list launch, `command_line` quoting. `platform/windows/sandbox.rs` adds `Workspace::run`, `HostTool` and `run_tool`. |
| F3 | Handle-to-path and file identity | ✓ | `crates/windows-files` and `platform/windows`: final path, `FileIdInfo`, handle-relative access. |
| F4 | Windows desktop-control layer | ✓ | UI Automation actions, the low-level keyboard guard, overlays excluded from capture, display capture. |
| F5 | Handle-relative, no-follow file access | ✓ | `agent-code` and `agent-files` run on Windows over `NtCreateFile` relative opens that refuse reparse points. |
| F6 | NSIS installer hooks | ✓ | `windows/installer-hooks.nsh` removes Misty's default-browser and launch-on-login entries on uninstall. Registration itself happens in the app, under the person's hive. |

## Shell, system and release

| ID | Capability | State | What was done |
| --- | --- | --- | --- |
| S-1 | Window chrome | — | DWM corners and custom caption buttons work. Mica and Acrylic aren't needed: their wallpaper tint conflicts with the monochrome palette. |
| S-2 | Snap Layouts flyout | ✓ | Resting on the maximize button sends Win+Z (`window_snap_windows.rs`), on Windows 11 and only for the window in use. WebView2's caption regions need composition hosting, which Tauri doesn't use. |
| S-3 | Accelerators while a page has focus | ✓ | Every `nativeMenu` command is forwarded from pages with its Windows binding. The defaults cover pages that open before settings load. |
| S-4 | Tray clicks | ✓ | Left click shows the window; right click opens the menu. |
| S-5 | `.mf` file association | — | No longer registered on either platform. |
| S-6 | Launch on login | ✓ | Registry API with a quoted path, and the stored target is checked. |
| S-7 | Device change events | ✓ | `WM_DEVICECHANGE` listener (`devices_windows/listener.rs`). |
| S-8 | Eject a drive | ✓ | Lock, dismount and eject, through `devices_windows`. |
| S-9 | Device name | ✓ | `GetComputerNameExW(ComputerNamePhysicalDnsHostname)`. |
| S-10 | LAN discovery firewall prompt | — | The LAN layer is gone ([drop-lan-clipboard-on-sync.md](drop-lan-clipboard-on-sync.md)). |
| S-11 | `~/.misty` retirement and DACL | ✓ | Retired paths go to the Recycle Bin (undoable); `~/.misty` has an owner-only DACL. |
| S-12 | Kura clipboard bridge | ✓ | Named pipe `\\.\pipe\com.misty.desktop.clipboard.<user SID>`. It admits only this user, rejects remote clients, and is created as the first instance so nothing can squat the name. |
| S-13 | Kura handoff lookup | ✓ | `AssocQueryStringW`, with no console flash. |
| S-14 | Default browser | ✓ | `MistyHTML` ProgID, `StartMenuInternet` capabilities and `RegisteredApplications` under HKCU; detection from UserChoice; requests open `ms-settings:defaultapps`. |
| S-15 | Badge counts | — | Nothing sets a badge count on either platform. |
| S-16 | Installer | ✓ | NSIS with the embedded WebView2 bootstrapper (`embedBootstrapper`) and uninstall hooks. |
| S-17 | Code signing verification | ✓ | Preflight finds `signtool` and checks the certificate is installed. After the build, `signtool verify /pa /all /tw` checks the app and the installer (`cli/src/release/windows_signing.rs`). |
| S-18 | Updater | ◐ | `windows-x86_64` and `windows-aarch64` entries are generated and verified. An update between two signed builds still needs a release (see Testing). |
| S-19 | ARM64 Windows | ✓ | `windows-aarch64` builds with `--target aarch64-pc-windows-msvc` beside x64 and gets its own updater entry. The app and its tests type-check for that target. |
| S-20 | Release task list | ✓ | Only tasks that exist are listed, with a test that keeps it that way. |
| S-21 | Toast identity in dev | — | Notifications show as an unregistered app until installed through NSIS; fine for release. |

## Browser and Kiri

| ID | Capability | State | What was done |
| --- | --- | --- | --- |
| B-1 | Awaitable page JS | ✓ | CDP `Runtime.evaluate` with `awaitPromise` (F1). |
| B-2 | Region capture | ✓ | `Page.captureScreenshot` with a clip; no html2canvas. |
| B-3 | Tab preview DOM fallback | ✓ | Comes with B-1. |
| B-4 | Agent `browser.request` | ✓ | Through F1. |
| B-5 | Agent page-runtime isolation | ✓ | A CDP isolated world. |
| B-6 | Native trusted input | ✓ | CDP `Input.dispatch*` and `insertText`, keeping the generation and origin checks. |
| B-7 | Agent page steps with trusted events | ✓ | Comes with B-6. |
| B-8 | Context-menu replay | ✓ | CDP right-button events (`browser_right_click.rs`). |
| B-9 | Agent input lock | ✓ | `Emulation.setIgnoreInputEvents` while the agent acts. |
| B-10 | Agent control ring | ✓ | Drawn in the page by `browser_agent_ring.js`, as on macOS. |
| B-11 | Rounded page corners | ◐ | A window region on the page's host window, built from the four corner radii and kept in step with every resize by a subclass (`browser_page_frame_windows.rs`). The region edge isn't anti-aliased. |
| B-12 | Pane dimming | ✓ | A black layered child window over the page. Clicks pass through it (tested), and nothing is injected into the page. Needs the Windows 10/11 compatibility manifest (`windows/compatibility.manifest`). |
| B-13 | Under-page background during resize | ✓ | The view's background color follows the theme (WebView2's `DefaultBackgroundColor`). |
| B-14 | Click-to-focus pane activation | ✓ | The controller's `GotFocus` sends `misty://browser-focus` from WebView2 itself. |
| B-15 | Download "ask where to save" | ✓ | The save dialog in the download handler. |
| B-16 | Download progress and cancel | ✓ | The vendored wry keeps each `ICoreWebView2DownloadOperation` (`webview2/download.rs`): bytes received, the expected total, and a cancel that stops the engine download. |
| B-17 | Clear website data | ✓ | `ClearBrowsingDataInTimeRange` through a hidden view of the profile. |
| B-18 | Delete a profile | ✓ | Retries while WebView2 releases the folder. |
| B-19 | Save page | ✓ | `Page.captureSnapshot` as MHTML. |
| B-20 | Inspector in release builds | ✓ | DevTools enabled for the page's view only; `OpenDevToolsWindow`. |
| B-21 | Mute a tab | ✓ | `ICoreWebView2_8::SetIsMuted`. |
| B-22 | Site permissions UI | ✓ | Kiri's WebView2 backend runs; the UI shows on Windows. |
| B-23 | Synced page state | ✓ | Isolated world (B-5). |
| B-24 | Secure-context indicator | ✓ | Kiri follows CDP `Security.visibleSecurityStateChanged`. Mixed content or a certificate problem shows as not secure. |
| B-25 | Page process crash recovery | ✓ | `ProcessFailed` reloads and emits `misty://browser-page-process-ended`. |
| B-26 | Import: Chromium cookie key | ◐ | DPAPI keys (`v10`/`v11`) import. Chrome 127+ app-bound (`v20`) sign-ins are locked to Chrome, and the result says so with what to do instead. |
| B-27 | Import: a running browser's files | ✓ | A sharing violation asks the person to quit that browser. |
| B-28 | Import: writing cookies | ✓ | Through a hidden view of the profile, so no tab needs to be open. |
| B-29 | Kiri runtime on Windows | ✓ | `kiri\probes\runtime\run.ps1` passes. |
| B-30 | Windows-path probes | — | The popup, render and agent-files probes have no caller on either platform. Windows coverage comes from the Windows tests listed above. |

## Extensions

Windows runs extensions in WebView2 (`infra/extensions/native_windows/`), behind the same
`native::request` operations macOS uses, so install, approvals, account sync of installs and the
React UI need no Windows-specific code:

- **Profiles:** each loaded extension is installed into the profile behind every open browser view,
  and a profile is reconciled when one of its views opens.
- **Package copy:** each version runs from a copy of the package that holds only the granted
  permissions and sites, because WebView2 grants whatever a manifest declares.
- **Stable ID:** the copy carries a manifest key derived from the account origin. The extension's
  ID, page host and storage therefore stay the same across versions and launches.
- **Off versus removed:** turning an extension off disables it. Only removing it from Misty
  uninstalls it, since that deletes its storage.
- **WebView2's own extensions:** these (such as the PDF viewer) are never touched. Misty keeps a
  ledger of the IDs it installed.

| ID | Capability | State | What was done |
| --- | --- | --- | --- |
| E-1 | Store catalog, download, CRX3 check, review | ✓ | Shared Rust. |
| E-2 | "Add to Misty" on store pages | ✓ | Works now that installs work. |
| E-3 | Manifest validation | ✓ | Rust checks; Manifest V2 and background pages are blocked; WebView2's limited APIs are listed as findings. |
| E-4 | Install, approvals, account sync of installs | ✓ | Shared. |
| E-5 | Runtime load, unload, enable, remove | ✓ | `AddBrowserExtension`, `Enable`, `Remove` per profile; `AreBrowserExtensionsEnabled` on every browser data directory (`with_browser_data`). |
| E-6 | Content scripts and host grants | ✓ | The runtime copy keeps only granted `host_permissions` and `matches`. |
| E-7 | Service worker and errors | ✓ | Runs in WebView2; install failures surface from `AddBrowserExtension`. |
| E-8 | Toolbar action | ◐ | Icon and title from the manifest; no dynamic badges. |
| E-9 | Action popup | ◐ | Opens the popup page in a small floating window. |
| E-10 | Options page | ✓ | Opens in a tab. |
| E-11 | Platform extension origin | ✓ | `chrome-extension://<id>` on Windows (`EXTENSION_SCHEME`, `page_host`), including new-tab overrides and agent URL checks. |
| E-12 | `tabs` and `windows` APIs | ◐ | WebView2 exposes only its own tab model. |
| E-13 | Popup-type windows | ◐ | As E-12. |
| E-14 | Runtime permission prompts | ◐ | WebView2 grants at install; there is nothing to prompt for later. |
| E-15 | Native messaging | ◐ | Not offered by WebView2. |
| E-16 | `notifications` | ◐ | Not offered by WebView2. |
| E-17 | Compat layer transport | ✓ | Not needed: Chromium provides the APIs the WebKit layer stands in for, so Windows packages run as published (`compat.rs`). |
| E-18 | `contextMenus` | ◐ | Not offered by WebView2. |
| E-19 | `storage.sync` account sync | ◐ | `storage.local` works; account sync of extension storage is macOS-only. |
| E-20 | Updates and store takedowns | ✓ | A new version installs over the old one under the same ID and keeps its storage (probe-tested). |
| E-21 | Private-window access | ✓ | Extensions join the InPrivate profile only when allowed. |
| E-22 | Agent access to extensions | ✓ | Through the platform origin. Popup inspection isn't available (E-9). |
| E-23 | Tests | ✓ | Unit tests, plus the explicit WebView2 probe `cargo test --lib webview2_runs -- --ignored`. |

## Agents and desktop control

| ID | Capability | State | What was done |
| --- | --- | --- | --- |
| A-1 | Detach a tab into a host window | ✓ | The page fills its host, minus the bar, and is shown again on return. |
| A-2 | Agent dock | ✓ | Owned tool windows with live DWM thumbnails, a carousel and captions (`agent_dock_windows.rs`). |
| A-3 | Misty-window autopilot | ✓ | Window capture and CDP input (`workspace_autopilot_windows.rs`). |
| A-4 | Control lease, ask, takeover, Escape, watchdog | ✓ | `desktop_control_windows/`. |
| A-5 | Live display capture | ✓ | Display frames with Misty's overlays excluded. |
| A-6 | Acting in other apps | ✓ | UI Automation press, focus, fill and scroll, and tagged keys. |
| A-7 | Desktop control island | ✓ | A topmost no-activate window (`desktop_overlays_windows.rs`). |
| A-8 | Control rings and mist | ✓ | Click-through layered overlays. |
| A-9 | Screen context for a Misty ask | ✓ | A foreground hook tracks the last other window, which is then captured. |
| A-10 | Companion precise pointing | ✓ | UIA `ElementFromPoint` with label scoring. |
| A-11 | Code projects | ✓ | `agent-code` on Windows (F5). |
| A-12 | Sandboxed commands and dev servers | ◐ | AppContainer with a job, on a mapped drive. See Known Windows limits. |
| A-13 | Git and review changes | ✓ | Path forms normalized; line-ending-neutral diffs. |
| A-14 | Midscene on workspace and desktop | ✓ | Comes with A-3 to A-5. |
| A-15 | Organize a folder | ✓ | `agent-files` on Windows; the Organize control is no longer hidden. |
| A-16 | Desktop audio | — | Nothing calls it on either platform. |
| A-17 | Open a cited file | ✓ | The default app through the opener. |
| A-18 | Background-scan exclusions | — | The background scanner was removed on both platforms when the file manager moved to Kura (`507a9e98`). |
| A-19 | Companion capture leaves Misty out | ✓ | `WDA_EXCLUDEFROMCAPTURE`. |
| A-20 | Companion over fullscreen apps | ✓ | Re-asserts `HWND_TOPMOST`. |
| A-21 | Microphone denied message | ✓ | Plain message with the Settings path. |
| A-22 | Companion hold, hooks, overlay, keep awake | ✓ | Already worked. |

## Voice and Memory

From docs/design/voice-memory/BRIEF.md. "Built" means it is written and cross-checked with
`cargo check --target x86_64-pc-windows-msvc` in a scratch crate, but not yet run on a Windows
machine. ◐ stays until someone runs it there.

| ID | Capability | State | What was done |
| --- | --- | --- | --- |
| V-1 | Audio capture (mic, system without Misty, process loopback) | ◐ | `audeeo-core` WASAPI backend. It is built, and Audeeo's Windows CI runs its tests, but it has not been run on a device. |
| V-2 | Global hold-to-talk hotkey | ◐ | `global_hotkey/windows.rs`, one `WH_KEYBOARD_LL` hook. It drops the fake LCtrl that AltGr sends, and injected keys. Built. |
| V-3 | Dictation insertion | ◐ | `insert_windows.rs`. It snapshots every clipboard format, pastes with `SendInput`, uses Ctrl+Shift+V in terminals, and restores the clipboard only if it is unchanged. Built. |
| V-4 | Dictation pill | ◐ | A shared Tauri window (`misty-dictation-pill`). The no-activate and topmost behavior needs a Windows pass. |
| V-5 | Transcribe a tab | ◐ | The Kiri media tap in WebView2. Whether WebView2 allows `createMediaElementSource` on every site still needs checking. |
| V-6 | Screen recording | ◐ | `voice/recording_windows.rs`: Windows.Graphics.Capture into a Media Foundation H.264 sink writer, with system audio and mic as AAC tracks. Built. Needs a run for the capture border, A/V sync and file playback. |
| V-7 | Memory page recorder | ✓ | Shared TypeScript. It reads the reader article through the same command on both platforms. |
| V-8 | Memory at the cursor | ✓ | The server-side prompt and tools, the same on both platforms. |

## Files and the document worker

Third-party app hosting and its host services were removed from Misty on every platform, so the app-facing rows of
this section (permissions, downloads, media, archives, folder grants and the shared tool sandbox) no
longer exist. Only the bundled document worker remains, for agent document preparation.

| ID | Capability | State | What was done |
| --- | --- | --- | --- |
| M-1 | Bundled confined workers | ✓ | The document worker is built as an `.exe` and runs in an AppContainer (F2). |
| M-3 | Agent document prep | ✓ | In the worker (`document_worker_windows`); macOS uses `document_worker_macos` under `sandbox-exec`. |

## Cleanup, not parity

| ID | Item | State |
| --- | --- | --- |
| C-1 | Peer file browsing over the LAN | ✓ Removed with the LAN layer. |
| C-2 | LAN media gateway | ✓ Removed. |
| C-3 | "Open on my other device" sender | ✓ Removed. |
| C-4 | File-search worker | ✓ Removed. |
| C-5 | Devices brief | ✓ Updated. |
| C-6 | Host code for the `backup-archive`, `file-operations`, `terminal` and `code-tools` workers | ✓ Removed. |
| C-7 | Popup, render and agent-files debug probes | ✓ Removed. |

## Not needed on Windows

- Security-scoped bookmarks (replaced by M-16).
- TCC prompts: Windows has no screen or accessibility prompts, and mic and camera use `ms-settings:`
  links.
- WebAuthn: WebView2 uses Windows Hello.
- Safari import.
- HTTP attachment downloads for displayable types: Chromium handles them.
- The WKWebView workarounds: pointer guard, corner scrollbars, frame rate, Safari UA, live resize.

## Open: the 2026-10-13 shell redesign was built and checked on macOS only

These were written against macOS behavior. Each needs a pass on Windows (and Linux where noted)
before it counts as done; add rows above as they close.

- **Window buttons follow the left sidebar.** `set_traffic_lights_visible` in
  `src-tauri/src/platform/plugins/mac_rounded_corners.rs` slides and fades the native traffic
  lights with the drawer. Windows draws its own caption buttons on the right
  (`WindowsTitlebarControls`), so there is nothing to slide with a left sidebar; decide whether a
  right-side tab sidebar should carry them, and what the command does on Windows (it is a no-op).
- **Top-edge drag and double-click zoom.** The page script (`browser_scripts.rs`) and the app-page
  handler (`handleTopEdgePointerDown`) call `togglePseudoMaximize` on macOS and
  `toggleTitlebarMaximize` elsewhere. Check on Windows that a double press zooms, that snap
  layouts still work, and that dragging from the top tenth does not fight resize borders.
- **Panel look and corner masks.** Vertical tabs make the page a rounded panel with an 8px margin
  (`dockingGeometry.ts`, `docking.css`). The page's rounded corners come from the macOS layer mask
  in `browser.rs` (`position_macos_webview`); confirm Windows clips the WebView2 child to the same
  radii and shows no gray margin.
- **Overlays above native pages.** The address bar's search panel, the layout menu, the Spaces
  menu and the account island rely on the renderer being raised above the native page. The
  floating account island is hidden behind the page in horizontal tabs on macOS; check whether
  the Windows transparency path (`set_windows_renderer_transparency`) behaves the same.
- **Titlebar insets.** Tab-strip and sidebar-header insets reserve room for left-side traffic
  lights (`titlebarInsets`, `useMergedTitlebar`). On Windows the controls are on the right; check
  the horizontal strip's right inset, the sidebar's flush top, and the drag region that stops
  short of the first tab's curve.
- **Windows-only chrome still on the old layout.** `WindowsWorkspaceTitlebarControls` keeps its own
  split buttons and window menu; the macOS layout moved those into the browser's pane layout
  menu. Bring Windows in line or decide it keeps them.
- **Profile website data.** Profiles' `webview` folders are a symlink to WebKit's store on macOS
  and a real folder on Windows/Linux (`browser_profile.rs`); the home layout and migration were
  only exercised on macOS.

## Keeping it caught up

- Any new `#[cfg(target_os = "macos")]` command needs a Windows branch or a row here.
- `desktop-windows` in `.githooks/checks.sh` keeps the Windows build compiling from any machine.
- Add Windows tests beside macOS ones. Tests that touch real tools use private copies, so they never
  change the person's installation.
