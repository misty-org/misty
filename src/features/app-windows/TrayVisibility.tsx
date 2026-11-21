import { invoke } from "@/native/invoke";
import { useEffect } from "react";
import { useTrayHidden } from "@/shared/lib/trayHidden";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Applies the menu bar icon choice once this device's settings are read, and when it changes. */
export function TrayVisibility() {
  const hidden = useTrayHidden((state) => state.value);
  const loaded = useTrayHidden((state) => state.loaded);
  useEffect(() => {
    if (!loaded || !hasTauriInternals()) return;
    void invoke("app_set_tray_hidden", { hidden }).catch(() => undefined);
  }, [hidden, loaded]);
  return null;
}
