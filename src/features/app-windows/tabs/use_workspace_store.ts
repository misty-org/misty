import { type DockingLayout } from "@/app/shell/docking_layout";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  nativeWorkspaceRecoveryEnabled,
  workspaceStoreStorageKey,
} from "../recovery/workspace_recovery_platform";
import {
  browserWorkspaceStoreVersion,
  workspaceRecoveryStorage,
} from "../recovery/workspace_recovery_storage";
import type {
  DockDropZone,
  DockSplitDirection,
  OpenWorkspaceSurfaceRequest,
  WorkspaceDockNode,
  WorkspaceGroupKey,
  WorkspaceView,
} from "./workspace_views";
import { initialWorkspaceWindow, type WorkspaceWindowsState } from "../profiles/windows";
import { type ClosedWorkspaceItem } from "./closed_workspace_items";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspace_store_persistence";
import { workspaceOpenActions } from "./workspace_open_actions";
import { workspacePaneActions } from "../panes/workspace_pane_actions";
import { workspaceTabActions } from "./workspace_tab_actions";
import { workspaceViewActions } from "./workspace_view_actions";

export interface WorkspaceStore extends WorkspaceWindowsState {
  lastUsedViewByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  closedItems: ClosedWorkspaceItem[];
  newTab: (route?: string) => WorkspaceView;
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
  renameView: (tabId: string, title: string) => void;
  updateViewRoute: (tabId: string, route: string, replace?: boolean) => void;
  updateViewState: (tabId: string, state: unknown, title?: string) => void;
  focusPane: (paneId: string) => boolean;
  focusView: (tabId: string) => boolean;
  closeView: (tabId: string, paneId?: string) => boolean;
  reopenClosedView: (index?: number) => WorkspaceView | null;
  cycleView: (direction: 1 | -1) => WorkspaceView | null;
  selectView: (index: number | "last") => WorkspaceView | null;
  dockViews: (tabIds: string[], paneId: string, zone: DockDropZone, index?: number) => boolean;
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

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      ...initialWorkspaceWindow(),
      lastUsedViewByGroup: {},
      closedItems: [],
      ...workspaceOpenActions(set, get),
      ...workspaceViewActions(set, get),
      ...workspaceTabActions(set, get),
      ...workspacePaneActions(set, get),
      reset: () => {
        set({
          ...initialWorkspaceWindow(),
          lastUsedViewByGroup: {},
          closedItems: [],
          dockingLayout: undefined,
        });
      },
    }),
    {
      name: workspaceStoreStorageKey,
      version: browserWorkspaceStoreVersion,
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
} from "./workspace_account_state";
