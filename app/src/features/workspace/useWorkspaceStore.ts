import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  collapseEmptyDockLeaves,
  createDockId,
  createDockLeaf,
  createHomeDockTab,
  dockLeaves,
  dockTabs,
  fillEmptyDockLeaves,
  findDockLeaf,
  insertDockSplit,
  mapDockLeaf,
  mapDockTabs,
  normalizeDockNode,
  updateDockSplitRatio,
} from "./dockTree";
import type {
  BrowserTabState,
  DockDropZone,
  DockSplitDirection,
  OpenWorkspaceSurfaceRequest,
  WorkspaceDockNode,
  WorkspaceGroupKey,
  WorkspaceLayout,
  WorkspaceScopeKey,
  WorkspaceSnapshot,
  WorkspaceTab,
} from "./model";
import {
  browserHomeUrl,
  browserTabTitle,
  createBrowserTabState,
  parseBrowserTabState,
} from "./model";
import { workspaceSurfaceFromRoute } from "./routeSurface";

interface WorkspaceStore {
  activeScopeKey: WorkspaceScopeKey;
  layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>>;
  layout: WorkspaceLayout;
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  setScope: (scopeKey: WorkspaceScopeKey) => void;
  adoptDefaultScope: (scopeKey: WorkspaceScopeKey) => void;
  openSurface: (request: OpenWorkspaceSurfaceRequest) => WorkspaceTab;
  openBrowserTab: (request?: {
    url?: string;
    paneId?: string;
    sourceTabId?: string;
  }) => WorkspaceTab;
  updateBrowserTab: (tabId: string, patch: Partial<BrowserTabState> & { title?: string }) => void;
  renameTab: (tabId: string, title: string) => void;
  updateTabRoute: (tabId: string, route: string) => void;
  updateTabState: (tabId: string, state: unknown, title?: string) => void;
  focusTab: (tabId: string) => boolean;
  closeTab: (tabId: string) => void;
  moveTab: (tabId: string, paneId: string, index?: number) => boolean;
  dockTab: (tabId: string, paneId: string, zone: DockDropZone, index?: number) => boolean;
  reorderTab: (paneId: string, tabId: string, index: number) => void;
  splitPane: (paneId: string, direction: DockSplitDirection, tabId?: string) => string | null;
  closePane: (paneId: string) => void;
  fillEmptyPanes: () => void;
  updateSplitRatio: (splitId: string, ratio: number) => void;
  toggleSidebar: (tabId: string) => void;
  replaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
  createSnapshot: (accountId: string, deviceId: string) => WorkspaceSnapshot;
  reset: () => void;
}

function initialLayout(): WorkspaceLayout {
  const pane = createDockLeaf([createHomeDockTab()]);
  return { root: pane, focusedPaneId: pane.id };
}

function withLayout(state: WorkspaceStore, layout: WorkspaceLayout) {
  const normalized = normalizeLayout(layout);
  return {
    layout: normalized,
    layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: normalized },
  };
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      activeScopeKey: "global",
      layoutsByScope: {},
      layout: initialLayout(),
      lastUsedTabByGroup: {},
      setScope: (scopeKey) => {
        const current = get();
        if (current.activeScopeKey === scopeKey) return;
        const layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>> = {
          ...current.layoutsByScope,
          [current.activeScopeKey]: current.layout,
        };
        const layout = normalizeLayout(layoutsByScope[scopeKey] ?? initialLayout());
        set({
          activeScopeKey: scopeKey,
          layout,
          layoutsByScope: { ...layoutsByScope, [scopeKey]: layout },
        });
      },
      adoptDefaultScope: (scopeKey) => {
        const current = get();
        // Only the pre-Spaces bootstrap scope is adopted. Once the user is in a
        // real Space, their choice stands.
        if (current.activeScopeKey !== "global") return;
        const layoutsByScope = { ...current.layoutsByScope };
        // Carry the bootstrap layout across rather than stranding whatever the
        // user opened before Spaces finished loading.
        const layout = normalizeLayout(layoutsByScope[scopeKey] ?? current.layout);
        delete layoutsByScope.global;
        set({
          activeScopeKey: scopeKey,
          layout,
          layoutsByScope: { ...layoutsByScope, [scopeKey]: layout },
        });
      },
      openSurface: (request) => {
        if (request.surfaceId === "space")
          get().setScope(request.scopeKey ?? (request.groupKey as WorkspaceScopeKey));
        const now = Date.now();
        const state = get();
        const panes = dockLeaves(state.layout.root);
        const allTabs = panes.flatMap((pane) => pane.tabs);
        const singleton = request.instancePolicy === "single";
        let existing = singleton
          ? allTabs.find((tab) => tab.surfaceId === request.surfaceId)
          : !request.forceNew
            ? allTabs.find((tab) => tab.id === state.lastUsedTabByGroup[request.groupKey])
            : undefined;
        if (
          !existing &&
          !request.forceNew &&
          (request.surfaceId === "space" || request.surfaceId === "home")
        ) {
          // Home is stackable, so it cannot be a singleton — but navigating to
          // /home must still land on the Home tab you already have rather than
          // pile up a new one. Only an explicit `forceNew` (the + menu) stacks.
          // Home tabs also appear as the empty-pane fallback, which bypasses
          // this method entirely and so is not in `lastUsedTabByGroup`.
          existing = allTabs.find((tab) => tab.groupKey === request.groupKey);
        }
        // A bare or legacy Space tab is provisional. Reuse it for the first
        // concrete Space tool instead of leaving an extra generic tab behind
        // after the /spaces/:id redirect resolves.
        if (!existing && request.surfaceId === "space" && request.scopeKey) {
          existing = allTabs.find(
            (tab) =>
              tab.surfaceId === "space" &&
              (tab.groupKey === request.scopeKey ||
                (tab.groupKey === `${request.scopeKey}:space` &&
                  workspaceSurfaceFromRoute(tab.route)?.groupKey === request.scopeKey)),
          );
          if (existing) {
            const replacement = {
              ...existing,
              groupKey: request.groupKey,
              instanceKey: request.instanceKey ?? existing.instanceKey,
              title: request.title,
              route: request.route,
            };
            set((current) => ({
              ...withLayout(current, {
                ...current.layout,
                root: mapDockTabs(current.layout.root, (tab) =>
                  tab.id === existing?.id ? replacement : tab,
                ),
              }),
              lastUsedTabByGroup: {
                ...current.lastUsedTabByGroup,
                [request.groupKey]: replacement.id,
              },
            }));
            get().focusTab(replacement.id);
            return replacement;
          }
        }
        if (existing) {
          if (request.syncExistingRoute && existing.route !== request.route) {
            set((current) =>
              withLayout(current, {
                ...current.layout,
                root: mapDockTabs(current.layout.root, (tab) =>
                  tab.id === existing.id ? { ...tab, route: request.route } : tab,
                ),
              }),
            );
          }
          get().focusTab(existing.id);
          return dockTabs(get().layout.root).find((tab) => tab.id === existing.id) ?? existing;
        }
        const pane =
          panes.find((candidate) => candidate.id === request.paneId) ??
          panes.find((candidate) => candidate.id === state.layout.focusedPaneId) ??
          panes[0];
        const tab: WorkspaceTab = {
          id: createDockId("tab"),
          surfaceId: request.surfaceId,
          groupKey: request.groupKey,
          instanceKey: request.instanceKey ?? createDockId("tab"),
          title: request.title,
          route: request.route,
          sidebarVisible: request.sidebarVisible ?? true,
          state: request.state ?? {},
          createdAt: now,
          lastFocusedAt: now,
        };
        set((current) => ({
          ...withLayout(current, {
            ...current.layout,
            focusedPaneId: pane.id,
            root: mapDockLeaf(current.layout.root, pane.id, (candidate) => ({
              ...candidate,
              activeTabId: tab.id,
              // A pane showing nothing but Home is showing the empty-pane
              // filler, so the first real tab takes its place instead of
              // leaving it behind. Opening Home itself is never a replacement,
              // or Home could never be stacked.
              tabs:
                request.surfaceId !== "home" &&
                candidate.tabs.length === 1 &&
                candidate.tabs[0]?.surfaceId === "home"
                  ? [tab]
                  : [...candidate.tabs, tab],
            })),
          }),
          lastUsedTabByGroup: { ...current.lastUsedTabByGroup, [tab.groupKey]: tab.id },
        }));
        return tab;
      },
      openBrowserTab: (request = {}) => {
        const url = request.url?.trim() || browserHomeUrl();
        const tab = get().openSurface({
          surfaceId: "browser",
          groupKey: "tool:browser",
          title: browserTabTitle(url),
          route: "/browser",
          state: createBrowserTabState(url),
          instancePolicy: "multiple",
          forceNew: true,
          paneId: request.paneId,
        });
        if (request.sourceTabId) {
          const pane = dockLeaves(get().layout.root).find((candidate) =>
            candidate.tabs.some((candidateTab) => candidateTab.id === request.sourceTabId),
          );
          const sourceIndex = pane?.tabs.findIndex(
            (candidate) => candidate.id === request.sourceTabId,
          );
          if (pane && sourceIndex !== undefined && sourceIndex >= 0)
            get().moveTab(tab.id, pane.id, sourceIndex + 1);
        }
        return tab;
      },
      updateBrowserTab: (tabId, patch) => {
        set((current) =>
          withLayout(current, {
            ...current.layout,
            root: mapDockTabs(current.layout.root, (tab) => {
              if (tab.id !== tabId || tab.surfaceId !== "browser") return tab;
              const { title, ...statePatch } = patch;
              const existing = parseBrowserTabState(tab.state);
              const defaults =
                statePatch.url && statePatch.url !== existing.url
                  ? createBrowserTabState(statePatch.url)
                  : existing;
              return {
                ...tab,
                title: title?.trim() || tab.title,
                state: { ...defaults, ...statePatch } satisfies BrowserTabState,
              };
            }),
          }),
        );
      },
      renameTab: (tabId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set((current) =>
          withLayout(current, {
            ...current.layout,
            root: mapDockTabs(current.layout.root, (tab) =>
              tab.id === tabId && tab.title !== trimmed ? { ...tab, title: trimmed } : tab,
            ),
          }),
        );
      },
      updateTabRoute: (tabId, route) => {
        set((current) =>
          withLayout(current, {
            ...current.layout,
            root: mapDockTabs(current.layout.root, (tab) =>
              tab.id === tabId ? { ...tab, route } : tab,
            ),
          }),
        );
      },
      updateTabState: (tabId, state, title) => {
        set((current) =>
          withLayout(current, {
            ...current.layout,
            root: mapDockTabs(current.layout.root, (tab) =>
              tab.id === tabId ? { ...tab, state, title: title?.trim() || tab.title } : tab,
            ),
          }),
        );
      },
      focusTab: (tabId) => {
        const current = get();
        const pane = dockLeaves(current.layout.root).find((candidate) =>
          candidate.tabs.some((tab) => tab.id === tabId),
        );
        const tab = pane?.tabs.find((candidate) => candidate.id === tabId);
        if (!pane || !tab) return false;
        if (current.layout.focusedPaneId === pane.id && pane.activeTabId === tabId) return true;
        const now = Date.now();
        set({
          ...withLayout(current, {
            ...current.layout,
            focusedPaneId: pane.id,
            root: mapDockLeaf(current.layout.root, pane.id, (candidate) => ({
              ...candidate,
              activeTabId: tabId,
              tabs: candidate.tabs.map((item) =>
                item.id === tabId ? { ...item, lastFocusedAt: now } : item,
              ),
            })),
          }),
          lastUsedTabByGroup: { ...current.lastUsedTabByGroup, [tab.groupKey]: tabId },
        });
        return true;
      },
      closeTab: (tabId) => {
        set((current) => {
          const closing = dockTabs(current.layout.root).find((tab) => tab.id === tabId);
          let root = removeDockTab(current.layout.root, tabId);
          root = collapseEmptyDockLeaves(root) ?? createDockLeaf();
          const panes = dockLeaves(root);
          const focusedPaneId = panes.some((pane) => pane.id === current.layout.focusedPaneId)
            ? current.layout.focusedPaneId
            : panes[0].id;
          const lastUsed = { ...current.lastUsedTabByGroup };
          if (closing && lastUsed[closing.groupKey] === tabId) {
            const replacement = dockTabs(root)
              .filter((tab) => tab.groupKey === closing.groupKey)
              .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
            if (replacement) lastUsed[closing.groupKey] = replacement.id;
            else delete lastUsed[closing.groupKey];
          }
          return {
            ...withLayout(current, {
              ...current.layout,
              root,
              focusedPaneId,
            }),
            lastUsedTabByGroup: lastUsed,
          };
        });
      },
      moveTab: (tabId, paneId, index) => get().dockTab(tabId, paneId, "center", index),
      dockTab: (tabId, paneId, zone, index) => {
        const current = get();
        const source = dockLeaves(current.layout.root).find((pane) =>
          pane.tabs.some((tab) => tab.id === tabId),
        );
        const target = findDockLeaf(current.layout.root, paneId);
        const tab = source?.tabs.find((candidate) => candidate.id === tabId);
        if (!source || !target || !tab) return false;
        let root = removeDockTab(current.layout.root, tabId);
        if (zone === "center") {
          root = mapDockLeaf(root, paneId, (leaf) => {
            const at = Math.max(0, Math.min(index ?? leaf.tabs.length, leaf.tabs.length));
            return {
              ...leaf,
              tabs: [...leaf.tabs.slice(0, at), tab, ...leaf.tabs.slice(at)],
              activeTabId: tab.id,
            };
          });
        } else {
          root = insertDockSplit(root, paneId, createDockLeaf([tab]), zone);
        }
        root = collapseEmptyDockLeaves(root) ?? createDockLeaf([tab]);
        const destination = dockLeaves(root).find((leaf) =>
          leaf.tabs.some((item) => item.id === tabId),
        );
        set({
          ...withLayout(current, {
            ...current.layout,
            root,
            focusedPaneId: destination?.id ?? current.layout.focusedPaneId,
          }),
          lastUsedTabByGroup: { ...current.lastUsedTabByGroup, [tab.groupKey]: tab.id },
        });
        return true;
      },
      reorderTab: (paneId, tabId, index) => {
        get().moveTab(tabId, paneId, index);
      },
      splitPane: (paneId, direction, tabId) => {
        const current = get();
        const pane = findDockLeaf(current.layout.root, paneId);
        if (!pane) return null;
        if (tabId) {
          if (!get().dockTab(tabId, paneId, direction)) return null;
          return (
            dockLeaves(get().layout.root).find((pane) => pane.tabs.some((tab) => tab.id === tabId))
              ?.id ?? null
          );
        }
        const leaf = createDockLeaf([createHomeDockTab()]);
        set({
          ...withLayout(current, {
            ...current.layout,
            root: insertDockSplit(current.layout.root, paneId, leaf, direction),
            focusedPaneId: leaf.id,
          }),
        });
        return leaf.id;
      },
      closePane: (paneId) => {
        const current = get();
        const pane = findDockLeaf(current.layout.root, paneId);
        if (!pane) return;
        let root = removeDockLeaf(current.layout.root, paneId) ?? createDockLeaf();
        const target = dockLeaves(root)[0];
        const movableTabs = pane.tabs.filter((tab) => tab.surfaceId !== "home");
        if (movableTabs.length)
          root = mapDockLeaf(root, target.id, (leaf) => ({
            ...leaf,
            tabs:
              leaf.tabs.length === 1 && leaf.tabs[0]?.surfaceId === "home"
                ? movableTabs
                : [...leaf.tabs, ...movableTabs],
            activeTabId: movableTabs.some((tab) => tab.id === pane.activeTabId)
              ? pane.activeTabId
              : (movableTabs[0]?.id ?? leaf.activeTabId),
          }));
        set({ ...withLayout(current, { ...current.layout, root, focusedPaneId: target.id }) });
      },
      fillEmptyPanes: () => {
        set((current) => {
          const root = fillEmptyDockLeaves(current.layout.root);
          return root === current.layout.root
            ? current
            : withLayout(current, { ...current.layout, root });
        });
      },
      updateSplitRatio: (splitId, ratio) => {
        set((current) => {
          const root = updateDockSplitRatio(current.layout.root, splitId, ratio);
          return root === current.layout.root
            ? current
            : withLayout(current, { ...current.layout, root });
        });
      },
      toggleSidebar: (tabId) => {
        set((current) =>
          withLayout(current, {
            ...current.layout,
            root: mapDockTabs(current.layout.root, (tab) =>
              tab.id === tabId ? { ...tab, sidebarVisible: !tab.sidebarVisible } : tab,
            ),
          }),
        );
      },
      replaceSnapshot: (snapshot) => {
        const current = get();
        set({
          ...withLayout(
            current,
            normalizeLayout(migrateSpaceToolTabs(migrateBrowserTabs(snapshot.layout))),
          ),
          lastUsedTabByGroup: snapshot.lastUsedTabByGroup ?? {},
        });
      },
      createSnapshot: (accountId, deviceId) => ({
        version: 2,
        accountId,
        deviceId,
        savedAt: Date.now(),
        layout: get().layout,
        lastUsedTabByGroup: get().lastUsedTabByGroup,
      }),
      reset: () => {
        const layout = initialLayout();
        set({
          activeScopeKey: "global",
          layout,
          layoutsByScope: { global: layout },
          lastUsedTabByGroup: {},
        });
      },
    }),
    {
      name: "misty:desktop-dock:v3",
      version: 3,
      migrate: (persisted, version) => {
        const state = persisted as Partial<WorkspaceStore> | undefined;
        if (!state || version >= 3) return state as WorkspaceStore;
        const layoutsByScope = Object.fromEntries(
          Object.entries(state.layoutsByScope ?? {}).map(([scope, layout]) => [
            scope,
            layout ? migrateSpaceToolTabs(layout) : layout,
          ]),
        ) as WorkspaceStore["layoutsByScope"];
        return {
          ...state,
          layout: state.layout ? migrateSpaceToolTabs(state.layout) : state.layout,
          layoutsByScope,
        } as WorkspaceStore;
      },
      partialize: (state) => ({
        activeScopeKey: state.activeScopeKey,
        layout: state.layout,
        layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: state.layout },
        lastUsedTabByGroup: state.lastUsedTabByGroup,
      }),
    },
  ),
);

/**
 * A layout always has at least one tab.
 *
 * Closing the last tab leaves a Home tab behind rather than an empty pane, so
 * there is no "zero tabs" state for the rest of the app to react to. Applied
 * here rather than at each call site because every mutation, scope switch, and
 * rehydration funnels through this.
 */
function normalizeLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const root = normalizeDockNode(fillEmptyDockLeaves(layout.root));
  const panes = dockLeaves(root);
  const focusedPaneId = panes.some((pane) => pane.id === layout.focusedPaneId)
    ? layout.focusedPaneId
    : panes[0].id;
  return {
    root,
    focusedPaneId,
  };
}

function migrateBrowserTabs(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    ...layout,
    root: mapDockTabs(layout.root, (tab) =>
      tab.surfaceId === "browser"
        ? {
            ...tab,
            title:
              tab.title && tab.title !== "Browser"
                ? tab.title
                : browserTabTitle(parseBrowserTabState(tab.state).url),
            state: parseBrowserTabState(tab.state),
          }
        : tab,
    ),
  };
}

function migrateSpaceToolTabs(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    ...layout,
    root: mapDockTabs(layout.root, (tab) => {
      if (tab.surfaceId !== "space") return tab;
      const request = workspaceSurfaceFromRoute(tab.route);
      if (!request || request.surfaceId !== "space") return tab;
      return {
        ...tab,
        groupKey: request.groupKey,
        instanceKey: request.instanceKey ?? tab.instanceKey,
        title: request.title,
      };
    }),
  };
}

function removeDockTab(node: WorkspaceDockNode, tabId: string): WorkspaceDockNode {
  if (node.type === "leaf") {
    const index = node.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return node;
    const tabs = node.tabs.filter((tab) => tab.id !== tabId);
    return {
      ...node,
      tabs,
      activeTabId:
        node.activeTabId === tabId
          ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
          : node.activeTabId,
    };
  }
  const first = removeDockTab(node.first, tabId);
  const second = removeDockTab(node.second, tabId);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function removeDockLeaf(node: WorkspaceDockNode, paneId: string): WorkspaceDockNode | null {
  if (node.type === "leaf") return node.id === paneId ? null : node;
  const first = removeDockLeaf(node.first, paneId);
  const second = removeDockLeaf(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}
