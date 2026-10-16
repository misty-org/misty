import { openAccountSettingsInBrowser } from "@/features/account";
import { useAppStore } from "@/features/app-shell";
import { blockIfUnsaved, useSettingsStore, type SettingsSection } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallback, useEffect, useState } from "react";

/** Settings overlay open state, its window events and the account hand-off. */
export function useSettingsOverlay(options: {
  settingsLoad: () => Promise<unknown> | unknown;
  refreshUser: () => Promise<unknown>;
}) {
  const { settingsLoad, refreshUser } = options;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const refreshUserAfterSettings = useCallback(() => {
    void refreshUser().catch(() => undefined);
  }, [refreshUser]);
  const openSettingsOverlay = useCallback(() => {
    setSettingsOpen(true);
    if (hasTauriInternals() && !useSettingsStore.getState().loaded) void settingsLoad();
  }, [settingsLoad]);
  const closeSettingsOverlay = useCallback(() => {
    // Unsaved changes keep settings open; the save bar says why.
    if (blockIfUnsaved()) return;
    setSettingsOpen(false);
    refreshUserAfterSettings();
  }, [refreshUserAfterSettings]);
  // Account management lives on the website. Opening it hands the current
  // session off to the browser rather than rendering anything locally.
  const openAccountSettings = useCallback(() => {
    if (blockIfUnsaved()) return;
    setSettingsOpen(false);
    void openAccountSettingsInBrowser().catch((error: unknown) => {
      // The hand-off needs the network, so an offline click has to say so
      // rather than silently opening nothing.
      useAppStore
        .getState()
        .setError(
          error instanceof Error
            ? error.message
            : "Could not open account settings. Check your connection and try again.",
        );
    });
  }, []);

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const section = (event as CustomEvent<{ section?: SettingsSection }>).detail?.section;
      if (section) {
        useSettingsStore.getState().setActiveSection(section);
      }
      openSettingsOverlay();
    };
    const handleCloseSettings = () => {
      closeSettingsOverlay();
    };
    window.addEventListener("misty:open-settings", handleOpenSettings);
    window.addEventListener("misty:close-settings", handleCloseSettings);
    return () => {
      window.removeEventListener("misty:open-settings", handleOpenSettings);
      window.removeEventListener("misty:close-settings", handleCloseSettings);
    };
  }, [closeSettingsOverlay, openSettingsOverlay]);

  return {
    settingsOpen,
    setSettingsOpen,
    openSettingsOverlay,
    closeSettingsOverlay,
    openAccountSettings,
  };
}
