import {
  effectiveValues,
  useDevicePreferences,
  writeDevicePreference,
} from "@/features/settings/preference_access";
import { hasTauriInternals } from "@/shared/platform/tauri";

const companionOnSetting = "agents.companion.on";

export const companionAvailable = () =>
  hasTauriInternals() && /Mac|Win/.test(globalThis.navigator?.platform ?? "");

export function useCompanionOn(): boolean | undefined {
  return useDevicePreferences((store) =>
    store.state ? effectiveValues(store.state)[companionOnSetting] !== false : undefined,
  );
}

export const setCompanionOn = (on: boolean) => writeDevicePreference(companionOnSetting, on);
