import {
  initialTabGroups,
  tabGroupActions,
  type TabGroupActions,
  type TabGroupState,
} from "../tab-groups/tabGroups";
import { pinnedTabActions, type PinnedTabActions } from "./pinnedTabs";
import { type DockingLayout } from "@/app/shell/dockingLayout";
import {
  initialBookmarkNavigation,
  type BookmarkNavigationState,
} from "../profiles/navigationDefaults";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  captureLegacyWorkspaceOwner,
  nativeWorkspaceRecoveryEnabled,
  workspaceStoreStorageKey,
} from "../recovery/workspaceRecoveryPlatform";
import {
  browserWorkspaceStoreVersion,
  workspaceRecoveryStorage,
} from "../recovery/workspaceRecoveryStorage";
import type {
  BrowserViewState,
  DockDropZone,
  DockSplitDirection,
  OpenWorkspaceSurfaceRequest,
  WorkspaceDockNode,
  WorkspaceGroupKey,
  WorkspaceView,
} from "./workspaceViews";
import { initialWorkspaceWindow, type WorkspaceWindowsState } from "../profiles/windows";
import { type ClosedWorkspaceItem } from "./closedWorkspaceItems";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";
import { workspaceOpenActions } from "./workspaceOpenActions";
import { workspacePaneActions } from "../panes/workspacePaneActions";
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
  /** Makes a window tab's pane tree the given one: its views come from other tabs, which give them
   * up, and views it no longer holds become tabs of their own. */
  applyLayoutRoot: (tabId: string, root: WorkspaceDockNode) => boolean;
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
      ...tabGroupActions(set, get),
      ...pinnedTabActions(set, get),
      ...workspaceOpenActions(set, get),
      ...workspaceViewActions(set, get),
      ...workspaceTabActions(set, get),
      ...workspacePaneActions(set, get),
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
  adoptAccountWorkspace,
  liveWorkspace,
  saveAccountWorkspace,
  restoreAccountWorkspace,
  removeAccountWorkspace,
  resetWorkspaceAccountState,
} from "./workspaceAccountState";
