import type { MultiPanelStoreHook, MultiPanelTab, WorkspaceTab } from "@/features/workspace";
import { useMultiPanelStore, useWorkspaceStore } from "@/features/workspace";
import type { PluginTabState } from "../../model/types/workspace/ExplorerDesktopPlugins";

const transfersTabPath = "misty-transfers://history";
const remotesTabPath = "misty-remotes://manage";
const pluginTabProtocol = "misty-plugin:";

export function isRemotesTabPath(path: string): boolean {
  return path === remotesTabPath;
}

export function isChromeTabPath(path: string): boolean {
  return isTransfersTabPath(path) || isRemotesTabPath(path);
}

export function canCloseExplorerTab(tab: MultiPanelTab, tabs: MultiPanelTab[]): boolean {
  if (isChromeTabPath(tab.path)) return true;
  return tabs.some((candidate) => candidate.id !== tab.id && !isChromeTabPath(candidate.path));
}

export function ensureFilesBrowseTab(
  fallbackPath: string,
  store: MultiPanelStoreHook = useMultiPanelStore,
): boolean {
  const path = fallbackPath.trim();
  if (!path || isChromeTabPath(path)) return false;

  const workspace = store.getState();
  if (workspace.tabs.length === 0 || workspace.tabs.some((tab) => !isChromeTabPath(tab.path))) {
    return false;
  }

  workspace.addTab(path, "Home");
  return true;
}

export function canOpenTerminalPath(path: string): boolean {
  const trimmed = path.trim();
  return Boolean(trimmed) && !trimmed.includes("://");
}

export function openTransfersTab(): WorkspaceTab {
  const workspace = useWorkspaceStore.getState();
  return workspace.openSurface({
    surfaceId: "transfers",
    groupKey: "tool:transfers",
    title: "Transfers",
    route: "/transfers",
    instancePolicy: "single",
    paneId: workspace.layout.focusedPaneId,
  });
}

/**
 * Leaves a chrome tab for an ordinary browse tab.
 *
 * The embedded file manager hides its own tab strip because the dock supplies
 * one, so a chrome tab like Remotes has no visible way back. Falls back to
 * opening a browse tab when every remaining tab is chrome.
 */
export function returnToBrowseTab(
  fallbackPath: string,
  store: MultiPanelStoreHook = useMultiPanelStore,
): void {
  const browseTab = store.getState().tabs.find((tab) => !isChromeTabPath(tab.path));
  if (browseTab) {
    store.getState().selectTab(browseTab.id);
    return;
  }
  store.getState().addTab(fallbackPath, titleForBrowsePath(fallbackPath));
}

function titleForBrowsePath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || "Home";
}

export function toggleActiveTabPanelVisibility(panel: "sidebar" | "preview"): void {
  const multi = useMultiPanelStore.getState();
  const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId) ?? multi.tabs[0];
  if (!activeTab || isChromeTabPath(activeTab.path)) return;
  if (panel === "sidebar") {
    multi.setTabPanelVisibility(activeTab.id, {
      sidebarVisible: !(activeTab.sidebarVisible ?? true),
    });
  } else {
    multi.setTabPanelVisibility(activeTab.id, {
      previewVisible: !(activeTab.previewVisible ?? true),
    });
  }
}

export function parsePluginTabPath(path: string): PluginTabState | null {
  if (!path.startsWith(pluginTabProtocol)) return null;
  try {
    const url = new URL(path);
    const pluginId = url.searchParams.get("plugin") ?? "";
    if (!pluginId) return null;
    return {
      kind: url.hostname === "commands" ? "commands" : "panel",
      pluginId,
      panelId: url.searchParams.get("panel") ?? "",
      selectedPath: url.searchParams.get("selected") ?? "",
    };
  } catch {
    return null;
  }
}
export function isTransfersTabPath(path: string): boolean {
  return path === transfersTabPath;
}
