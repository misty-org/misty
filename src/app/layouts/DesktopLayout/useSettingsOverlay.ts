import {
  blockIfUnsaved,
  openSettingsEvent,
  useSettingsStore,
  type OpenSettingsDetail,
} from "@/features/settings";
import { useCallback, useEffect, useState } from "react";

/** Settings overlay open state, its window events and the way to the account's page. */
export function useSettingsOverlay(options: { refreshUser: () => Promise<unknown> }) {
  const { refreshUser } = options;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const refreshUserAfterSettings = useCallback(() => {
    void refreshUser().catch(() => undefined);
  }, [refreshUser]);
  const openSettingsOverlay = useCallback(() => {
    setSettingsOpen(true);
  }, []);
  const closeSettingsOverlay = useCallback(() => {
    // Unsaved changes keep settings open; the save bar says why.
    if (blockIfUnsaved()) return;
    setSettingsOpen(false);
    refreshUserAfterSettings();
  }, [refreshUserAfterSettings]);
  const openAccountSettings = useCallback(() => {
    useSettingsStore.getState().setActiveSection("account");
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const detail = (event as CustomEvent<OpenSettingsDetail | null>).detail;
      if (detail?.section) {
        useSettingsStore.getState().setActiveSection(detail.section, detail.focus);
      }
      openSettingsOverlay();
    };
    const handleCloseSettings = () => {
      closeSettingsOverlay();
    };
    window.addEventListener(openSettingsEvent, handleOpenSettings);
    window.addEventListener("misty:close-settings", handleCloseSettings);
    return () => {
      window.removeEventListener(openSettingsEvent, handleOpenSettings);
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
