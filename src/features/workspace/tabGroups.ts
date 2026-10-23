import { singleViewTab } from "./layoutTabs";
import type { WorkspaceTab, WorkspaceScopeKey, WorkspaceView } from "./model";
import { createBrowserViewState } from "./model";
import { createBlankWorkspaceView } from "./workspaceDefaultView";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { isIncognitoWindow, windowSpaceScope } from "./spaceWindow";

export const tabGroupColors = {
  gray: "#a6a6ad",
  blue: "#8ab4f8",
  red: "#f28b82",
  yellow: "#fdd663",
  green: "#81c995",
  pink: "#ff8bcb",
  purple: "#c58af9",
  cyan: "#78d9ec",
  orange: "#fcad70",
} as const;
export type TabGroupColor = keyof typeof tabGroupColors;
export interface MistyTabGroup {
  id: string;
  name: string;
  color: TabGroupColor;
  scopeKey: WorkspaceScopeKey;
  /** Device-local UI state; no webviews are unmounted on collapse. */
  collapsed: boolean;
  /** Present only while closed. Private layouts are never saved. */
  savedTabs?: WorkspaceTab[];
}
export interface TabGroupState {
  tabGroups: MistyTabGroup[];
  /** Stable IDs make old saved-link migration idempotent, including after deletion. */
  migratedTabGroupIds: string[];
}
export interface TabGroupActions {
  createTabGroup(tabIds: string[], name?: string, color?: TabGroupColor): string | null;
  updateTabGroup(id: string, patch: Partial<Pick<MistyTabGroup, "name" | "color">>): void;
  toggleTabGroup(id: string): WorkspaceView | null;
  addTabToGroup(tabId: string, groupId: string | null): void;
  ungroupTabs(id: string): void;
  closeTabGroup(id: string, save?: boolean): boolean;
  reopenTabGroup(id: string): WorkspaceView | null;
  deleteSavedTabGroup(id: string): void;
  newTabInGroup(id: string): WorkspaceView | null;
  moveTabGroupItem(id: string, target: string, after: boolean): void;
}
export const initialTabGroups = (): TabGroupState => ({ tabGroups: [], migratedTabGroupIds: [] });

/** Pinned tabs first, then each group as a single contiguous block, keeping order within. */
export function contiguousTabs(input: WorkspaceTab[]): WorkspaceTab[] {
  const tabs = [...input.filter((tab) => tab.pinnedUrl), ...input.filter((tab) => !tab.pinnedUrl)];
  const seen = new Set<string>();
  return tabs.flatMap((tab) => {
    if (!tab.tabGroupId) return [tab];
    if (seen.has(tab.tabGroupId)) return [];
    seen.add(tab.tabGroupId);
    return tabs.filter((item) => item.tabGroupId === tab.tabGroupId);
  });
}
export function migrateSavedLinkGroups(
  state: Pick<WorkspaceStore, "bookmarkFolders" | "bookmarks"> & Partial<TabGroupState>,
): TabGroupState {
  const tabGroups = [...(state.tabGroups ?? [])],
    migrated = new Set(state.migratedTabGroupIds ?? []);
  for (const folder of state.bookmarkFolders) {
    if (migrated.has(folder.id)) continue;
    migrated.add(folder.id);
    const sites = state.bookmarks
      .filter((s) => s.fields.folder_id === folder.id)
      .sort((a, b) => a.fields.order - b.fields.order);
    if (!sites.length) continue;
    const id = `tabgroup:${folder.id}`;
    if (tabGroups.some((g) => g.id === id)) continue;
    tabGroups.push({
      id,
      name: folder.fields.label,
      color: "blue",
      collapsed: false,
      scopeKey: windowSpaceScope(),
      savedTabs: sites.map((site) => {
        const tab = createBlankWorkspaceView(windowSpaceScope());
        const view = {
          ...tab,
          id: `saved:${site.id}`,
          instanceKey: `saved:${site.id}`,
          title: site.fields.title,
          state: createBrowserViewState(site.fields.url),
        };
        return { ...singleViewTab(view), tabGroupId: id };
      }),
    });
  }
  return { tabGroups, migratedTabGroupIds: [...migrated] };
}
/** An incognito window never saves its pages or history through a group. */
export const savableGroupTabs = (tabs: WorkspaceTab[]) =>
  tabs
    .filter(() => !isIncognitoWindow())
    .map((t) => ({
      ...t,
      root: stripHistory(t.root),
    }));
function stripHistory(node: WorkspaceTab["root"]): WorkspaceTab["root"] {
  return node.type === "split"
    ? { ...node, first: stripHistory(node.first), second: stripHistory(node.second) }
    : { ...node, history: undefined };
}

export { tabGroupActions } from "./tabGroupActions";
