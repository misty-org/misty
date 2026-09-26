import { validDockingLayout, type DockingLayout } from "@/features/app-shell/dockingLayout";
import {
  initialWebsiteNavigation,
  type WebsiteNavigationState,
} from "@/features/browser-workspace/navigationDefaults";
import { pushPaneView, traversePaneHistory } from "./paneHistory";
import {
  activeLayoutView,
  allLayoutViews,
  appendLayoutTab,
  layoutTabs,
  selectLayoutTab,
  singleViewLayoutTab,
} from "./layoutTabs";
import { reconcileGroupIdentities } from "./groupIdentity";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  captureLegacyWorkspaceOwner,
  nativeWorkspaceRecoveryEnabled,
  workspaceStoreStorageKey,
} from "./workspaceRecoveryPlatform";
import { browserWorkspaceStoreVersion, workspaceRecoveryStorage } from "./workspaceRecoveryStorage";
import {
  collapseEmptyDockLeaves,
  createDockId,
  createDockLeaf,
  dockLeaves,
  dockTabs,
  fillEmptyDockLeaves,
  findDockLeaf,
  insertDockSplit,
  mapDockLeaf,
  moveDockPane,
  normalizePaneLayout,
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
  WorkspaceDockNode,
  WorkspacePane,
  WorkspaceVirtualWindow,
} from "./model";
import {
  addVirtualWindow,
  adoptDefaultWorkspaceScope,
  createWorkspaceVirtualWindow,
  currentVirtualWindows,
  extractPaneToVirtualWindow,
  initialVirtualWorkspace,
  mapAllVirtualWorkspaceTabs,
  mapAllVirtualWorkspaceLayouts,
  normalizeWorkspaceLayout,
  renameVirtualWindow,
  switchVirtualWindow,
  switchWorkspaceScope,
  withActiveVirtualWindowLayout,
  type VirtualWorkspaceState,
} from "./virtualWindows";
import { migrateRetiredWorkspaceTabs } from "./workspaceMigrations";
import { isPrivateBrowserTab } from "./privateBrowsing";
import {
  canCloseWorkspaceTab,
  canCloseWorkspaceWindow,
  lastUsedUpdatesForTab,
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
  sanitizeBrowserTitle,
} from "./model";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";
import { createDefaultWorkspaceTab, createBlankWorkspaceTab } from "./workspaceDefaultTab";

export interface WorkspaceStore extends VirtualWorkspaceState, WebsiteNavigationState {
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  closedTabs: ClosedWorkspaceTab[];
  closedVirtualWindowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceVirtualWindow[]>>;
  newLayoutTab: () => WorkspaceTab;
  navigatePane: (delta: number, paneId?: string) => WorkspaceTab | null;
  detachPaneToTab: (viewId: string) => boolean;
  selectLayoutTab: (id: string) => WorkspaceTab | null;
  closeLayoutTab: (id: string) => boolean;
  renameLayoutTab: (id: string, title: string) => void;
  reorderLayoutTabs: (ids: string[]) => void;
  setScope: (scopeKey: WorkspaceScopeKey) => void;
  adoptDefaultScope: (scopeKey: WorkspaceScopeKey, validScopes?: Set<string>) => void;
  openSurface: (request: OpenWorkspaceSurfaceRequest) => WorkspaceTab;
  addSurface: (request: OpenWorkspaceSurfaceRequest) => WorkspaceTab;
  openBrowserTab: (request?: {
    url?: string;
    paneId?: string;
    sourceTabId?: string;
    websiteId?: string;
    /** Open as a private tab. Tabs opened from a private tab are private too. */
    private?: boolean;
  }) => WorkspaceTab;
  updateBrowserTab: (tabId: string, patch: Partial<BrowserTabState> & { title?: string }) => void;
  renameTab: (tabId: string, title: string) => void;
  updateTabRoute: (tabId: string, route: string, replace?: boolean) => void;
  updateTabState: (tabId: string, state: unknown, title?: string) => void;
  focusPane: (paneId: string) => boolean;
  focusTab: (tabId: string) => boolean;
  closeTab: (tabId: string, paneId?: string) => boolean;
  /** Reopens a closed tab; the most recently closed one by default. */
  reopenClosedTab: (index?: number) => WorkspaceTab | null;
  cycleTab: (direction: 1 | -1) => WorkspaceTab | null;
  selectTab: (index: number | "last") => WorkspaceTab | null;
  dockTabGroup: (tabIds: string[], paneId: string, zone: DockDropZone, index?: number) => boolean;
  moveTab: (tabId: string, paneId: string, index?: number) => boolean;
  dockTab: (tabId: string, paneId: string, zone: DockDropZone, index?: number) => boolean;
  reorderPaneTabs: (paneId: string, ids: string[]) => void;
  reorderTab: (paneId: string, tabId: string, index: number) => void;
  splitPane: (paneId: string, direction: DockSplitDirection, tabId?: string) => string | null;
  closePane: (paneId: string) => void;
  swapPanes: (firstPaneId: string, secondPaneId: string) => boolean;
  movePane: (paneId: string, direction: DockSplitDirection, targetPaneId?: string) => boolean;
  setWindowDockingLayout: (layout: DockingLayout) => void;
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
  return withActiveVirtualWindowLayout(state, reconcileGroupIdentities(layout, state.layout));
}

if (nativeWorkspaceRecoveryEnabled()) captureLegacyWorkspaceOwner();

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      ...initialVirtualWorkspace(),
      ...initialWebsiteNavigation(),
      lastUsedTabByGroup: {},
      closedTabs: [],
      closedVirtualWindowsByScope: {},
      setScope: (scopeKey) => {
        const update = switchWorkspaceScope(get(), scopeKey);
        if (update) set(update);
      },
      adoptDefaultScope: (scopeKey, validScopes) => {
        const update = adoptDefaultWorkspaceScope(get(), scopeKey, validScopes);
        if (update) set(update);
      },
      openSurface: (request) => {
        if (request.scopeKey) get().setScope(request.scopeKey);
        else if (request.surfaceId === "space") get().setScope(scopeKeyForSurface(request));
        const current = get();
        const pane =
          findDockLeaf(current.layout.root, request.paneId ?? current.layout.focusedPaneId) ??
          dockLeaves(current.layout.root)[0];
        const previous = pane.tabs[0];
        const replacePane = !request.forceNew || Boolean(request.paneId);
        if (
          replacePane &&
          !request.forceNew &&
          !previous?.placeholder &&
          previous?.route === request.route &&
          previous.groupKey === request.groupKey
        )
          return previous;
        if (
          replacePane &&
          previous &&
          previous.groupKey !== request.groupKey &&
          !canCloseWorkspaceTab(previous)
        )
          return previous;
        const now = nextWorkspaceFocusTimestamp(current.virtualWindowsByScope);
        const sameApp =
          replacePane &&
          !request.forceNew &&
          previous?.groupKey === request.groupKey &&
          !previous.placeholder;
        const tab: WorkspaceTab = {
          id: sameApp ? previous.id : createDockId("tab"),
          surfaceId: request.surfaceId,
          groupKey: request.groupKey,
          instanceKey: sameApp
            ? previous.instanceKey
            : (request.instanceKey ?? createDockId("tab")),
          title: request.title,
          route: request.route,
          sidebarVisible: sameApp ? previous.sidebarVisible : (request.sidebarVisible ?? true),
          state: sameApp ? previous.state : (request.state ?? {}),
          createdAt: sameApp ? previous.createdAt : now,
          lastFocusedAt: now,
        };
        const layout = replacePane
          ? {
              ...current.layout,
              focusedPaneId: pane.id,
              root: mapDockLeaf(current.layout.root, pane.id, (leaf) =>
                pushPaneView(leaf, tab, Boolean(previous?.placeholder)),
              ),
            }
          : appendLayoutTab(current.layout, singleViewLayoutTab(tab));
        set({
          ...withLayout(current, layout),
          lastUsedTabByGroup: {
            ...current.lastUsedTabByGroup,
            ...lastUsedUpdatesForTab(tab, tab.id),
          },
        });
        return tab;
      },
      addSurface: (request) => get().openSurface({ ...request, forceNew: true }),
      newLayoutTab: () => {
        const current = get(),
          view = createBlankWorkspaceTab(current.activeScopeKey);
        set(withLayout(current, appendLayoutTab(current.layout, singleViewLayoutTab(view))));
        return view;
      },
      navigatePane: (delta, paneId) => {
        const current = get(),
          pane = findDockLeaf(current.layout.root, paneId ?? current.layout.focusedPaneId);
        if (!pane) return null;
        const next = traversePaneHistory(pane, delta);
        if (!next || (pane.tabs[0]?.id !== next.tabs[0]?.id && !canCloseWorkspaceTab(pane.tabs[0])))
          return null;
        set(
          withLayout(current, {
            ...current.layout,
            root: mapDockLeaf(current.layout.root, pane.id, () => next),
            focusedPaneId: pane.id,
          }),
        );
        return next.tabs[0] ?? null;
      },
      openBrowserTab: (request = {}) => {
        const url = request.url?.trim() || browserHomeUrl();
        let sourcePrivate = false;
        if (request.sourceTabId) {
          mapAllVirtualWorkspaceTabs(get(), (candidate) => {
            if (candidate.id === request.sourceTabId && isPrivateBrowserTab(candidate))
              sourcePrivate = true;
            return candidate;
          });
        }
        const isPrivate = request.private || sourcePrivate;
        const tab = get().openSurface({
          surfaceId: "browser",
          groupKey: "tool:browser",
          scopeKey: "global",
          title: browserTabTitle(url),
          route: "/browser",
          state: {
            ...createBrowserTabState(url),
            websiteId: request.websiteId,
            ...(isPrivate ? { private: true } : {}),
          },
          instancePolicy: "multiple",
          forceNew: true,
          paneId: request.paneId,
        });
        get().focusTab(tab.id);
        return tab;
      },
      updateBrowserTab: (tabId, patch) => {
        set((current) =>
          mapAllVirtualWorkspaceTabs(current, (tab) => {
            if (
              tab.id !== tabId ||
              (tab.surfaceId !== "browser" &&
                !(tab.surfaceId === "official-app" && tab.groupKey === "app:browser"))
            )
              return tab;
            const { title, ...statePatch } = patch;
            const existing = parseBrowserTabState(tab.state);
            const nextUrl = statePatch.url ?? existing.url;
            const defaults =
              statePatch.url && statePatch.url !== existing.url
                ? { ...existing, ...createBrowserTabState(statePatch.url) }
                : existing;
            const resolvedTitle =
              title !== undefined
                ? sanitizeBrowserTitle(title, nextUrl)
                : statePatch.url && statePatch.url !== existing.url
                  ? browserTabTitle(statePatch.url)
                  : tab.title;
            return {
              ...tab,
              title: resolvedTitle,
              state: { ...defaults, ...statePatch } satisfies BrowserTabState,
            };
          }),
        );
      },
      renameTab: (tabId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set((current) =>
          mapAllVirtualWorkspaceTabs(current, (tab) =>
            tab.id === tabId && tab.title !== trimmed ? { ...tab, title: trimmed } : tab,
          ),
        );
      },
      updateTabRoute: (tabId, route, replace = false) => {
        set(
          mapAllVirtualWorkspaceLayouts(get(), (layout) => {
            const tabs = layoutTabs(layout).map((tab) => ({
              ...tab,
              root: mapDockLeafForView(tab.root, tabId, (pane) => {
                const view = pane.tabs[0];
                return view.route === route
                  ? pane
                  : pushPaneView(pane, { ...view, route }, replace);
              }),
            }));
            return selectLayoutTab({ ...layout, tabs }, layout.activeLayoutTabId ?? tabs[0].id);
          }),
        );
      },
      updateTabState: (tabId, state, title) => {
        set((current) =>
          mapAllVirtualWorkspaceTabs(current, (tab) =>
            tab.id === tabId ? { ...tab, state, title: title?.trim() || tab.title } : tab,
          ),
        );
      },
      focusPane: (paneId) => {
        const current = get();
        const pane = findDockLeaf(current.layout.root, paneId);
        if (!pane) return false;
        const tab =
          pane.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane.tabs[0];
        if (tab) return get().focusTab(tab.id);
        if (current.layout.focusedPaneId === paneId) return true;
        set(
          withLayout(current, {
            ...current.layout,
            focusedPaneId: paneId,
          }),
        );
        return true;
      },
      focusTab: (tabId) => {
        let current = get();
        const owner = currentVirtualWindows(current).find((window) =>
          allLayoutViews(window.layout).some((tab) => tab.id === tabId),
        );
        if (!owner) return false;
        if (owner.id !== current.activeVirtualWindowId) get().switchVirtualWindow(owner.id);
        current = get();
        const ownerTab = layoutTabs(current.layout).find((tab) =>
          dockTabs(tab.root).some((view) => view.id === tabId),
        );
        if (!ownerTab) return false;
        const switched =
          ownerTab.id !== current.layout.activeLayoutTabId ||
          owner.id !== get().activeVirtualWindowId;
        if (ownerTab.id !== current.layout.activeLayoutTabId) {
          set(withLayout(current, selectLayoutTab(current.layout, ownerTab.id)));
          current = get();
        }
        const pane = dockLeaves(current.layout.root).find((candidate) =>
          candidate.tabs.some((tab) => tab.id === tabId),
        );
        const tab = pane?.tabs.find((candidate) => candidate.id === tabId);
        if (!pane || !tab) return false;
        const updates = lastUsedUpdatesForTab(tab, tabId);
        if (!switched && current.layout.focusedPaneId === pane.id && pane.activeTabId === tabId) {
          if (
            (Object.keys(updates) as WorkspaceGroupKey[]).every(
              (key) => current.lastUsedTabByGroup[key] === updates[key],
            )
          ) {
            return true;
          }
          set({ lastUsedTabByGroup: { ...current.lastUsedTabByGroup, ...updates } });
          return true;
        }
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
          lastUsedTabByGroup: { ...current.lastUsedTabByGroup, ...updates },
        });
        return true;
      },
      selectLayoutTab: (id) => {
        const current = get();
        const selected = layoutTabs(current.layout).find((tab) => tab.id === id);
        if (!selected) return null;
        const view = activeLayoutView(selected);
        if (view) get().focusTab(view.id);
        else set(withLayout(current, selectLayoutTab(current.layout, id)));
        return view;
      },
      renameLayoutTab: (id, title) => {
        const current = get();
        set(
          withLayout(current, {
            ...current.layout,
            tabs: layoutTabs(current.layout).map((tab) =>
              tab.id === id ? { ...tab, title: title.trim() || undefined } : tab,
            ),
          }),
        );
      },
      reorderLayoutTabs: (ids) => {
        const current = get(),
          tabs = layoutTabs(current.layout);
        if (
          ids.length !== tabs.length ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !tabs.some((tab) => tab.id === id))
        )
          return;
        set(
          withLayout(current, {
            ...current.layout,
            tabs: ids.map((id) => tabs.find((tab) => tab.id === id)!),
          }),
        );
      },
      closeLayoutTab: (id) => {
        const current = get(),
          tabs = layoutTabs(current.layout);
        const closing = tabs.find((tab) => tab.id === id);
        if (!closing || dockTabs(closing.root).some((view) => !canCloseWorkspaceTab(view)))
          return false;
        const view = activeLayoutView(closing);
        if (tabs.length === 1 && currentVirtualWindows(current).length > 1) {
          const update = closeVirtualWindowRemembering(current, current.activeVirtualWindowId);
          if (!update) return false;
          set({
            ...update,
            closedTabs: view
              ? [
                  {
                    tab: view,
                    windowId: current.activeVirtualWindowId,
                    paneId: closing.focusedPaneId,
                    layoutTab: closing,
                  },
                  ...current.closedTabs,
                ].slice(0, 20)
              : current.closedTabs,
          });
          return true;
        }
        let remaining = tabs.filter((tab) => tab.id !== id);
        if (!remaining.length)
          remaining = [singleViewLayoutTab(createBlankWorkspaceTab(current.activeScopeKey))];
        const next =
          remaining.find((tab) => tab.id === current.layout.activeLayoutTabId) ??
          [...remaining].sort(
            (a, b) =>
              Math.max(...dockTabs(b.root).map((view) => view.lastFocusedAt)) -
              Math.max(...dockTabs(a.root).map((view) => view.lastFocusedAt)),
          )[0];
        set({
          ...withLayout(current, selectLayoutTab({ ...current.layout, tabs: remaining }, next.id)),
          closedTabs: view
            ? [
                {
                  tab: view,
                  windowId: current.activeVirtualWindowId,
                  paneId: closing.focusedPaneId,
                  layoutTab: closing,
                },
                ...current.closedTabs,
              ].slice(0, 20)
            : current.closedTabs,
        });
        return true;
      },
      closeTab: (tabId, paneId) => {
        const current = get();
        const owner = layoutTabs(current.layout).find((tab) =>
          dockTabs(tab.root).some((view) => view.id === tabId),
        );
        if (!owner) return false;
        if (dockTabs(owner.root).length === 1) return get().closeLayoutTab(owner.id);
        const pane = dockLeaves(owner.root).find(
          (pane) => (!paneId || pane.id === paneId) && pane.tabs.some((view) => view.id === tabId),
        );
        const view = pane?.tabs.find((view) => view.id === tabId);
        if (!pane || !view || !canCloseWorkspaceTab(view)) return false;
        const root = collapseEmptyDockLeaves(removeDockTab(owner.root, tabId));
        if (!root) return false;
        const updated = {
          ...owner,
          root,
          focusedPaneId:
            owner.focusedPaneId === pane.id ? dockLeaves(root)[0].id : owner.focusedPaneId,
        };
        const layout = {
          ...current.layout,
          tabs: layoutTabs(current.layout).map((tab) => (tab.id === owner.id ? updated : tab)),
        };
        set({
          ...withLayout(
            current,
            selectLayoutTab(layout, current.layout.activeLayoutTabId ?? owner.id),
          ),
          closedTabs: [
            {
              ...rememberClosedWorkspaceTab(owner, view, current.activeVirtualWindowId),
              layoutTabId: owner.id,
            },
            ...current.closedTabs,
          ].slice(0, 20),
        });
        return true;
      },
      reopenClosedTab: (index = 0) => {
        let current = get();
        const closed = current.closedTabs[index];
        if (!closed) return null;
        const closedTabs = current.closedTabs.filter((_, position) => position !== index);
        if (
          closed.windowId !== current.activeVirtualWindowId &&
          currentVirtualWindows(current).some((window) => window.id === closed.windowId)
        ) {
          get().switchVirtualWindow(closed.windowId);
          current = get();
        }
        let layout: WorkspaceLayout;
        if (closed.layoutTab) layout = appendLayoutTab(current.layout, closed.layoutTab);
        else {
          const owner = layoutTabs(current.layout).find((tab) => tab.id === closed.layoutTabId);
          if (owner && dockLeaves(owner.root).length < maxWorkspacePanels) {
            const restored = restoreClosedWorkspaceTab(owner, closed, closed.tab);
            const updated = {
              ...owner,
              root: restored.root,
              focusedPaneId: restored.focusedPaneId,
            };
            layout = selectLayoutTab(
              {
                ...current.layout,
                tabs: layoutTabs(current.layout).map((tab) =>
                  tab.id === owner.id ? updated : tab,
                ),
              },
              owner.id,
            );
          } else {
            const restored = singleViewLayoutTab(closed.tab);
            if (closed.pane) {
              restored.root = closed.pane;
              restored.focusedPaneId = closed.pane.id;
            }
            layout = appendLayoutTab(current.layout, restored);
          }
        }
        set({ ...withLayout(current, layout), closedTabs });
        get().focusTab(closed.tab.id);
        return closed.tab;
      },
      cycleTab: (direction) => {
        const current = get(),
          tabs = layoutTabs(current.layout);
        const index = Math.max(
          0,
          tabs.findIndex((tab) => tab.id === current.layout.activeLayoutTabId),
        );
        return get().selectLayoutTab(tabs[(index + direction + tabs.length) % tabs.length].id);
      },
      selectTab: (index) => {
        const tabs = layoutTabs(get().layout);
        const tab = index === "last" ? tabs[tabs.length - 1] : tabs[index];
        return tab ? get().selectLayoutTab(tab.id) : null;
      },
      moveTab: (tabId, paneId, index) => get().dockTab(tabId, paneId, "center", index),
      dockTab: (tabId, paneId, zone, index) => get().dockTabGroup([tabId], paneId, zone, index),
      dockTabGroup: (tabIds, paneId, zone) => {
        const current = get();
        if (tabIds.length !== 1) return false;
        const source = layoutTabs(current.layout).find((tab) =>
          dockTabs(tab.root).some((view) => view.id === tabIds[0]),
        );
        const targetTab = layoutTabs(current.layout).find((tab) =>
          dockLeaves(tab.root).some((pane) => pane.id === paneId),
        );
        const target = targetTab && findDockLeaf(targetTab.root, paneId);
        const sourcePane =
          source &&
          dockLeaves(source.root).find((pane) => pane.tabs.some((view) => view.id === tabIds[0]));
        const moving = sourcePane?.tabs.find((view) => view.id === tabIds[0]);
        if (!source || !targetTab || !target || !moving || !sourcePane || sourcePane.id === paneId)
          return false;
        if (zone !== "center" && dockLeaves(targetTab.root).length >= maxWorkspacePanels)
          return false;
        const same = source.id === targetTab.id;
        let sourceRoot = source.root;
        let targetRoot = targetTab.root;
        if (zone === "center") {
          // A pane has one view. Dropping in its center exchanges the views.
          sourceRoot = mapDockLeaf(sourceRoot, sourcePane.id, (pane) => ({
            ...pane,
            tabs: target.tabs,
            activeTabId: target.activeTabId,
            history: target.history,
          }));
          targetRoot = mapDockLeaf(same ? sourceRoot : targetRoot, paneId, (pane) => ({
            ...pane,
            tabs: [moving],
            activeTabId: moving.id,
            history: sourcePane.history,
          }));
        } else {
          sourceRoot = removeDockTab(sourceRoot, moving.id);
          targetRoot = insertDockSplit(same ? sourceRoot : targetRoot, paneId, sourcePane, zone);
        }
        const destinationRoot = collapseEmptyDockLeaves(targetRoot)!;
        const sourceRemaining = collapseEmptyDockLeaves(sourceRoot);
        const destinationPane = dockLeaves(destinationRoot).find((pane) =>
          pane.tabs.some((view) => view.id === moving.id),
        )!;
        const tabs = layoutTabs(current.layout).flatMap((tab) => {
          if (tab.id === targetTab.id)
            return [{ ...tab, root: destinationRoot, focusedPaneId: destinationPane.id }];
          if (tab.id !== source.id) return [tab];
          return sourceRemaining
            ? [{ ...tab, root: sourceRemaining, focusedPaneId: dockLeaves(sourceRemaining)[0].id }]
            : [];
        });
        set(withLayout(current, selectLayoutTab({ ...current.layout, tabs }, targetTab.id)));
        return true;
      },
      detachPaneToTab: (viewId) => {
        const current = get();
        const source = layoutTabs(current.layout).find((tab) =>
          dockTabs(tab.root).some((view) => view.id === viewId),
        );
        if (!source) return false;
        if (dockLeaves(source.root).length === 1) return get().focusTab(viewId);
        const pane = dockLeaves(source.root).find((pane) => pane.tabs[0]?.id === viewId)!;
        const root = removeDockLeaf(source.root, pane.id)!;
        const updated = { ...source, root, focusedPaneId: dockLeaves(root)[0].id };
        const newTab = { id: createDockId("tab"), root: pane, focusedPaneId: pane.id };
        const tabs = layoutTabs(current.layout).map((tab) =>
          tab.id === source.id ? updated : tab,
        );
        set(
          withLayout(
            current,
            appendLayoutTab(selectLayoutTab({ ...current.layout, tabs }, source.id), newTab),
          ),
        );
        return true;
      },
      reorderPaneTabs: (_paneId, ids) => {
        const tabs = layoutTabs(get().layout);
        const order = ids
          .map((id) => tabs.find((tab) => dockTabs(tab.root).some((view) => view.id === id))?.id)
          .filter((id): id is string => Boolean(id));
        if (order.length === tabs.length) get().reorderLayoutTabs(order);
      },
      reorderTab: (_paneId, tabId, index) => {
        const tabs = layoutTabs(get().layout);
        const moving = tabs.find((tab) => dockTabs(tab.root).some((view) => view.id === tabId));
        if (!moving) return;
        const ids = tabs.filter((tab) => tab.id !== moving.id).map((tab) => tab.id);
        ids.splice(Math.max(0, Math.min(index, ids.length)), 0, moving.id);
        get().reorderLayoutTabs(ids);
      },
      splitPane: (paneId, direction, tabId) => {
        const current = get();
        if (tabId) {
          if (!get().dockTab(tabId, paneId, direction)) return null;
          return (
            dockLeaves(get().layout.root).find((pane) => pane.tabs.some((tab) => tab.id === tabId))
              ?.id ?? null
          );
        }
        if (dockLeaves(current.layout.root).length >= maxWorkspacePanels) return null;
        const pane = findDockLeaf(current.layout.root, paneId);
        if (!pane) return null;
        const leaf = createDockLeaf([createDefaultWorkspaceTab(current.activeScopeKey)]);
        set({
          ...withLayout(current, {
            ...current.layout,
            root: normalizePaneLayout(
              insertDockSplit(current.layout.root, paneId, leaf, direction),
            ),
            focusedPaneId: leaf.id,
          }),
        });
        return leaf.id;
      },
      closePane: (paneId) => {
        const pane = findDockLeaf(get().layout.root, paneId);
        if (dockLeaves(get().layout.root).length > 1 && pane?.tabs[0])
          get().closeTab(pane.tabs[0].id, paneId);
      },
      movePane: (paneId, direction, targetPaneId) => {
        const current = get();
        const root = moveDockPane(current.layout.root, paneId, direction, targetPaneId);
        if (root === current.layout.root) return false;
        set({ ...withLayout(current, { ...current.layout, root, focusedPaneId: paneId }) });
        return true;
      },
      swapPanes: (firstPaneId, secondPaneId) => {
        const current = get();
        const root = swapDockLeaves(
          normalizePaneLayout(current.layout.root),
          firstPaneId,
          secondPaneId,
        );
        if (root === current.layout.root) return false;
        set({ ...withLayout(current, { ...current.layout, root, focusedPaneId: secondPaneId }) });
        return true;
      },
      setWindowDockingLayout: (dockingLayout) => {
        if (!validDockingLayout(dockingLayout)) return;
        set((state) => ({
          virtualWindowsByScope: {
            ...state.virtualWindowsByScope,
            [state.activeScopeKey]: currentVirtualWindows(state).map((window) =>
              window.id === state.activeVirtualWindowId
                ? {
                    ...window,
                    dockingLayout: {
                      navigation: dockingLayout.navigation,
                      tabs: dockingLayout.tabs,
                    },
                  }
                : window,
            ),
          },
        }));
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
        const current = get();
        const scopedWindows = currentVirtualWindows(current);
        const closing = scopedWindows.find((workspaceWindow) => workspaceWindow.id === windowId);
        if (!closing || !canCloseWorkspaceWindow(closing, scopedWindows)) return false;
        const update = closeVirtualWindowRemembering(current, windowId);
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
          const root = fillEmptyDockLeaves(current.layout.root, () =>
            createDefaultWorkspaceTab(current.activeScopeKey),
          );
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
          mapAllVirtualWorkspaceTabs(current, (tab) =>
            tab.id === tabId ? { ...tab, sidebarVisible: !tab.sidebarVisible } : tab,
          ),
        );
      },
      replaceSnapshot: (snapshot) => {
        const current = get();
        const windows = snapshot.virtualWindows?.length
          ? snapshot.virtualWindows.map((window) => ({
              ...window,
              layout: normalizeWorkspaceLayout(
                migrateRetiredWorkspaceTabs(window.layout, current.activeScopeKey),
                current.activeScopeKey,
              ),
            }))
          : [
              createWorkspaceVirtualWindow(
                normalizeWorkspaceLayout(
                  migrateRetiredWorkspaceTabs(snapshot.layout, current.activeScopeKey),
                  current.activeScopeKey,
                ),
                undefined,
                current.activeScopeKey,
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
          ...initialWebsiteNavigation(),
          lastUsedTabByGroup: {},
          closedTabs: [],
          closedVirtualWindowsByScope: {},
        });
      },
    }),
    {
      name: workspaceStoreStorageKey,
      version: browserWorkspaceStoreVersion,
      // Native snapshots are captured and batched by the account-bound writer.
      // Avoid serializing the entire layout through Zustand on every resize.
      storage: nativeWorkspaceRecoveryEnabled()
        ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
        : createJSONStorage(() => workspaceRecoveryStorage(localStorage)),
      skipHydration: nativeWorkspaceRecoveryEnabled(),
      migrate: migrateWorkspaceStore,
      partialize: partialWorkspaceStore,
    },
  ),
);

function scopeKeyForSurface(_request: OpenWorkspaceSurfaceRequest): WorkspaceScopeKey {
  return "global";
}

function mapDockLeafForView(
  root: WorkspaceDockNode,
  viewId: string,
  update: (pane: WorkspacePane) => WorkspacePane,
): WorkspaceDockNode {
  const pane = dockLeaves(root).find((pane) => pane.tabs.some((view) => view.id === viewId));
  return pane ? mapDockLeaf(root, pane.id, update) : root;
}

export {
  saveAccountWorkspace,
  restoreAccountWorkspace,
  removeAccountWorkspace,
  resetWorkspaceAccountState,
} from "./workspaceAccountState";
