# Settings

Settings belong to the device. They are saved in `misty.db`, never sync and never reach the
server. Everything about the settings pages is below; how values are stored and what lives in
the Misty home folder is in the two files here.

## Read first

| To learn about | Read |
| --- | --- |
| How a setting is declared, stored and resolved | [storage.md](storage.md) |
| What `~/.misty` contains and what a clean install creates | [misty-home.md](misty-home.md) |

Code lives in `src/features/settings/` (the registry is `settingsRegistry.tsx`).

## Interface rules

- The settings sidebar follows Claude's settings: the Search field, then pages under plain muted group labels named by feature (Settings, Browser, Agents), each row a Lucide icon and the page name, the selected row a filled gray pill. No dividers, Account footer, nested disclosures, tab strips or chevrons on settings buttons (sidebar entries and rows alike). Each page opens one scrolling page with no title bar; plain section headers carry it. Account, plan and billing live on the website; settings only link there (General › About).

- `src/features/settings/settingsRegistry.tsx` is the single settings navigation registry. Use `DesktopSettingsSection`, `DesktopSettingsRow` and `SettingsControls` for settings UI. Page names are one word that never repeats or echoes its group's name, with no ampersands; each page has a unique icon. Keep the sidebar to about a dozen pages: add a section to a page before adding a page.

- Settings pages are plain lists: no card boxes, hairlines between rows, every control right-aligned to one shared edge. Rows and sections carry a short muted line of helper text that explains what the setting does, its scope or its privacy and destructive consequences; keep it to a sentence or two and never repeat the label. Reset appears only while a value differs from its default and never moves the control. Up to four short choices use a segmented control; longer lists use a checkmarked dropdown, never a stack of radio buttons. Failures show as an inline notice in plain language, never raw setting keys or server errors.

- Settings belong to the device: they are saved in `misty.db` and never sync or reach the server. Do not add account-synced settings, outboxes, or "Settings sync" surfaces. Server-owned resources (conversation retention, hosted Misty, the model catalog) keep their own APIs and are not settings. Device identity and OS keychain secrets stay distinct from preferences.

