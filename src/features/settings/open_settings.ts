import { create } from "zustand";
import type { SettingsSection } from "./settings_types";

export const openSettingsEvent = "misty:open-settings";

export interface OpenSettingsDetail {
  section?: SettingsSection;
  focus?: string;
}

export function openSettings(section?: SettingsSection, focus?: string) {
  window.dispatchEvent(
    new CustomEvent<OpenSettingsDetail>(openSettingsEvent, { detail: { section, focus } }),
  );
}

export const useSettingsOpen = create<{ open: boolean }>(() => ({ open: false }));
