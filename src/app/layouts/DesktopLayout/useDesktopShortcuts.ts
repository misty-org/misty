import { useMistyPanelStore } from "@/features/agents";
import { useAppStore } from "@/features/app-shell";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { useGlobalSearchStore } from "@/features/global-search";
import { registerShortcutHandler, useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { useCallback, useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";

/** App-level keyboard shortcut handlers for the desktop shell. */
export function useDesktopShortcuts(options: {
  navigate: NavigateFunction;
  openSettingsOverlay: () => void;
}) {
  const { navigate, openSettingsOverlay } = options;
  const openLauncher = useCallback((commandsOnly = false) => {
    const launcher = useGlobalSearchStore.getState();
    if (commandsOnly) {
      launcher.setQuery(">");
      launcher.activateLauncher();
    } else {
      launcher.togglePanel();
    }
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>("[data-global-misty-launcher-input]")?.focus(),
      0,
    );
  }, []);
  useShortcutHandler(
    "search.toggle",
    useCallback(() => useBrowserSearchStore.getState().toggle(), []),
  );
  useShortcutHandler(
    "app.command_palette",
    useCallback(() => openLauncher(true), [openLauncher]),
  );
  useShortcutHandler("app.open_settings", openSettingsOverlay);
  useShortcutHandler(
    "misty.contextual_companion",
    useCallback(() => useMistyPanelStore.getState().toggle(), []),
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
    const tools = ["browser", "agents"];
    const unregister = tools.map((tool) =>
      registerShortcutHandler(`tool.${tool}`, () => focusTool(tool)),
    );
    return () => unregister.forEach((remove) => remove());
  }, [focusTool]);
}
