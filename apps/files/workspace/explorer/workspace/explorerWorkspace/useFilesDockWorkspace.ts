import { dockLeaves, useWorkspaceStore, type MultiPanelStoreHook } from "@/features/workspace";
import { useCallback, useEffect, useRef } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useExplorerStore } from "../../store";

interface FilesDockWorkspaceOptions {
  workspaceId?: string;
  activePaneId: string;
  activePath: string;
  initialized: boolean;
  embedded?: boolean;
  homePath: string;
  multiPanelStore: MultiPanelStoreHook;
  navigate: NavigateFunction;
}

export function useFilesDockWorkspace(options: FilesDockWorkspaceOptions) {
  const navigate = options.navigate;
  const dockTabPath = useWorkspaceStore((state) => {
    if (!options.workspaceId) return null;
    const tab = dockLeaves(state.layout.root)
      .flatMap((pane) => pane.tabs)
      .find((entry) => entry.id === options.workspaceId);
    if (!tab?.state || typeof tab.state !== "object") return null;
    const path = (tab.state as { path?: unknown }).path;
    return typeof path === "string" && path ? path : null;
  });
  const restoredTabRef = useRef("");

  useEffect(() => {
    if (!options.embedded) return;
    const multi = options.multiPanelStore.getState();
    if (multi.tabs.length === 0) {
      multi.initialize(dockTabPath || options.homePath, "Files");
    }
  }, [
    dockTabPath,
    options.embedded,
    options.homePath,
    options.initialized,
    options.multiPanelStore,
  ]);

  // Initial seed from dock tab state on mount or when switching tabs
  useEffect(() => {
    if (!options.workspaceId || !options.initialized || !options.activePaneId) return;
    if (restoredTabRef.current === options.workspaceId) return;
    restoredTabRef.current = options.workspaceId;

    const desiredPath = dockTabPath;
    if (desiredPath && desiredPath !== options.activePath) {
      void useExplorerStore.getState().navigatePane(options.activePaneId, desiredPath);
    }
  }, [
    dockTabPath,
    options.activePaneId,
    options.activePath,
    options.initialized,
    options.workspaceId,
  ]);

  useEffect(() => {
    if (
      !options.workspaceId ||
      restoredTabRef.current !== options.workspaceId ||
      !options.activePath
    )
      return;
    const workspace = useWorkspaceStore.getState();
    const tab = dockLeaves(workspace.layout.root)
      .flatMap((pane) => pane.tabs)
      .find((entry) => entry.id === options.workspaceId);
    if (!tab) return;
    const storedPath =
      tab.state && typeof tab.state === "object" ? (tab.state as { path?: unknown }).path : null;
    if (storedPath === options.activePath) return;
    workspace.updateTabState(
      tab.id,
      { version: 1, path: options.activePath },
      fileTabTitle(options.activePath),
    );
  }, [options.activePath, options.workspaceId]);

  return useCallback(
    (path: string, title?: string) => {
      const workspace = useWorkspaceStore.getState();
      const tab = workspace.openSurface({
        surfaceId: "files",
        groupKey: "tool:files",
        title: title || fileTabTitle(path),
        route: "/files",
        instancePolicy: "multiple",
        forceNew: true,
        paneId: workspace.layout.focusedPaneId,
        state: { version: 1, path },
      });
      workspace.focusTab(tab.id);
      navigate(tab.route);
    },
    [navigate],
  );
}

function fileTabTitle(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? "Files";
}
