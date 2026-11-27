import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openSettings } from "@/features/settings";
import { invoke } from "@/native/invoke";
import { companionAvailable, setCompanionOn, useCompanionOn } from "./companion_on";
import { useTutorSetup } from "./tutor_setup";
import { notify } from "@misty/ui";

const tutorSettingsSection = "agents-companion";

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
        void setCompanionOn(!current).catch(() =>
          notify({
            message: current ? "Couldn't turn the tutor off." : "Couldn't turn the tutor on.",
            tone: "error",
          }),
        );
      }),
      window.listen("misty://tray-tutor-settings", () => openSettings(tutorSettingsSection)),
    ];
    return () => removers.forEach((remove) => void remove.then((stop) => stop()));
  }, []);
}

export function TutorTraySync(): null {
  useTutorTray(useCompanionOn(), useTutorSetup().ready);
  return null;
}
