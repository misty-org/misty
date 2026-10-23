import {
  initialTabGroups,
  tabGroupActions,
  type TabGroupActions,
  type TabGroupState,
} from "./tabGroups";
import { pinnedTabActions, type PinnedTabActions } from "./pinnedTabs";
import { type DockingLayout } from "@/features/app-shell/dockingLayout";
import {
  initialBookmarkNavigation,
  type BookmarkNavigationState,
} from "@/features/browser-sync/navigationDefaults";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  captureLegacyWorkspaceOwner,
  nativeWorkspaceRecoveryEnabled,
  workspaceStoreStorageKey,
} from "./workspaceRecoveryPlatform";
import { browserWorkspaceStoreVersion, workspaceRecoveryStorage } from "./workspaceRecoveryStorage";
import type {
  BrowserViewState,
  DockDropZone,
  DockSplitDirection,
  OpenWorkspaceSurfaceRequest,
  WorkspaceGroupKey,
  WorkspaceScopeKey,
  WorkspaceSnapshot,
  WorkspaceView,
} from "./model";
import {
  currentWindows,
  initialWorkspaceWindow,
  normalizeWorkspaceLayout,
  showSpaceScope,
  type WorkspaceWindowsState,
} from "./windows";
import { migrateRetiredWorkspaceViews } from "./workspaceMigrations";
import { type ClosedWorkspaceItem } from "./closedWorkspaceItems";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";
import { upgradeWorkspaceShape } from "./workspaceShapeUpgrade";
import { workspaceOpenActions } from "./workspaceOpenActions";
import { workspacePaneActions } from "./workspacePaneActions";
import { workspaceTabActions } from "./workspaceTabActions";
import { workspaceViewActions } from "./workspaceViewActions";

export interface WorkspaceStore
  extends
    WorkspaceWindowsState,
    BookmarkNavigationState,
    TabGroupState,
    TabGroupActions,
    PinnedTabActions {
  lastUsedViewByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  closedItems: ClosedWorkspaceItem[];
  newTab: () => WorkspaceView;
  navigatePane: (delta: number, paneId?: string) => WorkspaceView | null;
  detachPaneToTab: (viewId: string) => boolean;
  selectTab: (id: string) => WorkspaceView | null;
  closeTab: (id: string) => boolean;
  renameTab: (id: string, title: string) => void;
  reorderTabs: (ids: string[]) => void;
  setScope: (scopeKey: WorkspaceScopeKey) => void;
  /** Shows another Space in this window (after the native side switched it). */
  showSpace: (scopeKey: WorkspaceScopeKey) => void;
  openSurface: (request: OpenWorkspaceSurfaceRequest) => WorkspaceView;
  openDestination: (request: OpenWorkspaceSurfaceRequest) => WorkspaceView;
  commitPlaceholder: (tabId: string) => void;
  addSurface: (request: OpenWorkspaceSurfaceRequest) => WorkspaceView;
  openBrowserView: (request?: {
    url?: string;
    paneId?: string;
    sourceViewId?: string;
    bookmarkId?: string;
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
  fillEmptyPanes: () => void;
  updateSplitRatio: (splitId: string, ratio: number) => void;
  toggleSidebar: (tabId: string) => void;
  replaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
  createSnapshot: (accountId: string, deviceId: string) => WorkspaceSnapshot;
  reset: () => void;
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
      // Every scope is a Space now, so a scope change is a Space change with its window id.
      setScope: (scopeKey) => {
        const update = showSpaceScope(get(), scopeKey);
        if (update) set(update);
      },
      showSpace: (scopeKey) => {
        const update = showSpaceScope(get(), scopeKey);
        if (update) set(update);
      },
      ...tabGroupActions(set, get),
      ...pinnedTabActions(set, get),
      ...workspaceOpenActions(set, get),
      ...workspaceViewActions(set, get),
      ...workspaceTabActions(set, get),
      ...workspacePaneActions(set, get),
      replaceSnapshot: (saved) => {
        const snapshot = upgradeWorkspaceShape(saved);
        const current = get();
        // A snapshot from before Spaces had windows may hold several; this window
        // takes the one that was active.
        const window =
          snapshot.windows?.find((item) => item.id === snapshot.activeWindowId) ??
          snapshot.windows?.[0];
        const layout = normalizeWorkspaceLayout(
          migrateRetiredWorkspaceViews(window?.layout ?? snapshot.layout),
          current.activeScopeKey,
        );
        set({
          layout,
          layoutsByScope: { ...current.layoutsByScope, [current.activeScopeKey]: layout },
          activeWindowId: window?.id ?? current.activeWindowId,
          ...(window?.dockingLayout ? { dockingLayout: window.dockingLayout } : {}),
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
          dockingLayout: undefined,
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

export {
  saveAccountWorkspace,
  restoreAccountWorkspace,
  removeAccountWorkspace,
  resetWorkspaceAccountState,
} from "./workspaceAccountState";
