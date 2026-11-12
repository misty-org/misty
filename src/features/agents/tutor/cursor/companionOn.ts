import {
  effectiveValues,
  useDevicePreferences,
  writeDevicePreference,
} from "@/features/settings/preferenceAccess";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** The device setting that turns the cursor tutor on or off. On unless the person turns it off. */
export const companionOnSetting = "agents.companion.on";

/** Whether this device can run the cursor tutor at all: Misty for macOS or Windows. */
export const companionAvailable = () =>
  hasTauriInternals() && /Mac|Win/.test(globalThis.navigator?.platform ?? "");

/** Whether the cursor tutor is on, or undefined while this device's settings load. */
export function useCompanionOn(): boolean | undefined {
  return useDevicePreferences((store) =>
    store.state ? effectiveValues(store.state)[companionOnSetting] !== false : undefined,
  );
}

/** Turns the cursor tutor on or off on this device. */
export const setCompanionOn = (on: boolean) => writeDevicePreference(companionOnSetting, on);
