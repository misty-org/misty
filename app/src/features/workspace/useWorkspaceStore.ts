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
  removeDockLeaf,
  swapDockLeaves,
  updateDockSplitRatio,
} from "./dockTree";
import type {
  BrowserTabState,
  DockDropZone,
  DockSplitDirection,
  OpenWorkspaceSurfaceRequest,
  WorkspaceGroupKey,
  WorkspaceLayout,
  WorkspaceScopeKey,
  WorkspaceSnapshot,
  WorkspaceTab,
  WorkspaceVirtualWindow,
} from "./model";
import {
  addVirtualWindow,
  adoptDefaultWorkspaceScope,
  createWorkspaceVirtualWindow,
  currentVirtualWindows,
  extractPaneToVirtualWindow,
  initialVirtualWorkspace,
  normalizeWorkspaceLayout,
  renameVirtualWindow,
  switchVirtualWindow,
  switchWorkspaceScope,
  withActiveVirtualWindowLayout,
  type VirtualWorkspaceState,
} from "./virtualWindows";
import { migrateBrowserTabs, migrateSpaceToolTabs } from "./workspaceMigrations";
import {
  compareTabRecency,
  nextWorkspaceFocusTimestamp,
  removeDockTab,
} from "./workspaceTabOperations";
import {
  closeVirtualWindowRemembering,
  reopenRememberedVirtualWindow,
} from "./closedVirtualWindows";
import {
  rememberClosedWorkspaceTab,
  restoreClosedWorkspaceTab,
  type ClosedWorkspaceTab,
} from "./closedWorkspaceTabs";
import {
  browserHomeUrl,
  browserTabTitle,
  createBrowserTabState,
  maxWorkspacePanels,
  parseBrowserTabState,
} from "./model";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";

export interface WorkspaceStore extends VirtualWorkspaceState {
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  closedTabs: ClosedWorkspaceTab[];
  closedVirtualWindowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceVirtualWindow[]>>;
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
  closeTab: (tabId: string) => boolean;
  reopenClosedTab: () => WorkspaceTab | null;
  cycleTab: (direction: 1 | -1) => WorkspaceTab | null;
  selectTab: (index: number | "last") => WorkspaceTab | null;
  moveTab: (tabId: string, paneId: string, index?: number) => boolean;
  dockTab: (tabId: string, paneId: string, zone: DockDropZone, index?: number) => boolean;
  reorderTab: (paneId: string, tabId: string, index: number) => void;
  splitPane: (paneId: string, direction: DockSplitDirection, tabId?: string) => string | null;
  closePane: (paneId: string) => void;
  swapPanes: (firstPaneId: string, secondPaneId: string) => boolean;
  createVirtualWindow: (title?: string) => WorkspaceVirtualWindow;
  switchVirtualWindow: (windowId: string) => boolean;
  closeVirtualWindow: (windowId: string) => boolean;
  reopenClosedVirtualWindow: () => WorkspaceVirtualWindow | null;
  extractPaneToVirtualWindow: (paneId: string) => WorkspaceVirtualWindow | null;
  renameVirtualWindow: (windowId: string, title: string) => void;
  fillEmptyPanes: () => void;
  updateSplitRatio: (splitId: string, ratio: number) => void;
  toggleSidebar: (tabId: string) => void;
  replaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
  createSnapshot: (accountId: string, deviceId: string) => WorkspaceSnapshot;
  reset: () => void;
}

function withLayout(state: WorkspaceStore, layout: WorkspaceLayout) {
  return withActiveVirtualWindowLayout(state, layout);
}

function isReplaceablePlaceholder(
  tabs: WorkspaceTab[],
  incomingSurface: OpenWorkspaceSurfaceRequest["surfaceId"],
  scopeKey: WorkspaceScopeKey,
): boolean {
  const only = tabs.length === 1 ? tabs[0] : null;
  if (!only) return false;
  if (only.surfaceId === "home") return incomingSurface !== "home";
  return (
    only.surfaceId === "space" &&
    only.groupKey === scopeKey &&
    only.title === "Space" &&
    incomingSurface !== "space"
  );
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      ...initialVirtualWorkspace(),
      lastUsedTabByGroup: {},
      closedTabs: [],
      closedVirtualWindowsByScope: {},
      setScope: (scopeKey) => {
        const update = switchWorkspaceScope(get(), scopeKey);
        if (update) set(update);
      },
      adoptDefaultScope: (scopeKey) => {
        const update = adoptDefaultWorkspaceScope(get(), scopeKey);
        if (update) set(update);
      },
      openSurface: (request) => {
        if (request.surfaceId === "space")
          get().setScope(request.scopeKey ?? (request.groupKey as WorkspaceScopeKey));
        const state = get();
        const now = nextWorkspaceFocusTimestamp(state.virtualWindowsByScope);
        const panes = dockLeaves(state.layout.root);
        const allTabs = currentVirtualWindows(state).flatMap((window) =>
          dockTabs(window.layout.root),
        );
        const activeTabs = panes.flatMap((pane) => pane.tabs);
        const singleton = request.instancePolicy === "single";
        let existing = singleton
          ? allTabs.find((tab) => tab.surfaceId === request.surfaceId)
          : !request.forceNew
            ? allTabs.find((tab) => tab.id === state.lastUsedTabByGroup[request.groupKey])
            : undefined;
        if (!existing && !request.forceNew && request.surfaceId === "home") {
          // Home is stackable, so it cannot be a singleton — but navigating to
          // /home must still land on the Home tab you already have rather than
          // pile up a new one. Only an explicit `forceNew` (the + menu) stacks.
          // Home tabs also appear as the empty-pane fallback, which bypasses
          // this method entirely and so is not in `lastUsedTabByGroup`.
          existing = activeTabs.find((tab) => tab.groupKey === request.groupKey);
        }
        // A bare or legacy Space tab is provisional. Reuse it for the first
        // concrete Space tool instead of leaving an extra generic tab behind
        // after the /spaces/:id redirect resolves.
        if (!existing && request.surfaceId === "space") {
          const scopeKey = request.scopeKey ?? request.groupKey;
          existing = allTabs.find(
            (tab) =>
              tab.surfaceId === "space" &&
              (tab.groupKey === scopeKey ||
                tab.groupKey === request.groupKey ||
                (tab.groupKey === `${scopeKey}:space` &&
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
          get().focusTab(existing.id);
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
              // Global Home and a Space landing tab are empty-pane fillers.
              // The first concrete destination replaces them instead of
              // leaving a placeholder tab behind.
              tabs: isReplaceablePlaceholder(
                candidate.tabs,
                request.surfaceId,
                current.activeScopeKey,
              )
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
        let current = get();
        let pane = dockLeaves(current.layout.root).find((candidate) =>
          candidate.tabs.some((tab) => tab.id === tabId),
        );
        if (!pane) {
          const owner = currentVirtualWindows(current).find((window) =>
            dockTabs(window.layout.root).some((tab) => tab.id === tabId),
          );
          if (!owner || !get().switchVirtualWindow(owner.id)) return false;
          current = get();
          pane = dockLeaves(current.layout.root).find((candidate) =>
            candidate.tabs.some((tab) => tab.id === tabId),
          );
        }
        const tab = pane?.tabs.find((candidate) => candidate.id === tabId);
        if (!pane || !tab) return false;
        if (current.layout.focusedPaneId === pane.id && pane.activeTabId === tabId) return true;
        const now = nextWorkspaceFocusTimestamp(current.virtualWindowsByScope);
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
        const current = get();
        const closing = dockTabs(current.layout.root).find((tab) => tab.id === tabId);
        if (!closing) return false;

        if (dockTabs(current.layout.root).length === 1) {
          const update = closeVirtualWindowRemembering(current, current.activeVirtualWindowId);
          if (!update) return false;
          set(update);
          return true;
        }

        const closingPane = dockLeaves(current.layout.root).find((pane) =>
          pane.tabs.some((tab) => tab.id === tabId),
        );
        const previouslyVisitedTabId =
          closingPane?.activeTabId === tabId
            ? [...closingPane.tabs].filter((tab) => tab.id !== tabId).sort(compareTabRecency)[0]?.id
            : undefined;
        let root = removeDockTab(current.layout.root, tabId, previouslyVisitedTabId);
        root = collapseEmptyDockLeaves(root) ?? createDockLeaf();
        const panes = dockLeaves(root);
        const focusedPaneId = panes.some((pane) => pane.id === current.layout.focusedPaneId)
          ? current.layout.focusedPaneId
          : panes[0].id;
        const lastUsed = { ...current.lastUsedTabByGroup };
        if (lastUsed[closing.groupKey] === tabId) {
          const replacement = dockTabs(root)
            .filter((tab) => tab.groupKey === closing.groupKey)
            .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
          if (replacement) lastUsed[closing.groupKey] = replacement.id;
          else delete lastUsed[closing.groupKey];
        }
        set({
          ...withLayout(current, {
            ...current.layout,
            root,
            focusedPaneId,
          }),
          lastUsedTabByGroup: lastUsed,
          closedTabs: [
            rememberClosedWorkspaceTab(current.layout, closing, current.activeVirtualWindowId),
            ...(current.closedTabs ?? []).filter((entry) => entry.tab.id !== closing.id),
          ].slice(0, 20),
        });
        return true;
      },
      reopenClosedTab: () => {
        let current = get();
        const [closed, ...closedTabs] = current.closedTabs ?? [];
        if (!closed) return null;
        if (
          closed.windowId &&
          closed.windowId !== current.activeVirtualWindowId &&
          currentVirtualWindows(current).some((window) => window.id === closed.windowId)
        ) {
          get().switchVirtualWindow(closed.windowId);
          current = get();
        }
        const now = nextWorkspaceFocusTimestamp(current.virtualWindowsByScope);
        const restored = { ...closed.tab, lastFocusedAt: now };
        const layout = restoreClosedWorkspaceTab(current.layout, closed, restored);
        set({
          ...withLayout(current, layout),
          closedTabs,
          lastUsedTabByGroup: { ...current.lastUsedTabByGroup, [restored.groupKey]: restored.id },
        });
        return restored;
      },
      cycleTab: (direction) => {
        const current = get();
        const pane = findDockLeaf(current.layout.root, current.layout.focusedPaneId);
        if (!pane?.tabs.length) return null;
        const activeIndex = Math.max(
          0,
          pane.tabs.findIndex((tab) => tab.id === pane.activeTabId),
        );
        const index = (activeIndex + direction + pane.tabs.length) % pane.tabs.length;
        const tab = pane.tabs[index];
        get().focusTab(tab.id);
        return tab;
      },
      selectTab: (index) => {
        const current = get();
        const pane = findDockLeaf(current.layout.root, current.layout.focusedPaneId);
        if (!pane?.tabs.length) return null;
        const tab = index === "last" ? pane.tabs[pane.tabs.length - 1] : pane.tabs[index];
        if (!tab) return null;
        get().focusTab(tab.id);
        return tab;
      },
      moveTab: (tabId, paneId, index) => get().dockTab(tabId, paneId, "center", index),
      dockTab: (tabId, paneId, zone, index) => {
        const current = get();
        if (zone !== "center" && dockLeaves(current.layout.root).length >= maxWorkspacePanels)
          return false;
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
        if (dockLeaves(current.layout.root).length >= maxWorkspacePanels) return null;
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
      swapPanes: (firstPaneId, secondPaneId) => {
        const current = get();
        const root = swapDockLeaves(current.layout.root, firstPaneId, secondPaneId);
        if (root === current.layout.root) return false;
        set({ ...withLayout(current, { ...current.layout, root, focusedPaneId: secondPaneId }) });
        return true;
      },
      createVirtualWindow: (title) => {
        const { window, update } = addVirtualWindow(get(), title);
        set(update);
        return window;
      },
      switchVirtualWindow: (windowId) => {
        const update = switchVirtualWindow(get(), windowId);
        if (!update) return false;
        set(update);
        return true;
      },
      closeVirtualWindow: (windowId) => {
        const update = closeVirtualWindowRemembering(get(), windowId);
        if (!update) return false;
        set(update);
        return true;
      },
      reopenClosedVirtualWindow: () => {
        const result = reopenRememberedVirtualWindow(get());
        if (!result) return null;
        set(result.update);
        return result.window;
      },
      extractPaneToVirtualWindow: (paneId) => {
        const result = extractPaneToVirtualWindow(get(), paneId);
        if (!result) return null;
        set(result.update);
        const { window } = result;
        return window;
      },
      renameVirtualWindow: (windowId, title) => {
        const update = renameVirtualWindow(get(), windowId, title);
        if (update) set(update);
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
        const windows = snapshot.virtualWindows?.length
          ? snapshot.virtualWindows.map((window) => ({
              ...window,
              layout: normalizeWorkspaceLayout(
                migrateSpaceToolTabs(migrateBrowserTabs(window.layout)),
              ),
            }))
          : [
              createWorkspaceVirtualWindow(
                normalizeWorkspaceLayout(migrateSpaceToolTabs(migrateBrowserTabs(snapshot.layout))),
              ),
            ];
        const activeWindow =
          windows.find((window) => window.id === snapshot.activeVirtualWindowId) ?? windows[0];
        set({
          layout: activeWindow.layout,
          layoutsByScope: {
            ...current.layoutsByScope,
            [current.activeScopeKey]: activeWindow.layout,
          },
          activeVirtualWindowId: activeWindow.id,
          activeVirtualWindowIdByScope: {
            ...current.activeVirtualWindowIdByScope,
            [current.activeScopeKey]: activeWindow.id,
          },
          virtualWindowsByScope: {
            ...current.virtualWindowsByScope,
            [current.activeScopeKey]: windows,
          },
          lastUsedTabByGroup: snapshot.lastUsedTabByGroup ?? {},
        });
      },
      createSnapshot: (accountId, deviceId) => ({
        version: 3,
        accountId,
        deviceId,
        savedAt: Date.now(),
        layout: get().layout,
        lastUsedTabByGroup: get().lastUsedTabByGroup,
        virtualWindows: currentVirtualWindows(get()),
        activeVirtualWindowId: get().activeVirtualWindowId,
      }),
      reset: () => {
        set({
          ...initialVirtualWorkspace(),
          lastUsedTabByGroup: {},
          closedTabs: [],
          closedVirtualWindowsByScope: {},
        });
      },
    }),
    {
      name: "misty:desktop-dock:v3",
      version: 6,
      migrate: migrateWorkspaceStore,
      partialize: partialWorkspaceStore,
    },
  ),
);
