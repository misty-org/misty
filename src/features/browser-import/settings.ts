import { useSettingsStore } from "@/features/settings";
import { normalizeBrowserHomeUrl } from "@/features/workspace";
import type { ImportedSettings } from "./native";

/**
 * Applies the settings Misty has an equivalent for to the account, and returns
 * what changed in the person's words.
 */
export function applyImportedSettings(settings: ImportedSettings) {
  const update = useSettingsStore.getState().updateSetting;
  const applied: string[] = [];
  const skipped: string[] = [];
  if (settings.homepage) {
    update("general", "browser_homepage", normalizeBrowserHomeUrl(settings.homepage));
    applied.push("your homepage");
  }
  if (typeof settings.restoreSession === "boolean") {
    update("general", "reopen_last_session", settings.restoreSession);
    applied.push(settings.restoreSession ? "reopening your last session" : "starting fresh");
  }
  return { applied, skipped };
}
