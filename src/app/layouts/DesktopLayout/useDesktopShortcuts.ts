import { useMistyPanelStore } from "@/features/agents";
import { useAppStore } from "@/features/app-shell";
import { openSignInSheet, openSignOutSheet } from "@/features/auth";
import { useBrowserSearchStore } from "@/features/browser-sync/search";
import { registerShortcutHandler, useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { useCallback, useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";

/** App-level keyboard shortcut handlers for the desktop shell. */
export function useDesktopShortcuts(options: {
  navigate: NavigateFunction;
  openSettingsOverlay: () => void;
  /** Someone is signed in; agents and new Spaces need an account. */
  signedIn: boolean;
}) {
  const { navigate, openSettingsOverlay, signedIn } = options;
  useShortcutHandler(
    "account.sign_in",
    useCallback(() => openSignInSheet("account"), []),
    !signedIn,
  );
  useShortcutHandler("account.sign_out", openSignOutSheet, signedIn);
  // Signed in, the Space row's menu makes the Space; signed out, Spaces need an account.
  useShortcutHandler(
    "workspace.new_space",
    useCallback(() => openSignInSheet("space"), []),
    !signedIn,
  );
  useShortcutHandler(
    "search.toggle",
    useCallback(() => useBrowserSearchStore.getState().toggle(), []),
  );
  useShortcutHandler("app.open_settings", openSettingsOverlay);
  useShortcutHandler(
    "misty.contextual_companion",
    useCallback(
      () => (signedIn ? useMistyPanelStore.getState().toggle() : openSignInSheet("agents")),
      [signedIn],
    ),
  );
  useShortcutHandler(
    "navigation.refresh",
    useCallback(() => window.dispatchEvent(new Event("misty:refresh-focused-tool")), []),
  );

  const focusTool = useCallback(
    (tool: string) => {
      const route = `/${tool}`;
      const request = workspaceSurfaceFromRoute(route);
      if (!request) {
        useAppStore.getState().setError(`${tool} is not available in this workspace.`);
        return;
      }
      const tab = useWorkspaceStore.getState().openDestination(request);
      navigate(tab.route, { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    const tools = ["browser"];
    const unregister = tools.map((tool) =>
      registerShortcutHandler(`tool.${tool}`, () => focusTool(tool)),
    );
    return () => unregister.forEach((remove) => remove());
  }, [focusTool]);
}
