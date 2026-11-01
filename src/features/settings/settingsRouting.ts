import type { SettingsSection } from "./settingsTypes";

/**
 * Where a Settings section id lands. Kept apart from the registry (which imports every page) so
 * the preference store can resolve rows without importing the pages themselves.
 */

/** Sections that no longer exist on their own resolve to the block that holds them now. */
const retiredSections: Partial<Record<SettingsSection, SettingsSection>> = {
  account: "about",
  support: "about",
  diagnostics: "advanced",
  search: "browser-links",
  browser: "browser-links",
  "browser-appearance": "advanced",
  layout: "appearance",
  "browser-privacy": "privacy",
  "browser-signins": "passwords",
  profiles: "sync",
  "browser-handoff": "sync",
  "browser-import": "general",
  "spaces-defaults": "general",
  "spaces-manage": "general",
  "files-locations": "general",
  "files-indexing": "general",
  social: "general",
  journal: "general",
  library: "general",
  terminal: "general",
  code: "agents-coding",
  agents: "agents-defaults",
};

export function canonicalSettingsSection(section: SettingsSection): SettingsSection {
  return retiredSections[section] ?? section;
}

/** Preferences whose row sits in a different block from the page their definition names. */
const preferenceRowSection: Readonly<Record<string, SettingsSection>> = {
  "app.updates.automatic": "updates",
  "app.diagnostics.framePacing": "advanced",
  "app.appearance.dim_inactive_panes": "advanced",
  "app.appearance.pane_dim_strength": "advanced",
  "app.appearance.compact_mode_enabled": "advanced",
  "browser.hiddenTabSleep": "advanced",
};

/** The block that shows a preference's row. */
export function preferenceSection(id: string, page: string): SettingsSection {
  return preferenceRowSection[id] ?? canonicalSettingsSection(page as SettingsSection);
}

/**
 * Stored preferences with no row on any page: layout data saved by other surfaces, and options
 * hidden to keep Settings short. Search skips them so a result always lands on a visible row.
 */
export const preferencesWithoutRows: ReadonlySet<string> = new Set([
  "app.tabs.startPage",
  "app.layout.presets",
  "app.shortcuts.bindings",
  "browser.searchEngine",
  "browser.customBangs",
  "browser.siteStyles",
  "browser.siteZoom",
  "collections.tabs.space",
  "collections.tabs.journal",
  "collections.tabs.library",
  "extensions.installations",
  "extensions.space_installations",
  "files.startingFolder",
  "spaces.openingTool",
]);
