import type { SettingsSection } from "./settings_types";

const preferenceRowSection: Readonly<Record<string, SettingsSection>> = {
  "app.appearance.dim_inactive_panes": "advanced",
  "app.appearance.pane_dim_strength": "advanced",
  "app.appearance.compact_mode_enabled": "advanced",
};

export function preferenceSection(id: string, page: string): SettingsSection {
  return preferenceRowSection[id] ?? (page as SettingsSection);
}

export const preferencesWithoutRows: ReadonlySet<string> = new Set([
  "app.layout.presets",
  "app.shortcuts.bindings",
]);
