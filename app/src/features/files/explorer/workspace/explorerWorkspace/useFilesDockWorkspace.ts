import { dockLeaves, useMultiPanelStore, useWorkspaceStore } from "@/features/workspace";
import { useCallback, useEffect, useRef } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useExplorerStore } from "../../store";

interface FilesDockWorkspaceOptions {
  workspaceId?: string;
  activePaneId: string;
  activePath: string;
  initialized: boolean;
  embedded?: boolean;
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
    const multi = useMultiPanelStore.getState();
    const active = multi.tabs.find((tab) => tab.id === multi.activeTabId) ?? multi.tabs[0];
    if (active && multi.tabs.length > 1) {
      useMultiPanelStore.setState({
        tabs: [active],
        activeTabId: active.id,
        activePaneId: active.activePaneId,
        closedTabs: [],
        closedPanes: [],
      });
    }
    useMultiPanelStore.getState().collapseDuplicateBrowsePanes();
  }, [options.embedded, options.initialized]);

  useEffect(() => {
    if (!options.workspaceId || !options.activePaneId || !options.initialized) return;
    restoredTabRef.current = "";
    const desiredPath = dockTabPath;
    if (!desiredPath || desiredPath === options.activePath) {
      restoredTabRef.current = options.workspaceId;
      return;
    }
    let cancelled = false;
    void useExplorerStore
      .getState()
      .navigatePane(options.activePaneId, desiredPath)
      .finally(() => {
        if (!cancelled) restoredTabRef.current = options.workspaceId ?? "";
      });
    return () => {
      cancelled = true;
    };
  }, [
    options.activePaneId,
    options.activePath,
    options.initialized,
    options.workspaceId,
    dockTabPath,
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
