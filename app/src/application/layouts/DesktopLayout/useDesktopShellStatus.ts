import { desktopPetEvents, type DesktopMistyAppAction } from "@/features/desktop-pet";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { invokeShortcutCommand } from "@/features/shortcuts";
import { useWorkspaceStore } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

export function useDesktopShellStatus(navigate: (href: string) => void) {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let remove: (() => void) | undefined;
    void listen<DesktopMistyAppAction>(desktopPetEvents.appAction, ({ payload }) => {
      if (payload.type === "navigate") {
        navigate(payload.href);
        return;
      }
      if (payload.tabId) useWorkspaceStore.getState().focusTab(payload.tabId);
      else if (payload.commandId) invokeShortcutCommand(payload.commandId);
    }).then((unlisten) => {
      remove = unlisten;
    });
    return () => remove?.();
  }, [navigate]);

  return useSettingsStore((state) =>
    settingsBoolean(
      state.settings?.document ?? {},
      "advanced",
      "frame_pacing_overlay_enabled",
      false,
    ),
  );
}
