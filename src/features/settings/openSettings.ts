import type { SettingsSection } from "./settingsTypes";

export const openSettingsEvent = "misty:open-settings";

export interface OpenSettingsDetail {
  /** The block to show; its page opens and scrolls to it. */
  section?: SettingsSection;
  /** A row on that page, by its label, to scroll to and highlight. */
  focus?: string;
}

/** Opens the Settings overlay, optionally on one block or row. */
export function openSettings(section?: SettingsSection, focus?: string) {
  window.dispatchEvent(
    new CustomEvent<OpenSettingsDetail>(openSettingsEvent, { detail: { section, focus } }),
  );
}
