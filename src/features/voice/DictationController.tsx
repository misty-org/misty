import { useEffect, useMemo, useRef } from "react";
import { useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { DictationController as Controller } from "./dictation_engine";
import { useSpeechSupport } from "./speech";
import { watchSpeechSetup } from "./speech_models";
import { voiceSettings } from "./voice_settings";

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
