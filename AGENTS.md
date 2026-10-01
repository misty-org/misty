# UI conventions

- Shared dropdown and context-menu selections use checkmarks, never dot indicators. Collection toolbars must not add a filter menu that duplicates their visible section tabs.
- Use the approved black, white and gray palette. Do not introduce green, sage, colored status dots, tinted selections or accent-colored focus rings unless the user explicitly requests color for that surface. Convey status through text and icons as well as contrast.
- Preserve the existing settings sidebar geometry, Search field, Lucide icons and group dividers. No Account footer, nested disclosures or tab strips. Each area opens a cohesive scrolling page with small, muted section headers.
- `src/features/settings/settingsRegistry.tsx` is the single settings navigation registry. Use `DesktopSettingsSection`, `DesktopSettingsRow` and `SettingsControls` for settings UI. Area names must not contain ampersands; each area has a unique icon.
- Settings changes belong to the account on the server. Do not add Local only modes, device-only overrides, profile pickers or scope badges. Device identity and OS vault secrets are distinct from account preferences; never upload unlock secrets as ordinary settings.
- Approved Sync direction: `docs/design/sync/BRIEF.md`, revision 2, including the approved monochrome palette and server-account settings model. Historical mockup screenshots do not override these instructions.
