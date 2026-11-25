import type { SettingsSection } from "./settings_types";

const preferenceRowSection: Readonly<Record<string, SettingsSection>> = {
  "app.appearance.dim_inactive_panes": "display",
  "app.appearance.pane_dim_strength": "display",
  "app.appearance.compact_mode_enabled": "display",
  "app.appearance.reduce_motion": "display",
  "app.zoom": "display",
  "app.shortcuts.hints": "display",
  "browser.linkPreviews": "display",
  "app.diagnostics.framePacing": "diagnostics",
  "voice.language": "speech",
  "voice.hearing_model": "speech",
  "voice.dictionary": "speech",
  "voice.speaking_voice": "speaking",
  "voice.speaking_rate": "speaking",
  "voice.capture_sources": "listening",
  "agents.companion.size": "tutor-behavior",
  "agents.companion.ask": "tutor-behavior",
  "agents.companion.teach": "tutor-behavior",
  "agents.companion.tint": "tutor-behavior",
  "agents.companion.sprite": "tutor-behavior",
  "agents.companion.captions": "tutor-talking",
};

export function preferenceSection(id: string, page: string): SettingsSection {
  return preferenceRowSection[id] ?? (page as SettingsSection);
}

export const preferencesWithoutRows: ReadonlySet<string> = new Set([
  "app.layout.presets",
  "app.shortcuts.bindings",
]);
