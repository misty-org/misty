# Settings

Settings belong to the device. They are saved in `misty.db` and never sync. Model keys and
sign-ins go to the agent runtime on this computer, which calls the providers
([byok.md](../byok.md)); they never go to the server. Everything about the settings pages is
below; how values are stored and what lives in the Misty home folder is in the two files here.

## Read first

| To learn about | Read |
| --- | --- |
| How a setting is declared, stored and resolved | [storage.md](storage.md) |
| What `~/.misty` contains and what a clean install creates | [misty-home.md](misty-home.md) |

Code lives in `src/features/settings/` (the registry is `settingsRegistry.tsx`, and where a
section id lands is `settingsRouting.ts`).

## Pages

| Group | Page | Sections |
| --- | --- | --- |
| Account | Profile | Details (picture, username, email), Security, Danger (delete) |
| | Server | Which Misty server this device uses |
| App | General | Startup, Browsing (default browser, outside links, search suggestions), Tabs, Downloads, Updates |
| | Interface | Theme (with night light), Window (tab side, Space bar, app zoom) |
| | Shortcuts | Commands and shortcut hints |
| | Voice | Dictation, Speech, Captures |
| | Privacy | Browsing data, Permissions |
| | Advanced | Pages (link previews, status, gestures, sleeping tabs), Display (pane dimming, compact mode, frame pacing) |
| Browser | Passwords | Saved sign-ins |
| | Extensions | Stores, and one section per installed extension |
| | Sync | Before setup, the setup wizard opens; after it, Setup (Open setup, frequency), Restore, Workspaces, Websites, Recovery and Devices |
| Agents | Models | Sign-ins, Provider and keys, Choices, Voice keys, Search |
| | Conversations | Defaults, Screens, Misty, Cursor |
| | Access | Limits (paying, sensitive and blocked sites), Approvals, Shared folders |
| | Memory | Remembering, Data, Context |

Open a page from code with `openSettings(section, focus?)` from `@/features/settings`: the
section's page opens and scrolls to it, and `focus` (a row's label) highlights one row. Retired
section ids resolve through `canonicalSettingsSection`; `settingsRegistry.test.ts` checks that
every id and every searchable preference lands on a block that exists.

## Interface rules

- The settings sidebar follows Claude's settings: the Search field, then pages under plain muted group labels named by feature (Account, App, Browser, Agents), each row a Lucide icon and the page name, the selected row a filled gray pill. No dividers, Account footer, nested disclosures, tab strips or chevrons on settings buttons (sidebar entries and rows alike). Each page opens one scrolling page under its header row, with plain section headers inside. There are no plans or billing.

- `src/features/settings/settingsRegistry.tsx` is the single settings navigation registry. Use `DesktopSettingsSection`, `DesktopSettingsRow` and `SettingsControls` for settings UI. Page names are one word that never repeats or echoes its group's name, with no ampersands; each page has a unique icon. Keep the sidebar to about a dozen pages: add a section to a page before adding a page.

- Each page has one header row at the top of the content, with the page's name, the close button and a divider under it; the page scrolls beneath it. It matches the website's settings. Every name in settings is unique: no group, page or section title repeats another anywhere (`settingsRegistry.test.ts` checks this), and a page's content sits 24px from the sidebar edge, like its header; an installed extension's section takes the extension's name.

- Each section is a plain header over one panel: a rounded, bordered box with hairlines between rows (`settingsPanelClass`), and every control right-aligned to one shared edge. The compact density inside the setup wizard stays a plain list, because the wizard is its own card. A row is a label, an optional one-line muted hint and one control on the right; sections carry no paragraph of their own, and a section never holds a lone toggle. Hints say what is not obvious (scope, privacy, what is lost) in one short line and never repeat the label. Rarely changed and diagnostic options go on Advanced. Reset appears only while a value differs from its default and never moves the control. Up to four short choices use a segmented control; longer lists use a checkmarked dropdown, never a stack of radio buttons. Failures show as an inline notice in plain language, never raw setting keys or server errors.

- Settings belong to the device: they are saved in `misty.db` and never sync. Do not add account-synced settings, outboxes, or "Settings sync" surfaces. Server-owned resources (conversation retention) keep their own APIs and are not settings. Device identity and OS keychain secrets stay distinct from preferences.
- The website's account settings (`src/components/settings/` in misty-website) use the same sidebar and panels. There is no shared package, so a change to one goes to the other.
- Profile (group Account) is the signed-in account, changed in the app through the server's `/me` routes rather than on the website. It is account data, not a setting: it never touches `misty.db`. Changing the password stays on Sync, because the vault is encrypted with it. Billing stays on the website.
- Server (group Account) says which Misty server this device uses, with **Change** (the setup wizard) and **Leave server** (browse only). The choice is a device setting in its own `settings_state` scope, `device:server` (`src/api/deployment/serverChoice.ts`): `{mode: "server", url}` or `{mode: "none"}`. With none, Misty is the browser only and signed out; a development build uses `VITE_MISTY_PUBLIC_API_URL` (or the local stack) until someone chooses. Changing or leaving a server signs out of it and forgets its saved accounts.
- There are no usage analytics or crash report settings: Misty sends neither (PostHog was removed October 31, 2026). The old `privacy.anonymous_usage_analytics_enabled` and `privacy.anonymous_error_reporting_enabled` keys are pruned (settings schema 11, `src-tauri/src/infra/settings/migration.rs`).
- Models (group Agents) has the model account sign-ins (Sign in with ChatGPT, Sign in with OpenRouter), the provider and its key, the model choices, a check of the agent model, and Search (the search service, Decodo or Serper, and its key; [byok.md](../byok.md#web-search)). Its choices live in the `models` section (`models.provider`, `models.agent_model`, `models.fast_model`, `models.embedding_model`, `models.reasoning`, `models.search_provider`, `models.speech_model`, `models.transcription_model`, and the Ollama and OpenAI-compatible base URLs, which default to `127.0.0.1` because this computer calls them). Provider keys, the search keys among them (`decodo`, `serper`), are in the credential store under `com.misty.models`, one entry per provider, and the ChatGPT sign-in under `com.misty.models.chatgpt`; the renderer can add, replace or remove a key and learn which providers have one, never read a key back. A pasted key's provider is found from its prefix and confirmed by listing that provider's models (`src-tauri/src/infra/models/catalog.rs`). The wizard's model step is the same page in small (`ModelSetupPanel`).

