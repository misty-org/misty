# Settings audit (2026-10-08)

Status: implemented on 2026-10-08 except where noted below. Removals, additions and the row layout
are in place; nothing has been built, type-checked or tested yet.

Scan of every registered setting (`src/features/settings/profiles/definitions.json`, mirrored in
`server/internal/platform/transport/settings_definitions.json`), the Rust defaults in
`src-tauri/src/infra/settings.rs`, and customization stored outside Settings. "Reader" means code
outside the settings feature that changes behavior from the value.

Approved row layout for the rebuild: mockup B (plain list, fixed 240px control column, Reset link
only when modified, segmented control for 2–3 options, dropdown for 4+).

## Remove

### Dead settings (a row or definition exists, nothing reads it)

| Setting | Where | Evidence |
| --- | --- | --- |
| `app.confirmDestructive` — Confirm destructive actions | General | `confirmDestructiveActions` is selected in `preferences.ts` and never used. Toggling does nothing. Confirmations are always on anyway. |
| `browser.externalLinks` — Open links externally | Browser | `openLinksExternally` has no reader; Rust only checks it in a migration test. |
| `browser.bookmarksBar` | Browser | Row already removed (bar retired); definition and server copy remain. |
| `files.devices.sessionDays` — Keep devices connected for | Devices | No reader anywhere. |
| `files.view`, `files.hidden`, `files.action` | (no page) | File manager moved to Kura. Only Rust defaults remain. |
| `files.indexing.*` (5 settings) | (no page) | `selectSearchMaintenancePreferences` has no caller. |
| `files.openWith` | (no page) | Only profile import/export plumbing; Open With lives in Kura. |
| `app.appearance.thumbnail_previews_enabled` — Thumbnail previews | Appearance | Only affects the file grid inside the picker. Picker should just show thumbnails. |

### Removed on request

- Wallpaper video and Panel opacity (Appearance): the whole feature, including the native
  AVFoundation layer (`set_native_wallpaper_video`) and the see-through CSS. Pruned in schema 7.

### Read-only rows that aren't settings (Agents › Misty)

- "Hosted provider" (status text; AI is gateway-only, there is nothing to choose)
- "Purge status" (internal job state)
- "Personal by default" ("Never shared silently" static text)
- "Dangerous actions" ("Blanket approval disabled" static text)

### Redundant rows

- Agents › Defaults › "Model choices → Open Models": a button that jumps to the Models page, which
  renders on the same Agents page directly below.
- About › Diagnostics "Config path" / "Data path": keep, but as plain text rows, not controls.

### Legacy Rust defaults (no definition, no UI, no reader)

Editor/terminal leftovers in `settings.rs`: `autosave_delay_ms`, `cursor_blink`,
`cursor_style_index`, `font_family`, `font_size`, `format_on_save`, `line_numbers`,
`preferred_terminal_app`, `scrollback`, `tab_size`, `word_wrap`, `interface_scale`,
`default_transfer_behavior_index`, `extension_tools_path`, `default_profile_id`, `theme`.

### Decided

- `agents.model` and `agents.reasoning`: removed. New Global Misty chats now follow the account's
  Thinking sense on the server (`misty_conversations.go`).
- `browser_tab_history_kb`: still open. Read by `useSettingsStore` but not registered.

## Add

| Proposed row | Page | Today |
| --- | --- | --- |
| Theme: System / Dark / Light | Appearance | Only via the Themes extension; native browser already supports dark/light/system. |
| Navigation and tab positions | Layout | Already existed per window (missed in the first scan). |
| Show in navigation (Browser, Agents, Extensions, Spaces) | Layout | New account setting `app.navigation.hidden`; the old local `misty-navigator-apps` store had no reader and was deleted. |
| Saved layouts (rename, delete) | Layout | `app.layout.presets` is registered with no row. |
| Clear browsing data | Browser › Privacy | Dialog exists (`BrowserClearDataDialog`) but is only reachable from the history menu. |
| Allow agents to use extensions | Browser | `extensions.agent_access` is registered to the Browser page but only toggled in the Extensions workspace. |
| Make Misty your default browser | Browser | Not implemented; needs a native command. |

## Bugs found during the scan

- "Unknown portable setting agents.panel_side": the client and server definition files match, so
  the running API is an older build. Restart/redeploy the server to pick up the new definition.
