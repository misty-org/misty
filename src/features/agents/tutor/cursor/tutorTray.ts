import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openSettings } from "@/features/settings";
import { invoke } from "@/native/invoke";
import { companionAvailable, setCompanionOn, useCompanionOn } from "./companionOn";
import { useTutorSetup } from "./tutorSetup";

/** Tutor's settings block, where the menu bar sends the person to set it up. */
const tutorSettingsSection = "agents-companion";

/**
 * Tutor in the menu bar (`src-tauri/features/app/tray.rs`): this main window tells the menu what
 * Tutor is, and does what the person chooses there. Choosing Tutor turns it on or off, or opens
 * its setup when it isn't set up; Tutor settings opens its page.
 */
function useTutorTray(on: boolean | undefined, ready: boolean | undefined): void {
  const state = useRef({ on, ready });
  state.current = { on, ready };

  useEffect(() => {
    if (!companionAvailable() || on === undefined || ready === undefined) return;
    void invoke("cursor_companion_tray", { on, ready }).catch(() => undefined);
  }, [on, ready]);

  useEffect(() => {
    if (!companionAvailable()) return;
    const window = getCurrentWindow();
    const removers = [
      window.listen("misty://tray-tutor-toggle", () => {
        const { on: current, ready: set } = state.current;
        if (current === undefined) return;
        if (!set) return openSettings(tutorSettingsSection);
        void setCompanionOn(!current).catch(() => undefined);
      }),
      window.listen("misty://tray-tutor-settings", () => openSettings(tutorSettingsSection)),
    ];
    return () => removers.forEach((remove) => void remove.then((stop) => stop()));
  }, []);
}

/** Keeps the menu bar's Tutor item in step with this main window. Mounted beside the companion. */
export function TutorTraySync(): null {
  useTutorTray(useCompanionOn(), useTutorSetup().ready);
  return null;
}
