import { dockLeaves, useWorkspaceStore, type MultiPanelStoreHook } from "@/features/workspace";
import { useCallback, useEffect, useRef } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useExplorerStore } from "../../store";
import {
  revealSearchResultInPane,
  searchResultNavigationTarget,
} from "../../utils/searchNavigation";
import { takeFilesTabReveal } from "./filesTabReveal";

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
      .flatMap((pane) => pane.views)
      .find((entry) => entry.id === options.workspaceId);
    if (
      tab &&
      new URL(tab.route, "https://misty.local").searchParams.get("view") === "transfers" &&
      !(tab.state && typeof tab.state === "object" && "path" in tab.state)
    )
      return "misty-transfers://history";
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

    const reveal = takeFilesTabReveal(options.workspaceId);
    if (reveal) {
      void revealSearchResultInPane(options.activePaneId, searchResultNavigationTarget(reveal));
      return;
    }
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
      .flatMap((pane) => pane.views)
      .find((entry) => entry.id === options.workspaceId);
    if (!tab) return;
    const storedPath =
      tab.state && typeof tab.state === "object" ? (tab.state as { path?: unknown }).path : null;
    const url = new URL(tab.route, "https://misty.local");
    if (options.activePath === "misty-transfers://history")
      url.searchParams.set("view", "transfers");
    else if (url.searchParams.get("view") === "transfers") url.searchParams.delete("view");
    const route = `/files${url.search}`;
    if (route !== tab.route) workspace.updateViewRoute(tab.id, route, true);
    if (storedPath === options.activePath) return;
    workspace.updateViewState(
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
      workspace.focusView(tab.id);
      navigate(tab.route);
    },
    [navigate],
  );
}

function fileTabTitle(path: string): string {
  if (path === "misty-transfers://history") return "Transfers";
  const normalized = path.replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? "Files";
}
