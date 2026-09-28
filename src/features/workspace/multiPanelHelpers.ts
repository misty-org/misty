import { explorerPathName, normalizeExplorerPath } from "@/shared/lib/pathNormalization";
import type { MultiPanelLayout, MultiPanelPane, MultiPanelTab } from "./model/interfaces";
export function normalizedIdPrefix(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "multipanel"
  );
}

export function createTab(id: string, paneId: string, path: string, title: string): MultiPanelTab {
  const normalizedPath = normalizeExplorerPath(path);
  return {
    id,
    namingId: crypto.randomUUID(),
    title,
    path: normalizedPath,
    panes: [createPane(paneId, normalizedPath, title)],
    activePaneId: paneId,
    layout: defaultLayout(paneId),
    mode: "browse",
    sidebarVisible: true,
    previewVisible: true,
  };
}

export function createPane(id: string, path: string, title: string): MultiPanelPane {
  return { id, path: normalizeExplorerPath(path), title };
}

export function normalizeSnapshot(snapshot: {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  nextPaneIndex: number;
  nextTabIndex: number;
}): {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  nextPaneIndex: number;
  nextTabIndex: number;
} {
  const tabs = snapshot.tabs.map(normalizeTab).filter((tab): tab is MultiPanelTab => Boolean(tab));
  const fallback = tabs[0];
  if (!fallback) {
    return {
      tabs: [],
      activeTabId: "",
      activePaneId: "",
      nextPaneIndex: Math.max(1, snapshot.nextPaneIndex),
      nextTabIndex: Math.max(1, snapshot.nextTabIndex),
    };
  }
  const activeTab = tabs.find((tab) => tab.id === snapshot.activeTabId) ?? fallback;
  return {
    tabs,
    activeTabId: activeTab.id,
    activePaneId: activeTab.activePaneId,
    nextPaneIndex: Math.max(1, snapshot.nextPaneIndex),
    nextTabIndex: Math.max(1, snapshot.nextTabIndex),
  };
}

export function normalizeTab(tab: MultiPanelTab): MultiPanelTab | null {
  const panes = tab.panes
    .filter((pane) => Boolean(pane.id && pane.path))
    .map((pane) => ({ ...pane, path: normalizeExplorerPath(pane.path) }));
  if (panes.length === 0) return null;

  // Old split workspaces reopen at their focused location as a single file pane.
  const activePane = panes.find((pane) => pane.id === tab.activePaneId) ?? panes[0];
  const activePaneId = activePane.id;
  return {
    ...tab,
    namingId: tab.namingId || crypto.randomUUID(),
    mode: "browse",
    title: activePane.title,
    path: activePane.path,
    panes: [activePane],
    activePaneId,
    sidebarVisible: tab.sidebarVisible ?? true,
    previewVisible: tab.previewVisible ?? true,
    layout: defaultLayout(activePaneId),
  };
}

export function defaultLayout(paneId: string): MultiPanelLayout {
  return { orientation: "vertical", paneIds: [paneId], lanes: [[paneId]] };
}

export function titleFromPath(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  return explorerPathName(path) || "Home";
}
