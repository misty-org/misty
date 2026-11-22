import { useEffect, useMemo, useRef } from "react";
import { useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { DictationController as Controller } from "./dictationEngine";
import { useSpeechSupport } from "./speech";
import { watchSpeechSetup } from "./speechModels";
import { voiceSettings } from "./voiceSettings";

/**
 * Mounts dictation in the main window while the account is signed in, and keeps speech set up
 * (`speechModels.ts`: Misty's pick of the hearing model, installed in the background). The
 * native shortcut is registered only while Settings › Voice › Dictation is on, and only once the
 * hearing model is on this computer.
 */
export function DictationController() {
  const document = useSettingsStore((state) => state.settings?.document);
  const speech = useSpeechSupport();
  const recognizes = Boolean(speech?.recognition);
  const settings = useMemo(() => {
    const chosen = voiceSettings(document);
    return { ...chosen, dictation: chosen.dictation && recognizes };
  }, [document, recognizes]);
  const controller = useRef<Controller | null>(null);
  const enabled = hasTauriInternals();

  useEffect(() => (enabled ? watchSpeechSetup() : undefined), [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const instance = new Controller(settings);
    controller.current = instance;
    void instance.start().catch(() => {});
    return () => {
      instance.dispose();
      controller.current = null;
    };
    // Settings changes reconfigure the running controller below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    void controller.current?.configure(settings).catch(() => {});
  }, [settings]);

  return null;
}
