import { booleanSetting, stringSetting } from "@/features/settings/SettingsControls";
import type { RecallPrivacy } from "./recorder/privacy";

/** Pausing "until I resume" stores the largest safe time. */
export const PAUSED_UNTIL_RESUMED = Number.MAX_SAFE_INTEGER;

export interface RecallSettings extends RecallPrivacy {
  rememberDictation: boolean;
}

/** Settings › Memory, read from the device's settings document. */
export function recallSettings(document: Record<string, unknown> | undefined): RecallSettings {
  const doc = document ?? {};
  const section = (doc.recall ?? {}) as Record<string, unknown>;
  const paused = Number(section.paused_until ?? 0);
  return {
    enabled: booleanSetting(doc, "recall", "enabled", false),
    pausedUntil: Number.isFinite(paused) && paused > 0 ? paused : 0,
    excludedSites: stringSetting(doc, "recall", "excluded_sites", "")
      .split("\n")
      .map((site) => site.trim())
      .filter(Boolean)
      .slice(0, 500),
    rememberDictation: booleanSetting(doc, "recall", "remember_dictation", true),
  };
}
