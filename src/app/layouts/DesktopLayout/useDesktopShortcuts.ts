import { useMistyPanelStore } from "@/features/agents";
import { openSignInSheet, openSignOutSheet } from "@/features/account";
import { useShortcutHandler } from "@/features/shortcuts";
import { useCallback } from "react";

/** App-level keyboard shortcut handlers for the desktop shell. */
export function useDesktopShortcuts(options: {
  openSettingsOverlay: () => void;
  /** Someone is signed in; agents and new Spaces need an account. */
  signedIn: boolean;
}) {
  const { openSettingsOverlay, signedIn } = options;
  useShortcutHandler(
    "account.sign_in",
    useCallback(() => openSignInSheet("account"), []),
    !signedIn,
  );
  useShortcutHandler("account.sign_out", openSignOutSheet, signedIn);
  useShortcutHandler("app.open_settings", openSettingsOverlay);
  useShortcutHandler(
    "misty.contextual_companion",
    useCallback(() => useMistyPanelStore.getState().toggle(), []),
  );
  useShortcutHandler(
    "navigation.refresh",
    useCallback(() => window.dispatchEvent(new Event("misty:refresh-focused-tool")), []),
  );
}
