import {
  contiguousTabs,
  initialTabGroups,
  tabGroupActions,
  type TabGroupActions,
  type TabGroupState,
} from "./tabGroups";
import { validDockingLayout, type DockingLayout } from "@/features/app-shell/dockingLayout";
import {
  initialBookmarkNavigation,
  type BookmarkNavigationState,
} from "@/features/browser-workspace/navigationDefaults";
import { pushPaneView, traversePaneHistory } from "./paneHistory";
import {
  activeLayoutView,
  allLayoutViews,
  appendTab,
  emptyTab,
  layoutTabs,
  activateTab,
  singleViewTab,
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
  dockTreeViews,
  fillEmptyDockLeaves,
  findDockLeaf,
  insertDockSplit,
  mapDockLeaf,
  mapDockLeafForView,
  moveDockPane,
  normalizePaneLayout,
  removeDockLeaf,
  swapDockLeaves,
  updateDockSplitRatio,
} from "./dockTree";
import type {
  BrowserViewState,
  DockDropZone,
  DockSplitDirection,
  OpenWorkspaceSurfaceRequest,
  WorkspaceGroupKey,
  WorkspaceLayout,
  WorkspaceScopeKey,
  WorkspaceSnapshot,
  WorkspaceView,
  WorkspaceWindow,
} from "./model";
import {
  addWindow,
  adoptDefaultWorkspaceScope,
  createWorkspaceWindow,
  currentWindows,
  extractPaneToWindow,
  initialWorkspaceWindow,
  mapAllWorkspaceWindowViews,
  mapAllWorkspaceWindowLayouts,
  normalizeWorkspaceLayout,
  renameWindow,
  switchWindow,
  switchWorkspaceScope,
  withActiveWindowLayout,
  type WorkspaceWindowsState,
} from "./windows";
import { migrateRetiredWorkspaceViews } from "./workspaceMigrations";
import { isPrivateBrowserView } from "./privateBrowsing";
import {
  compareViewRecency,
  canCloseWorkspaceView,
  canCloseWorkspaceWindow,
  lastUsedUpdatesForView,
  nextWorkspaceFocusTimestamp,
  removeDockView,
} from "./workspaceViewOperations";
import { closeWindowRemembering, reopenRememberedWindow } from "./closedWindows";
import {
  rememberClosedWorkspaceView,
  restoreClosedWorkspaceItem,
  type ClosedWorkspaceItem,
} from "./closedWorkspaceItems";
import {
  browserHomeUrl,
  browserViewTitle,
  createBrowserViewState,
  maxWorkspacePanels,
  parseBrowserViewState,
  sanitizeBrowserTitle,
} from "./model";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";
import { upgradeWorkspaceShape } from "./workspaceShapeUpgrade";
import { createDefaultWorkspaceView, createBlankWorkspaceView } from "./workspaceDefaultView";

export interface WorkspaceStore
  extends WorkspaceWindowsState, BookmarkNavigationState, TabGroupState, TabGroupActions {
  lastUsedViewByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  closedItems: ClosedWorkspaceItem[];
  closedWindowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceWindow[]>>;
  newTab: () => WorkspaceView;
  navigatePane: (delta: number, paneId?: string) => WorkspaceView | null;
  detachPaneToTab: (viewId: string) => boolean;
  selectTab: (id: string) => WorkspaceView | null;
  closeTab: (id: string) => boolean;
  renameTab: (id: string, title: string) => void;
  reorderTabs: (ids: string[]) => void;
  setScope: (scopeKey: WorkspaceScopeKey) => void;
  adoptDefaultScope: (scopeKey: WorkspaceScopeKey, validScopes?: Set<string>) => void;
  openSurface: (request: OpenWorkspaceSurfaceRequest) => WorkspaceView;
  openDestination: (request: OpenWorkspaceSurfaceRequest) => WorkspaceView;
  commitPlaceholder: (tabId: string) => void;
  addSurface: (request: OpenWorkspaceSurfaceRequest) => WorkspaceView;
  openBrowserView: (request?: {
    url?: string;
    paneId?: string;
    sourceViewId?: string;
    bookmarkId?: string;
    /** Open as a private tab. Tabs opened from a private tab are private too. */
    private?: boolean;
  }) => WorkspaceView;
  updateBrowserView: (tabId: string, patch: Partial<BrowserViewState> & { title?: string }) => void;
  renameView: (tabId: string, title: string) => void;
  updateViewRoute: (tabId: string, route: string, replace?: boolean) => void;
  updateViewState: (tabId: string, state: unknown, title?: string) => void;
  focusPane: (paneId: string) => boolean;
  focusView: (tabId: string) => boolean;
  closeView: (tabId: string, paneId?: string) => boolean;
  /** Reopens a closed tab; the most recently closed one by default. */
  reopenClosedView: (index?: number) => WorkspaceView | null;
  cycleView: (direction: 1 | -1) => WorkspaceView | null;
  selectView: (index: number | "last") => WorkspaceView | null;
  dockViews: (tabIds: string[], paneId: string, zone: DockDropZone, index?: number) => boolean;
  moveView: (tabId: string, paneId: string, index?: number) => boolean;
  dockView: (tabId: string, paneId: string, zone: DockDropZone, index?: number) => boolean;
  reorderPaneViews: (paneId: string, ids: string[]) => void;
  reorderView: (paneId: string, tabId: string, index: number) => void;
  splitPane: (paneId: string, direction: DockSplitDirection, tabId?: string) => string | null;
  closePane: (paneId: string) => void;
  swapPanes: (firstPaneId: string, secondPaneId: string) => boolean;
  movePane: (paneId: string, direction: DockSplitDirection, targetPaneId?: string) => boolean;
  setWindowDockingLayout: (layout: DockingLayout) => void;
  createWindow: (title?: string) => WorkspaceWindow;
  switchWindow: (windowId: string) => boolean;
  closeWindow: (windowId: string) => boolean;
  reopenClosedWindow: () => WorkspaceWindow | null;
  extractPaneToWindow: (paneId: string) => WorkspaceWindow | null;
  renameWindow: (windowId: string, title: string) => void;
  fillEmptyPanes: () => void;
  updateSplitRatio: (splitId: string, ratio: number) => void;
  toggleSidebar: (tabId: string) => void;
  replaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
  createSnapshot: (accountId: string, deviceId: string) => WorkspaceSnapshot;
  reset: () => void;
}

function withLayout(state: WorkspaceStore, layout: WorkspaceLayout) {
  return withActiveWindowLayout(state, reconcileGroupIdentities(layout, state.layout));
}

if (nativeWorkspaceRecoveryEnabled()) captureLegacyWorkspaceOwner();

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      ...initialWorkspaceWindow(),
      ...initialBookmarkNavigation(),
      ...initialTabGroups(),
      lastUsedViewByGroup: {},
      closedItems: [],
      closedWindowsByScope: {},
      setScope: (scopeKey) => {
        const update = switchWorkspaceScope(get(), scopeKey);
        if (update) set(update);
      },
      adoptDefaultScope: (scopeKey, validScopes) => {
        const update = adoptDefaultWorkspaceScope(get(), scopeKey, validScopes);
        if (update) set(update);
      },
      ...tabGroupActions(set, get),
      openSurface: (request) => {
        if (request.scopeKey) get().setScope(request.scopeKey);
        else if (request.surfaceId === "space") get().setScope(scopeKeyForSurface(request));
        const current = get();
        const pane =
          findDockLeaf(current.layout.root, request.paneId ?? current.layout.focusedPaneId) ??
          dockLeaves(current.layout.root)[0];
        const previous = pane.views[0];
        const replacePane =
          Boolean(previous?.placeholder) && (!request.forceNew || Boolean(request.paneId));
        const existing =
          !replacePane && !request.forceNew
            ? allLayoutViews(current.layout)
                .filter(
                  (tab) =>
                    !tab.placeholder &&
                    tab.groupKey === request.groupKey &&
                    !isPrivateBrowserView(tab),
                )
                // Prefer the tab already showing this route so a close or a URL
                // change never re-targets a sibling in the same group.
                .sort(
                  (a, b) =>
                    Number(b.route === request.route) - Number(a.route === request.route) ||
                    compareViewRecency(a, b),
                )[0]
            : undefined;
        if (existing) {
          get().focusView(existing.id);
          if (request.syncExistingRoute && existing.route !== request.route)
            get().updateViewRoute(existing.id, request.route);
          return allLayoutViews(get().layout).find((tab) => tab.id === existing.id)!;
        }
        const now = nextWorkspaceFocusTimestamp(current.windowsByScope);
        const tab: WorkspaceView = {
          id: createDockId("tab"),
          surfaceId: request.surfaceId,
          groupKey: request.groupKey,
          instanceKey: createDockId("tab"),
          title: request.title,
          route: request.route,
          sidebarVisible: request.sidebarVisible ?? true,
          state: request.state ?? {},
          createdAt: now,
          lastFocusedAt: now,
        };
        const layout = replacePane
          ? {
              ...current.layout,
              focusedPaneId: pane.id,
              root: mapDockLeaf(current.layout.root, pane.id, (leaf) => ({
                ...leaf,
                views: [tab],
                activeViewId: tab.id,
                history: undefined,
              })),
            }
          : appendTab(current.layout, singleViewTab(tab));
        set({
          ...withLayout(current, layout),
          lastUsedViewByGroup: {
            ...current.lastUsedViewByGroup,
            ...lastUsedUpdatesForView(tab, tab.id),
          },
        });
        return tab;
      },
      openDestination: (request) => {
        if (request.scopeKey) get().setScope(request.scopeKey);
        const current = get();
        // An explicit new tab/split is an invitation to create another instance.
        if (!activeLayoutView(current.layout)?.placeholder) {
          const spaceId = request.surfaceId === "space" ? request.groupKey.split(":")[1] : null;
          const existing = allLayoutViews(current.layout)
            .filter(
              (tab) =>
                !tab.placeholder &&
                !isPrivateBrowserView(tab) &&
                (spaceId
                  ? tab.surfaceId === "space" && tab.groupKey.split(":")[1] === spaceId
                  : tab.groupKey === request.groupKey),
            )
            .sort(compareViewRecency)[0];
          if (existing) {
            get().focusView(existing.id);
            return existing;
          }
        }
        return get().openSurface({ ...request, syncExistingRoute: false });
      },
      commitPlaceholder: (tabId) => {
        if (!allLayoutViews(get().layout).some((tab) => tab.id === tabId && tab.placeholder))
          return;
        set((current) =>
          mapAllWorkspaceWindowViews(current, (tab) =>
            tab.id === tabId ? { ...tab, placeholder: false } : tab,
          ),
        );
      },
      addSurface: (request) => get().openSurface({ ...request, forceNew: true }),
      newTab: () => {
        const current = get(),
          view = createBlankWorkspaceView(current.activeScopeKey);
        set(withLayout(current, appendTab(current.layout, singleViewTab(view))));
        return view;
      },
      navigatePane: (delta, paneId) => {
        const current = get(),
          pane = findDockLeaf(current.layout.root, paneId ?? current.layout.focusedPaneId);
        if (!pane) return null;
        const next = traversePaneHistory(pane, delta);
        if (
          !next ||
          (pane.views[0]?.id !== next.views[0]?.id && !canCloseWorkspaceView(pane.views[0]))
        )
          return null;
        set(
          withLayout(current, {
            ...current.layout,
            root: mapDockLeaf(current.layout.root, pane.id, () => next),
            focusedPaneId: pane.id,
          }),
        );
        return next.views[0] ?? null;
      },
      openBrowserView: (request = {}) => {
        const url = request.url?.trim() || browserHomeUrl();
        let sourcePrivate = false;
        if (request.sourceViewId) {
          mapAllWorkspaceWindowViews(get(), (candidate) => {
            if (candidate.id === request.sourceViewId && isPrivateBrowserView(candidate))
              sourcePrivate = true;
            return candidate;
          });
        }
        const isPrivate = request.private || sourcePrivate;
        const tab = get().openSurface({
          surfaceId: "browser",
          groupKey: "tool:browser",
          scopeKey: "global",
          title: browserViewTitle(url),
          route: "/browser",
          state: {
            ...createBrowserViewState(url),
            bookmarkId: request.bookmarkId,
            ...(isPrivate ? { private: true } : {}),
          },
          instancePolicy: "multiple",
          forceNew: true,
          paneId: request.paneId,
        });
        get().focusView(tab.id);
        return tab;
      },
      updateBrowserView: (tabId, patch) => {
        set((current) =>
          mapAllWorkspaceWindowViews(current, (tab) => {
            if (
              tab.id !== tabId ||
              (tab.surfaceId !== "browser" &&
                !(tab.surfaceId === "official-app" && tab.groupKey === "app:browser"))
            )
              return tab;
            const { title, ...statePatch } = patch;
            const existing = parseBrowserViewState(tab.state);
            const nextUrl = statePatch.url ?? existing.url;
            const defaults =
              statePatch.url && statePatch.url !== existing.url
                ? { ...existing, ...createBrowserViewState(statePatch.url) }
                : existing;
            const resolvedTitle =
              title !== undefined
                ? sanitizeBrowserTitle(title, nextUrl)
                : statePatch.url && statePatch.url !== existing.url
                  ? browserViewTitle(statePatch.url)
                  : tab.title;
            return {
              ...tab,
              placeholder: nextUrl !== existing.url ? false : tab.placeholder,
              title: resolvedTitle,
              state: { ...defaults, ...statePatch } satisfies BrowserViewState,
            };
          }),
        );
      },
      renameView: (tabId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set((current) =>
          mapAllWorkspaceWindowViews(current, (tab) =>
            tab.id === tabId && tab.title !== trimmed ? { ...tab, title: trimmed } : tab,
          ),
        );
      },
      updateViewRoute: (tabId, route, replace = false) => {
        set(
          mapAllWorkspaceWindowLayouts(get(), (layout) => {
            const tabs = layoutTabs(layout).map((tab) => ({
              ...tab,
              root: mapDockLeafForView(tab.root, tabId, (pane) => {
                const view = pane.views[0];
                return view.route === route
                  ? pane
                  : pushPaneView(pane, { ...view, route, placeholder: false }, replace);
              }),
            }));
            return activateTab({ ...layout, tabs }, layout.activeTabId ?? tabs[0].id);
          }),
        );
      },
      updateViewState: (tabId, state, title) => {
        set((current) =>
          mapAllWorkspaceWindowViews(current, (tab) =>
            tab.id === tabId ? { ...tab, state, title: title?.trim() || tab.title } : tab,
          ),
        );
      },
      focusPane: (paneId) => {
        const current = get();
        const pane = findDockLeaf(current.layout.root, paneId);
        if (!pane) return false;
        const tab =
          pane.views.find((candidate) => candidate.id === pane.activeViewId) ?? pane.views[0];
        if (tab) return get().focusView(tab.id);
        if (current.layout.focusedPaneId === paneId) return true;
        set(
          withLayout(current, {
            ...current.layout,
            focusedPaneId: paneId,
          }),
        );
        return true;
      },
      focusView: (tabId) => {
        let current = get();
        const owner = currentWindows(current).find((window) =>
          allLayoutViews(window.layout).some((tab) => tab.id === tabId),
        );
        if (!owner) return false;
        if (owner.id !== current.activeWindowId) get().switchWindow(owner.id);
        current = get();
        const ownerTab = layoutTabs(current.layout).find((tab) =>
          dockTreeViews(tab.root).some((view) => view.id === tabId),
        );
        if (!ownerTab) return false;
        if (ownerTab.tabGroupId) {
          set({
            tabGroups: get().tabGroups.map((g) =>
              g.id === ownerTab.tabGroupId && g.collapsed ? { ...g, collapsed: false } : g,
            ),
          });
          current = get();
        }
        const switched =
          ownerTab.id !== current.layout.activeTabId || owner.id !== get().activeWindowId;
        if (ownerTab.id !== current.layout.activeTabId) {
          set(withLayout(current, activateTab(current.layout, ownerTab.id)));
          current = get();
        }
        const pane = dockLeaves(current.layout.root).find((candidate) =>
          candidate.views.some((tab) => tab.id === tabId),
        );
        const tab = pane?.views.find((candidate) => candidate.id === tabId);
        if (!pane || !tab) return false;
        const updates = lastUsedUpdatesForView(tab, tabId);
        if (!switched && current.layout.focusedPaneId === pane.id && pane.activeViewId === tabId) {
          if (
            (Object.keys(updates) as WorkspaceGroupKey[]).every(
              (key) => current.lastUsedViewByGroup[key] === updates[key],
            )
          ) {
            return true;
          }
          set({ lastUsedViewByGroup: { ...current.lastUsedViewByGroup, ...updates } });
          return true;
        }
        const now = nextWorkspaceFocusTimestamp(current.windowsByScope);
        set({
          ...withLayout(current, {
            ...current.layout,
            focusedPaneId: pane.id,
            root: mapDockLeaf(current.layout.root, pane.id, (candidate) => ({
              ...candidate,
              activeViewId: tabId,
              views: candidate.views.map((item) =>
                item.id === tabId ? { ...item, lastFocusedAt: now } : item,
              ),
            })),
          }),
          lastUsedViewByGroup: { ...current.lastUsedViewByGroup, ...updates },
        });
        return true;
      },
      selectTab: (id) => {
        const current = get();
        const selected = layoutTabs(current.layout).find((tab) => tab.id === id);
        if (!selected) return null;
        if (selected.tabGroupId)
          set({
            tabGroups: current.tabGroups.map((g) =>
              g.id === selected.tabGroupId ? { ...g, collapsed: false } : g,
            ),
          });
        const view = activeLayoutView(selected);
        if (view) get().focusView(view.id);
        else set(withLayout(current, activateTab(current.layout, id)));
        return view;
      },
      renameTab: (id, title) => {
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
      reorderTabs: (ids) => {
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
            tabs: contiguousTabs(ids.map((id) => tabs.find((tab) => tab.id === id)!)),
          }),
        );
      },
      closeTab: (id) => {
        if (!canCloseWorkspaceView()) return false;
        const current = get(),
          tabs = layoutTabs(current.layout);
        const closing = tabs.find((tab) => tab.id === id);
        if (!closing || dockTreeViews(closing.root).some((view) => !canCloseWorkspaceView(view)))
          return false;
        const view = activeLayoutView(closing);
        if (tabs.length === 1 && currentWindows(current).length > 1) {
          const update = closeWindowRemembering(current, current.activeWindowId);
          if (!update) return false;
          set({
            ...update,
            closedItems: view
              ? [
                  {
                    view,
                    windowId: current.activeWindowId,
                    paneId: closing.focusedPaneId,
                    tab: closing,
                  },
                  ...current.closedItems,
                ].slice(0, 20)
              : current.closedItems,
          });
          return true;
        }
        let remaining = tabs.filter((tab) => tab.id !== id);
        if (!remaining.length) remaining = [emptyTab()];
        const next =
          remaining.find((tab) => tab.id === current.layout.activeTabId) ??
          [...remaining].sort(
            (a, b) =>
              Math.max(...dockTreeViews(b.root).map((view) => view.lastFocusedAt)) -
              Math.max(...dockTreeViews(a.root).map((view) => view.lastFocusedAt)),
          )[0];
        set({
          ...withLayout(current, activateTab({ ...current.layout, tabs: remaining }, next.id)),
          closedItems: view
            ? [
                {
                  view,
                  windowId: current.activeWindowId,
                  paneId: closing.focusedPaneId,
                  tab: closing,
                },
                ...current.closedItems,
              ].slice(0, 20)
            : current.closedItems,
        });
        return true;
      },
      closeView: (tabId, paneId) => {
        const current = get();
        const owner = layoutTabs(current.layout).find((tab) =>
          dockTreeViews(tab.root).some((view) => view.id === tabId),
        );
        if (!owner) return false;
        if (dockTreeViews(owner.root).length === 1) return get().closeTab(owner.id);
        const pane = dockLeaves(owner.root).find(
          (pane) => (!paneId || pane.id === paneId) && pane.views.some((view) => view.id === tabId),
        );
        const view = pane?.views.find((view) => view.id === tabId);
        if (!pane || !view || !canCloseWorkspaceView(view)) return false;
        const root = collapseEmptyDockLeaves(removeDockView(owner.root, tabId));
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
          ...withLayout(current, activateTab(layout, current.layout.activeTabId ?? owner.id)),
          closedItems: [
            {
              ...rememberClosedWorkspaceView(owner, view, current.activeWindowId),
              tabId: owner.id,
            },
            ...current.closedItems,
          ].slice(0, 20),
        });
        return true;
      },
      reopenClosedView: (index = 0) => {
        let current = get();
        const closed = current.closedItems[index];
        if (!closed) return null;
        const closedTabs = current.closedItems.filter((_, position) => position !== index);
        if (
          closed.windowId !== current.activeWindowId &&
          currentWindows(current).some((window) => window.id === closed.windowId)
        ) {
          get().switchWindow(closed.windowId);
          current = get();
        }
        let layout: WorkspaceLayout;
        if (closed.tab) layout = appendTab(current.layout, closed.tab);
        else {
          const owner = layoutTabs(current.layout).find((tab) => tab.id === closed.tabId);
          if (owner && dockLeaves(owner.root).length < maxWorkspacePanels) {
            const restored = restoreClosedWorkspaceItem(owner, closed, closed.view);
            const updated = {
              ...owner,
              root: restored.root,
              focusedPaneId: restored.focusedPaneId,
            };
            layout = activateTab(
              {
                ...current.layout,
                tabs: layoutTabs(current.layout).map((tab) =>
                  tab.id === owner.id ? updated : tab,
                ),
              },
              owner.id,
            );
          } else {
            const restored = singleViewTab(closed.view);
            if (closed.pane) {
              restored.root = closed.pane;
              restored.focusedPaneId = closed.pane.id;
            }
            layout = appendTab(current.layout, restored);
          }
        }
        set({ ...withLayout(current, layout), closedItems: closedTabs });
        get().focusView(closed.view.id);
        return closed.view;
      },
      cycleView: (direction) => {
        const current = get(),
          tabs = layoutTabs(current.layout);
        const index = Math.max(
          0,
          tabs.findIndex((tab) => tab.id === current.layout.activeTabId),
        );
        return get().selectTab(tabs[(index + direction + tabs.length) % tabs.length].id);
      },
      selectView: (index) => {
        const tabs = layoutTabs(get().layout);
        const tab = index === "last" ? tabs[tabs.length - 1] : tabs[index];
        return tab ? get().selectTab(tab.id) : null;
      },
      moveView: (tabId, paneId, index) => get().dockView(tabId, paneId, "center", index),
      dockView: (tabId, paneId, zone, index) => get().dockViews([tabId], paneId, zone, index),
      dockViews: (tabIds, paneId, zone) => {
        const current = get();
        if (tabIds.length !== 1) return false;
        const source = layoutTabs(current.layout).find((tab) =>
          dockTreeViews(tab.root).some((view) => view.id === tabIds[0]),
        );
        const targetTab = layoutTabs(current.layout).find((tab) =>
          dockLeaves(tab.root).some((pane) => pane.id === paneId),
        );
        const target = targetTab && findDockLeaf(targetTab.root, paneId);
        const sourcePane =
          source &&
          dockLeaves(source.root).find((pane) => pane.views.some((view) => view.id === tabIds[0]));
        const moving = sourcePane?.views.find((view) => view.id === tabIds[0]);
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
            views: target.views,
            activeViewId: target.activeViewId,
            history: target.history,
          }));
          targetRoot = mapDockLeaf(same ? sourceRoot : targetRoot, paneId, (pane) => ({
            ...pane,
            views: [moving],
            activeViewId: moving.id,
            history: sourcePane.history,
          }));
        } else {
          sourceRoot = removeDockView(sourceRoot, moving.id);
          targetRoot = insertDockSplit(same ? sourceRoot : targetRoot, paneId, sourcePane, zone);
        }
        const destinationRoot = collapseEmptyDockLeaves(targetRoot)!;
        const sourceRemaining = collapseEmptyDockLeaves(sourceRoot);
        const destinationPane = dockLeaves(destinationRoot).find((pane) =>
          pane.views.some((view) => view.id === moving.id),
        )!;
        const tabs = layoutTabs(current.layout).flatMap((tab) => {
          if (tab.id === targetTab.id)
            return [{ ...tab, root: destinationRoot, focusedPaneId: destinationPane.id }];
          if (tab.id !== source.id) return [tab];
          return sourceRemaining
            ? [{ ...tab, root: sourceRemaining, focusedPaneId: dockLeaves(sourceRemaining)[0].id }]
            : [];
        });
        set(withLayout(current, activateTab({ ...current.layout, tabs }, targetTab.id)));
        return true;
      },
      detachPaneToTab: (viewId) => {
        const current = get();
        const source = layoutTabs(current.layout).find((tab) =>
          dockTreeViews(tab.root).some((view) => view.id === viewId),
        );
        if (!source) return false;
        if (dockLeaves(source.root).length === 1) return get().focusView(viewId);
        const pane = dockLeaves(source.root).find((pane) => pane.views[0]?.id === viewId)!;
        const root = removeDockLeaf(source.root, pane.id)!;
        const updated = { ...source, root, focusedPaneId: dockLeaves(root)[0].id };
        const newTab = { id: createDockId("tab"), root: pane, focusedPaneId: pane.id };
        const tabs = layoutTabs(current.layout).map((tab) =>
          tab.id === source.id ? updated : tab,
        );
        set(
          withLayout(
            current,
            appendTab(activateTab({ ...current.layout, tabs }, source.id), newTab),
          ),
        );
        return true;
      },
      reorderPaneViews: (_paneId, ids) => {
        const tabs = layoutTabs(get().layout);
        const order = ids
          .map(
            (id) => tabs.find((tab) => dockTreeViews(tab.root).some((view) => view.id === id))?.id,
          )
          .filter((id): id is string => Boolean(id));
        if (order.length === tabs.length) get().reorderTabs(order);
      },
      reorderView: (_paneId, tabId, index) => {
        const tabs = layoutTabs(get().layout);
        const moving = tabs.find((tab) =>
          dockTreeViews(tab.root).some((view) => view.id === tabId),
        );
        if (!moving) return;
        const ids = tabs.filter((tab) => tab.id !== moving.id).map((tab) => tab.id);
        ids.splice(Math.max(0, Math.min(index, ids.length)), 0, moving.id);
        get().reorderTabs(ids);
      },
      splitPane: (paneId, direction, tabId) => {
        const current = get();
        if (tabId) {
          if (!get().dockView(tabId, paneId, direction)) return null;
          return (
            dockLeaves(get().layout.root).find((pane) => pane.views.some((tab) => tab.id === tabId))
              ?.id ?? null
          );
        }
        if (dockLeaves(current.layout.root).length >= maxWorkspacePanels) return null;
        const pane = findDockLeaf(current.layout.root, paneId);
        if (!pane) return null;
        const leaf = createDockLeaf([createBlankWorkspaceView(current.activeScopeKey)]);
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
        if (dockLeaves(get().layout.root).length > 1 && pane?.views[0])
          get().closeView(pane.views[0].id, paneId);
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
          windowsByScope: {
            ...state.windowsByScope,
            [state.activeScopeKey]: currentWindows(state).map((window) =>
              window.id === state.activeWindowId
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
      createWindow: (title) => {
        const { window, update } = addWindow(get(), title);
        set(update);
        return window;
      },
      switchWindow: (windowId) => {
        const update = switchWindow(get(), windowId);
        if (!update) return false;
        set(update);
        return true;
      },
      closeWindow: (windowId) => {
        const current = get();
        const scopedWindows = currentWindows(current);
        const closing = scopedWindows.find((workspaceWindow) => workspaceWindow.id === windowId);
        if (!closing || !canCloseWorkspaceWindow(closing, scopedWindows)) return false;
        const update = closeWindowRemembering(current, windowId);
        if (!update) return false;
        set(update);
        return true;
      },
      reopenClosedWindow: () => {
        const result = reopenRememberedWindow(get());
        if (!result) return null;
        set(result.update);
        return result.window;
      },
      extractPaneToWindow: (paneId) => {
        const result = extractPaneToWindow(get(), paneId);
        if (!result) return null;
        set(result.update);
        const { window } = result;
        return window;
      },
      renameWindow: (windowId, title) => {
        const update = renameWindow(get(), windowId, title);
        if (update) set(update);
      },
      fillEmptyPanes: () => {
        set((current) => {
          const root = fillEmptyDockLeaves(current.layout.root, () =>
            createDefaultWorkspaceView(current.activeScopeKey),
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
          mapAllWorkspaceWindowViews(current, (tab) =>
            tab.id === tabId ? { ...tab, sidebarVisible: !tab.sidebarVisible } : tab,
          ),
        );
      },
      replaceSnapshot: (saved) => {
        const snapshot = upgradeWorkspaceShape(saved);
        const current = get();
        const windows = snapshot.windows?.length
          ? snapshot.windows.map((window) => ({
              ...window,
              layout: normalizeWorkspaceLayout(
                migrateRetiredWorkspaceViews(window.layout, current.activeScopeKey),
                current.activeScopeKey,
              ),
            }))
          : [
              createWorkspaceWindow(
                normalizeWorkspaceLayout(
                  migrateRetiredWorkspaceViews(snapshot.layout, current.activeScopeKey),
                  current.activeScopeKey,
                ),
                undefined,
                current.activeScopeKey,
              ),
            ];
        const activeWindow =
          windows.find((window) => window.id === snapshot.activeWindowId) ?? windows[0];
        set({
          layout: activeWindow.layout,
          layoutsByScope: {
            ...current.layoutsByScope,
            [current.activeScopeKey]: activeWindow.layout,
          },
          activeWindowId: activeWindow.id,
          activeWindowIdByScope: {
            ...current.activeWindowIdByScope,
            [current.activeScopeKey]: activeWindow.id,
          },
          windowsByScope: {
            ...current.windowsByScope,
            [current.activeScopeKey]: windows,
          },
          lastUsedViewByGroup: snapshot.lastUsedViewByGroup ?? {},
          ...(snapshot.tabGroups ? { tabGroups: snapshot.tabGroups } : {}),
        });
      },
      createSnapshot: (accountId, deviceId) => ({
        version: 4,
        tabGroups: get().tabGroups,
        accountId,
        deviceId,
        savedAt: Date.now(),
        layout: get().layout,
        lastUsedViewByGroup: get().lastUsedViewByGroup,
        windows: currentWindows(get()),
        activeWindowId: get().activeWindowId,
      }),
      reset: () => {
        set(initialTabGroups());
        set({
          ...initialWorkspaceWindow(),
          ...initialBookmarkNavigation(),
          lastUsedViewByGroup: {},
          closedItems: [],
          closedWindowsByScope: {},
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

export {
  saveAccountWorkspace,
  restoreAccountWorkspace,
  removeAccountWorkspace,
  resetWorkspaceAccountState,
} from "./workspaceAccountState";
