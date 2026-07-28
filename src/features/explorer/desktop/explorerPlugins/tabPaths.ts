import type { PluginTabState } from "@/models/types/features/explorer/desktop/ExplorerDesktopPlugins";
import type { MultiPanelTab } from "@/models/interfaces/workspace";
import type { MultiPanelStoreHook } from "@/models/types/workspace/useMultiPanelStore";
import { useMultiPanelStore } from "@/features/workspace";

const transfersTabPath = "misty-transfers://history";
const remotesTabPath = "misty-remotes://manage";
const pluginTabProtocol = "misty-plugin:";

export function isTransfersTabPath(path: string): boolean {
  return path === transfersTabPath;
}

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

export function openTransfersTab(): void {
  const multi = useMultiPanelStore.getState();
  const existing = multi.tabs.find((tab) => isTransfersTabPath(tab.path));
  if (existing) {
    multi.selectTab(existing.id);
    return;
  }
  const tabId = multi.addTab(transfersTabPath, "Transfers");
  useMultiPanelStore
    .getState()
    .setTabPanelVisibility(tabId, { sidebarVisible: false, previewVisible: false });
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
