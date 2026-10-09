import { dockTreeViews } from "./dockTree";
import { emptyTab, layoutTabs, activateTab, singleViewTab } from "./layoutTabs";
import type { WorkspaceTab, WorkspaceScopeKey, WorkspaceView } from "./model";
import { createBrowserViewState } from "./model";
import { isPrivateBrowserView } from "./privateBrowsing";
import { createBlankWorkspaceView } from "./workspaceDefaultView";
import { canCloseWorkspaceView } from "./workspaceViewOperations";
import { withActiveWindowLayout } from "./windows";
import type { WorkspaceStore } from "./useWorkspaceStore";

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
  moveTabGroupToNewWindow(id: string): WorkspaceView | null;
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
      scopeKey: "global",
      savedTabs: sites.map((site) => {
        const tab = createBlankWorkspaceView("global");
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
/** Never persist private pages or private history through a saved group. */
export const savableGroupTabs = (tabs: WorkspaceTab[]) =>
  tabs
    .filter((t) => !dockTreeViews(t.root).some(isPrivateBrowserView))
    .map((t) => ({
      ...t,
      root: stripHistory(t.root),
    }));
function stripHistory(node: WorkspaceTab["root"]): WorkspaceTab["root"] {
  return node.type === "split"
    ? { ...node, first: stripHistory(node.first), second: stripHistory(node.second) }
    : { ...node, history: undefined };
}

export function tabGroupActions(
  set: (patch: Partial<WorkspaceStore>) => void,
  get: () => WorkspaceStore,
): TabGroupActions {
  const applyTabs = (tabs: WorkspaceTab[], selected?: string) => {
    const state = get();
    if (!tabs.length) tabs = [emptyTab()];
    const id = selected && tabs.some((t) => t.id === selected) ? selected : tabs[0].id;
    set(
      withActiveWindowLayout(
        state,
        activateTab({ ...state.layout, tabs: contiguousTabs(tabs) }, id),
      ),
    );
  };
  const update = (id: string, patch: Partial<MistyTabGroup>) =>
    set({ tabGroups: get().tabGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  return {
    createTabGroup(tabIds, name = "New group", color = "blue") {
      const state = get(),
        selected = layoutTabs(state.layout).filter((t) => tabIds.includes(t.id));
      if (!selected.length) return null;
      const id = `tabgroup:${crypto.randomUUID()}`;
      set({
        tabGroups: [
          ...state.tabGroups,
          {
            id,
            name: name.trim().slice(0, 80),
            color,
            collapsed: false,
            scopeKey: state.activeScopeKey,
          },
        ],
      });
      applyTabs(
        layoutTabs(state.layout).map((t) => (tabIds.includes(t.id) ? { ...t, tabGroupId: id } : t)),
        state.layout.activeTabId,
      );
      return id;
    },
    updateTabGroup(id, patch) {
      update(id, {
        ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) } : {}),
        ...(patch.color && patch.color in tabGroupColors ? { color: patch.color } : {}),
      });
    },
    toggleTabGroup(id) {
      const state = get(),
        group = state.tabGroups.find((g) => g.id === id);
      if (!group) return null;
      if (!group.collapsed) {
        const tabs = layoutTabs(state.layout),
          active = tabs.find((t) => t.id === state.layout.activeTabId);
        if (active?.tabGroupId === id) {
          const next = tabs.find(
            (t) =>
              t.tabGroupId !== id && !state.tabGroups.find((g) => g.id === t.tabGroupId)?.collapsed,
          );
          if (next) state.selectTab(next.id);
          else state.newTab();
        }
      }
      update(id, { collapsed: !group.collapsed });
      return get().selectTab(get().layout.activeTabId!);
    },
    addTabToGroup(tabId, groupId) {
      const state = get(),
        tabs = layoutTabs(state.layout),
        tab = tabs.find((t) => t.id === tabId);
      if (
        !tab ||
        (groupId &&
          !state.tabGroups.some(
            (g) => g.id === groupId && !g.savedTabs && g.scopeKey === state.activeScopeKey,
          ))
      )
        return;
      // Groups belong to one window. Menus expose only this window's groups.
      if (groupId && !tabs.some((t) => t.tabGroupId === groupId)) return;
      let rest = tabs.filter((t) => t.id !== tabId);
      const peers = rest.filter((t) => t.tabGroupId === (groupId ?? tab.tabGroupId));
      const index = peers.length ? rest.indexOf(peers[peers.length - 1]) + 1 : tabs.indexOf(tab);
      rest = [
        ...rest.slice(0, index),
        { ...tab, tabGroupId: groupId ?? undefined },
        ...rest.slice(index),
      ];
      if (groupId) update(groupId, { collapsed: false });
      applyTabs(rest, state.layout.activeTabId);
    },
    ungroupTabs(id) {
      const state = get();
      applyTabs(
        layoutTabs(state.layout).map((t) =>
          t.tabGroupId === id ? { ...t, tabGroupId: undefined } : t,
        ),
        state.layout.activeTabId,
      );
      set({ tabGroups: get().tabGroups.filter((g) => g.id !== id) });
    },
    closeTabGroup(id, save = true) {
      if (!canCloseWorkspaceView()) return false;
      const state = get(),
        tabs = layoutTabs(state.layout),
        closing = tabs.filter((t) => t.tabGroupId === id);
      if (
        !closing.length ||
        closing.some((t) => dockTreeViews(t.root).some((view) => !canCloseWorkspaceView(view)))
      )
        return false;
      const savedTabs = save ? savableGroupTabs(closing) : [];
      // Check every pane before changing anything; cancellation is atomic.
      applyTabs(
        tabs.filter((t) => t.tabGroupId !== id),
        state.layout.activeTabId,
      );
      if (savedTabs.length) update(id, { savedTabs, collapsed: false });
      else set({ tabGroups: get().tabGroups.filter((g) => g.id !== id) });
      return true;
    },
    reopenTabGroup(id) {
      let state = get();
      const group = state.tabGroups.find((g) => g.id === id);
      if (!group || group.scopeKey !== state.activeScopeKey) return null;
      const owner = (state.windowsByScope[state.activeScopeKey] ?? []).find((w) =>
        layoutTabs(w.layout).some((t) => t.tabGroupId === id),
      );
      if (owner) {
        state.switchWindow(owner.id);
        update(id, { collapsed: false });
        return get().selectTab(layoutTabs(owner.layout).find((t) => t.tabGroupId === id)!.id);
      }
      if (!group.savedTabs?.length) return null;
      // Fresh identities avoid collisions with Recently closed and native webviews.
      const restored = group.savedTabs.map((tab) => {
        const panes = new Map<string, string>();
        const remap = (node: WorkspaceTab["root"]): WorkspaceTab["root"] => {
          const nodeId = `pane:${crypto.randomUUID()}`;
          panes.set(node.id, nodeId);
          if (node.type === "split")
            return { ...node, id: nodeId, first: remap(node.first), second: remap(node.second) };
          const views = node.views.map((view) => {
            const id = `tab:${crypto.randomUUID()}`;
            return {
              ...view,
              id,
              instanceKey: id,
              groupInstanceId: undefined,
              lastFocusedAt: Date.now(),
            };
          });
          return {
            ...node,
            id: nodeId,
            views: views,
            activeViewId:
              views[
                Math.max(
                  0,
                  node.views.findIndex((t) => t.id === node.activeViewId),
                )
              ]?.id ?? null,
            history: undefined,
          };
        };
        const root = remap(tab.root);
        return {
          ...tab,
          id: `layout:${crypto.randomUUID()}`,
          root,
          focusedPaneId: panes.get(tab.focusedPaneId)!,
          tabGroupId: id,
        };
      });
      state = get();
      update(id, { savedTabs: undefined, collapsed: false });
      applyTabs([...layoutTabs(state.layout), ...restored], restored[0].id);
      return get().selectTab(restored[0].id);
    },
    deleteSavedTabGroup(id) {
      set({ tabGroups: get().tabGroups.filter((g) => g.id !== id || !g.savedTabs) });
    },
    newTabInGroup(id) {
      const state = get();
      if (!layoutTabs(state.layout).some((t) => t.tabGroupId === id)) return null;
      const view = state.newTab();
      const tab = layoutTabs(get().layout).find((t) =>
        dockTreeViews(t.root).some((v) => v.id === view.id),
      );
      if (tab) get().addTabToGroup(tab.id, id);
      return view;
    },
    moveTabGroupToNewWindow(id) {
      const state = get(),
        moving = layoutTabs(state.layout).filter((t) => t.tabGroupId === id);
      if (!moving.length) return null;
      // A virtual-window move retains all running view identities and split trees.
      const sourceId = state.activeWindowId;
      const remaining = layoutTabs(state.layout).filter((t) => t.tabGroupId !== id);
      const sourceTabs = remaining.length ? remaining : [emptyTab()];
      const source = activateTab(
        { ...state.layout, tabs: sourceTabs },
        sourceTabs.some((t) => t.id === state.layout.activeTabId)
          ? state.layout.activeTabId!
          : sourceTabs[0].id,
      );
      state.createWindow();
      const current = get();
      const target = activateTab({ ...current.layout, tabs: moving }, moving[0].id);
      const windows = (current.windowsByScope[current.activeScopeKey] ?? []).map((w) =>
        w.id === sourceId
          ? { ...w, layout: source }
          : w.id === current.activeWindowId
            ? { ...w, layout: target }
            : w,
      );
      set({
        layout: target,
        layoutsByScope: { ...current.layoutsByScope, [current.activeScopeKey]: target },
        windowsByScope: {
          ...current.windowsByScope,
          [current.activeScopeKey]: windows,
        },
      });
      update(id, { collapsed: false });
      return get().selectTab(moving[0].id);
    },
    moveTabGroupItem(id, target, after) {
      const state = get(),
        tabs = layoutTabs(state.layout);
      const groupDrag = id.startsWith("group-header:"),
        groupTarget = target.startsWith("group-header:");
      const draggedId = id.replace(/^group-header:/, ""),
        targetId = target.replace(/^group-header:/, "");
      const dragged = tabs.filter((t) =>
        groupDrag ? t.tabGroupId === draggedId : t.id === draggedId,
      );
      const targetTab = tabs.find((t) =>
        groupTarget ? t.tabGroupId === targetId : t.id === targetId,
      );
      if (!dragged.length || !targetTab || dragged.includes(targetTab)) return;
      const targetGroup = targetTab.tabGroupId;
      let moving = dragged;
      if (!groupDrag)
        moving = dragged.map((t) => ({
          ...t,
          tabGroupId: groupTarget && !after ? undefined : targetGroup,
        }));
      const rest = tabs.filter((t) => !dragged.includes(t));
      const anchors =
        (groupDrag || groupTarget) && targetGroup
          ? rest.filter((t) => t.tabGroupId === targetGroup)
          : [targetTab];
      const index =
        rest.indexOf(after ? anchors[anchors.length - 1] : anchors[0]) + (after ? 1 : 0);
      applyTabs(
        [...rest.slice(0, index), ...moving, ...rest.slice(index)],
        state.layout.activeTabId,
      );
      if (!groupDrag && moving[0].tabGroupId) update(moving[0].tabGroupId, { collapsed: false });
    },
  };
}
