import type { SettingsSection } from "./settingsTypes";

/**
 * Where a preference's row lands. Kept apart from the registry (which imports every page) so
 * the preference store can resolve rows without importing the pages themselves.
 */

/** Preferences whose row sits in a different block from the page their definition names. */
const preferenceRowSection: Readonly<Record<string, SettingsSection>> = {
  "app.appearance.dim_inactive_panes": "advanced",
  "app.appearance.pane_dim_strength": "advanced",
  "app.appearance.compact_mode_enabled": "advanced",
};

/** The block that shows a preference's row. */
export function preferenceSection(id: string, page: string): SettingsSection {
  return preferenceRowSection[id] ?? (page as SettingsSection);
}

/**
 * Stored preferences with no row on any page: layout data saved by other surfaces, and options
 * hidden to keep Settings short. Search skips them so a result always lands on a visible row.
 */
export const preferencesWithoutRows: ReadonlySet<string> = new Set([
  "app.layout.presets",
  "app.shortcuts.bindings",
  "collections.tabs.space",
  "collections.tabs.journal",
  "collections.tabs.library",
]);
