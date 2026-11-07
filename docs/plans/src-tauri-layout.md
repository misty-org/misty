# src-tauri layout

Status: planned, nothing moved. Written 2026-11-06. Delete this file when the work is done, so
nothing finished stays in `docs/`.

`src-tauri` is hard to read: one feature's code is spread over `crates/`, `services/`,
`src/infra/`, `src/voice/`, `src/platform/`, `native/`, `sandbox/` and `tests/`, and the names
describe layers (`infra`, `platform`, `domain`, `handlers`) or are vague (`autopilot`,
`companion`, `context`, `store`). Agents alone live in four places.

## The one rule

Everything for a feature lives in `src-tauri/features/<feature>/`: its Rust, its worker programs,
its tests and its platform code. Platform code is a `macos.rs` or `windows.rs` file (or folder)
inside the feature, never a `_windows` or `_macos` suffix on a file name elsewhere.

Names say what a thing does for the person. They never name a layer (`infra`, `platform`,
`domain`, `services`, `crates`, `handlers`, `plugins`), never carry a `misty_` prefix, and never
use a vague word (`autopilot`, `companion`, `context`, `environment`).

Each feature owns its Tauri commands in its own `commands.rs`. The shared `app/*_commands.rs`
files and `app/handlers` go away.

## Shape

- `src-tauri/Cargo.toml` stays where Tauri needs it. Its `[lib] path` points at
  `features/lib.rs`, so the app crate's modules live in `features/`, not `src/`.
- A feature folder is either a module of the app crate or its own crate (it has a `Cargo.toml`).
  Both sit side by side in `features/`.
- A worker program that runs in an OS sandbox must be its own crate, because it can't link Tauri.
  It lives in its feature, for example `agents/shell/worker/`.
- `sandbox/` at the root becomes `tauri-permissions/` (it holds Tauri capability files, not a
  sandbox). The Windows installer files and plists go to `packaging/`.
- `vendor/`, `gen/`, `icons/`, `build.rs`, `tauri*.conf.json` and `clippy.toml` stay.

## Which features can be crates

A count of calls between `infra` modules (file level, `crate::infra::…` paths only) shows the
browser is a hub: agents, extensions, sync, account and memory call into it, and it calls back.
Rust forbids crates that depend on each other, so those cannot be separate crates until the
loops are cut.

- Base crates, after cutting their one to three back-calls into browser or app: `database`,
  `file_access`, `permissions`, `settings`.
- Leaf crates, already clean or nearly: `sandbox`, `documents`, `page_text`, `voice/capture`,
  `kiri`, `sync/browser_data`, `agents/runs`, and the three workers.
- One app crate holds the tangled group as plain modules: browser (with extensions), sync, account,
  devices, memory and the agent host side. Inside it every feature is still its own folder.
- Splitting the tangled group further is optional. Do it only if dev rebuilds get slow, for
  example by having agents reach the browser through a small interface crate.

### Build speed

Release already uses `lto = "fat"` and `codegen-units = 1`, so crate boundaries barely change it.
Dev rebuilds are where a big crate costs time. Before and after every fold:

1. Time an incremental rebuild after touching one file in the app crate, `agents/runs` and `kiri`.
   Run it when no other `cargo` is running.
2. Set a budget from the baseline. A fold that breaks it stays a crate inside its feature folder.
3. Try, and measure, `debug = "line-tables-only"` and `split-debuginfo = "unpacked"` for dev,
   and one `commands.rs` per feature instead of one giant `generate_handler!`.
   `sccache` helps clean builds and hooks, not incremental ones.

## Where everything goes

Paths below are under `features/`. Kind is `module` (in the app crate), `crate` or `worker`.

### Agents

| Today | New | Kind |
| --- | --- | --- |
| `crates/agent/src/runtime/*` | `agents/runs/` | crate |
| `crates/agent/src/sdk/*` (model calls) | `agents/runs/model_calls/` | in the crate |
| `infra/agent_runtime/*` | `agents/run_control/` | module |
| `infra/agents/chats`, `storage` | `agents/chats/` | module |
| `infra/agents/shared_folders`, `folder_changes`, `app/shared_folder_commands` | `agents/shared_folders/` | module |
| `infra/agents/web_fetch` | `agents/web_fetch/` | module |
| `infra/agents/workspace/*` | `agents/task_scopes/` | module |
| `infra/models/*` | `agents/models/` | module |
| `infra/composio/*` | `agents/connected_apps/` | module |
| `infra/agent_shell/*`, `app/shell_commands` | `agents/shell/` | module |
| `services/agent-shell` | `agents/shell/worker/` | worker |
| `infra/cursor_companion/*` | `agents/cursor/` | module |
| `infra/desktop_control_windows/*`, `desktop_overlays_windows` | `agents/desktop_control/` | module |
| `infra/workspace_autopilot*` | `agents/window_control/` | module |
| `infra/misty_context*` | `agents/screen_context/` | module |
| `infra/power_keep_awake` | `agents/keep_awake.rs` | module |
| `infra/system_memory` | `agents/live_pages_memory.rs` | module (name to confirm) |

### Sandbox, documents, page text

| Today | New | Kind |
| --- | --- | --- |
| `crates/windows-confine/*` | `sandbox/windows/` (crate `sandbox`, one idea: confine a process) | crate |
| macOS `sandbox-exec` code in `agent_shell`, `documents`, `page_reader` | `sandbox/macos.rs` | in the crate |
| `infra/builtin_workers` | `sandbox/embedded_workers.rs` | module |
| `infra/documents/*` | `documents/` | module |
| `services/document-processing` | `documents/worker/` | worker |
| `crates/page-reader/*` | `browser/page_text/` | crate |
| `infra/page_reader/*` | `browser/page_text/host/` | module |
| `services/page-reader` | `browser/page_text/worker/` | worker |

### Browser

`infra/browser` is 121 flat files; this grouping is by file name and needs a read-through when it
moves.

| Today | New | Kind |
| --- | --- | --- |
| `browser/create`, `native_views`, `stacked_pages`, `view_ops`, `view_close`, `view_overlay`, `window_pages`, `bounds`, `first_paint`, `fullscreen`, `pane_dim`, `load_watch`, `url_observer`, `renderer_reload`, `page_state`, `theme`, `night_light`, `title_probe`, `corner_scrollbars` | `browser/pages/` | module |
| `browser_process_ended`, `browser_content_world`, `browser_frame_rate_macos`, `browser_pointer_guard_macos*`, `browser_macos/`, `webview2*`, `capture_windows`, `page_frame_windows` | `browser/pages/macos.rs`, `windows.rs` | module |
| `browser/native_input*`, `click_focus`, `interact`, `paste`, `browser_shortcuts` | `browser/input/` | module |
| `browser/context_menu`, `engine_menu`, `menu_commands`, `popups` | `browser/menus/` | module |
| `browser/downloads*`, `download_names`, `attachment_download_macos`, `infra/browser_library/*` | `browser/history_downloads/` | module |
| `browser/agent*`, `page_agent/*`, `page_tools`, `eval_bridge`, `task_files`, `action_confirm`, `infra/browser_frames*` | `browser/agent_pages/` | module |
| `browser/scripts`, `kiri_host`, `kiri_probe*`, `host_messages` | `browser/kiri_link/` | module |
| `infra/browser_provider*`, `browser-providers.json`, `browser/account_views` | `browser/provider_accounts/` | module (to confirm) |
| `infra/profile_store*`, `website_data`, `browser/store_cleanup`, `store_data`, `retired_profiles` | `browser/site_data/` | module |
| `infra/profile_data/*` | `browser/profiles/` | module |
| `infra/profile_windows/*`, `window_focus_windows`, `window_snap*_windows`, `workspace_recovery`, `navigation_names` | `browser/app_windows/` | module |
| `infra/browser_import/*` | `browser/import/` | module |
| `infra/site_settings/*` | `browser/site_settings/` | module |
| `infra/search/*`, `link_preview`, `site_icon`, `default_browser` | `browser/search/`, `link_previews/`, `site_icons.rs`, `default_browser.rs` | module |
| `infra/local_auth` | `browser/autofill/` | module |
| `infra/extensions/*` | `browser/extensions/` | module |
| `crates/kiri/*` | `kiri/` | crate |

`app_windows` avoids a folder called `windows`, which would collide with the Windows OS code.

### Sync, account, devices, voice, memory

| Today | New | Kind |
| --- | --- | --- |
| `infra/vault/*` | `sync/vault/` | module |
| `crates/browser-sync/*` | `sync/browser_data/` | crate |
| `infra/cloud_clipboard/*`, `domain/clipboard/*`, `app/clipboard_commands`, `infra/native_clipboard` | `sync/clipboard/` | module |
| `infra/account/*`, `credential_store`, `google_sign_in_sheet` | `account/` | module |
| `infra/devices/*`, `app/device_*_commands` | `devices/` | module |
| `src/voice/*`, `infra/global_hotkey/*` | `voice/` (`dictation`, `hold_to_talk`, `live_subtitles`, `tab_audio`, `insert`) | module |
| `crates/audio-capture/*` | `voice/capture/` | crate |
| `infra/memory/*` | `memory/` | module |

### Everything else

| Today | New | Kind |
| --- | --- | --- |
| `infra/file_access/*` | `file_access/` | crate |
| `infra/permissions/*` | `permissions/` | crate |
| `infra/settings/*`, `shortcuts/*`, `app/shortcut_commands` | `settings/` | crate |
| `infra/store`, `misty_home*`, `paths`, `environment`, `development_profile`, `retired_coding_data`, `misty-home-layout.json` | `database/` | crate |
| `app_setup`, `shell_plugins`, `error`, `infra/app_menu*`, `tray`, `autostart`, `platform/app_lifecycle` | `app/` | module |
| `platform/app_command_policy`, `navigation_guard`, `asset_protocol`, `synced_paths` | `app/trusted_windows/` | module |
| `platform/plugins/mac_*` | `app/macos_window_effects/` | module |
| `app/commands`, `handlers`, `runtime` | `app/` (state and wiring only) | module |
| `infra/misty.rs`, `domain/clock` | `app/system_info.rs`, `app/time.rs` | module |
| `main.rs`, `lib.rs` | `main.rs`, `lib.rs` at the `features/` root | |

Not read closely, to confirm when moving: `platform/shared_windows` (automation, registry,
sandbox), `infra/environment.rs`, and `infra/plugin_routes.rs` (looks empty).

### Native code and tests

| Today | New |
| --- | --- |
| `native/macos/MistyAgentPointer`, `MistyAgentRing`, `MistyAgentWindowRing`, `MistyCompanion*` | `agents/cursor/macos/` |
| `MistyDesktopControl*`, `MistyDesktopCapture`, `MistyDesktopIsland` | `agents/desktop_control/macos/` |
| `MistyAutopilot` | `agents/window_control/macos/` |
| `MistyContext` | `agents/screen_context/macos/` |
| `MistyExtension*` | `browser/extensions/macos/` |
| `MistyBrowserInput` | `browser/input/macos/` |
| `MistyDefaultBrowser` | `browser/macos/` |
| `MistyDictationInsert` | `voice/macos/` |
| `MistyLocalAuth` | `browser/autofill/macos/` |
| `MistySpaceDock` | `browser/app_windows/macos/` |
| `tests/webextensions/` | `browser/extensions/tests/` |
| `tests/browser_native_input.m` | `browser/input/tests/` |
| `tests/frames-probe/`, `tests/webview_url.rs` | `browser/agent_pages/tests/`, `browser/pages/tests/` |

## Phases

Do this on its own branch, after the working tree's pending changes are committed. After every
step: `cargo check --all-targets` on macOS, the Windows cross-check from `.githooks/checks.sh`,
and the Rust and script tests.

1. Measure the dev rebuild baseline.
2. Move the crates and workers into their feature folders and rename them. This is mechanical:
   Cargo paths, hooks, `cli/src/checks.rs`, docs, scripts. Done already for Kiri
   (`crates/kiri`) and the removal of `examples/`.
3. Point `[lib] path` at `features/lib.rs` and move `src/` into `features/`, still with the old
   module names, so the diff is only a move.
4. Regroup modules into feature folders, leaves first: voice, documents, memory, devices, sync,
   then browser (with extensions), then agents last. Move each feature's commands into its own
   `commands.rs`. Rename as the tables say, one feature per change.
5. Cut the back-calls from `database`, `file_access`, `permissions` and `settings`, then make them
   crates. Re-measure rebuild times after each crate or fold.
6. Move native files and tests into their features (still Objective-C at this point).
7. Rewrite native code in Rust (below).
8. Rename `sandbox/` to `tauri-permissions/` and gather installer files into `packaging/`, with
   the `tauri*.conf.json` paths updated.

## Rust-only native code

The 3,900 lines of Objective-C in `native/macos/` can become Rust. The app already uses
`objc2`, `objc2-app-kit`, `objc2-foundation`, `objc2-web-kit` and `block2` in 45 Rust files, and
`objc2-web-kit` 0.3.2 includes the `WKWebExtension*` classes. The `cc` build step for `.m`
files goes away.

| Group | Lines | Rust replacement |
| --- | --- | --- |
| Extensions (`MistyExtension*`) | about 1,900 | `objc2-web-kit` `WKWebExtension*`, delegates with `define_class!` |
| Agent pointer, ring, island, companion | about 1,100 | `objc2-app-kit`, `objc2-quartz-core` |
| Screen capture | in the above | `objc2-screen-capture-kit` |
| Touch ID check | 31 | `objc2-local-authentication` |
| Notifications | in extensions | `objc2-user-notifications` |
| Dictation insert, default browser, Space dock, context | about 250 | `objc2-app-kit` |
| Accessibility and Carbon calls (`Autopilot`, `DesktopControl`) | about 400 | `objc2-application-services`; the few Carbon calls as `extern "C"` |
| `CommonCrypto` hashing | tiny | `sha2` |

Risks: delegate, threading and lifetime code is where bugs hide, there is more `unsafe` than
elsewhere, and ring animations, extension popups and capture can only be checked by hand on a
Mac. A missing binding is called through `msg_send!`, which is still Rust.

Order, one file at a time with behavior kept identical:

1. `LocalAuth`, `DefaultBrowser`, `SpaceDock`, `Context`, `DictationInsert`.
2. Pointer, ring, island, companion and capture.
3. `Autopilot` and `DesktopControl` (Accessibility).
4. The extension group, last.
5. The test harness: `tests/browser_native_input.m` and the C header stand-in in
   `tests/webextensions/` become Rust tests.

## Open questions

- `agents/runs` against `runtime` as the name of the agent loop: the docs say "the runtime".
- Names to confirm: `provider_accounts`, `live_pages_memory`, `task_scopes`, `trusted_windows`.
- Whether the tangled group ever needs splitting into crates, decided by the rebuild numbers.
