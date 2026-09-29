import { useEffect, useMemo, useRef } from "react";
import { publicBetaFeatureEnabled } from "@/features/launch";
import { useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { DictationController as Controller } from "./dictationEngine";
import { voiceSettings } from "./voiceSettings";

/**
 * Mounts dictation in the main window while the account is signed in. The
 * native shortcut is registered only while Settings › Voice › Dictation is on.
 */
export function DictationController() {
  const document = useSettingsStore((state) => state.settings?.document);
  const settings = useMemo(() => voiceSettings(document), [document]);
  const controller = useRef<Controller | null>(null);
  const enabled = publicBetaFeatureEnabled("voiceDictation") && hasTauriInternals();

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
