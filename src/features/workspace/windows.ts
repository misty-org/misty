import {
  recoverPaneHistoryViews,
  isEmptyTab,
  layoutTabs,
  migrateTabs,
  activateTab,
} from "./layoutTabs";
import { reconcileGroupIdentities } from "./groupIdentity";
import {
  capDockLeaves,
  createDockLeaf,
  dockLeaves,
  fillEmptyDockLeaves,
  normalizeDockNode,
} from "./dockTree";
import { maxWorkspacePanes, type WorkspaceLayout, type WorkspaceWindow } from "./model";
import { createDefaultWorkspaceView } from "./workspaceDefaultView";
import { currentWindowId, useProfileWindowStore } from "./profileWindow";
import type { DockingLayout } from "@/features/app-shell/dockingLayout";

/**
 * One renderer runs one OS window, which belongs to one profile for its whole life. Its tabs and
 * panes are `layout`, and `activeWindowId` is the native window's id, which names its saved tabs.
 */
export interface WorkspaceWindowsState {
  activeWindowId: string;
  layout: WorkspaceLayout;
  /** Where this window keeps its navigation and tabs; the device default when unset. */
  dockingLayout?: DockingLayout;
}

type WorkspaceWindowsUpdate = Partial<WorkspaceWindowsState>;

export function initialWorkspaceLayout(): WorkspaceLayout {
  const pane = createDockLeaf([createDefaultWorkspaceView()]);
  return { root: pane, focusedPaneId: pane.id };
}

export function normalizeWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const migrated = recoverPaneHistoryViews(migrateTabs(layout));
  const activeId = migrated.activeTabId ?? layoutTabs(migrated)[0].id;
  // Having no tabs at all is a real state; only fill panes when other tabs exist.
  const noTabs = layoutTabs(migrated).every(isEmptyTab);
  const tabs = layoutTabs(migrated).map((tab) => {
    const source = tab.id === activeId ? migrated : tab;
    const root = normalizeDockNode(
      fillEmptyDockLeaves(
        capDockLeaves(source.root, maxWorkspacePanes),
        noTabs ? undefined : () => createDefaultWorkspaceView(),
      ),
    );
    const panes = dockLeaves(root);
    const normalized = reconcileGroupIdentities({
      root,
      focusedPaneId: panes.some((pane) => pane.id === source.focusedPaneId)
        ? source.focusedPaneId
        : panes[0].id,
    });
    return { ...tab, ...normalized };
  });
  return activateTab({ ...migrated, tabs }, activeId);
}

export function initialWorkspaceWindow(): WorkspaceWindowsState {
  return {
    layout: normalizeWorkspaceLayout(initialWorkspaceLayout()),
    activeWindowId: currentWindowId(),
  };
}

/** This OS window as agents see it, tinted with its profile's color. */
export function currentWindow(state: WorkspaceWindowsState): WorkspaceWindow {
  const { profile } = useProfileWindowStore.getState();
  return {
    id: state.activeWindowId,
    title: profile.name,
    ...(profile.color ? { color: profile.color } : {}),
    ...(state.dockingLayout ? { dockingLayout: state.dockingLayout } : {}),
    layout: state.layout,
    createdAt: 0,
    lastFocusedAt: 0,
  };
}

/** The windows this renderer holds: always its one OS window. */
export function currentWindows(state: WorkspaceWindowsState): WorkspaceWindow[] {
  return [currentWindow(state)];
}

export function withActiveWindowLayout(layout: WorkspaceLayout): WorkspaceWindowsUpdate {
  return { layout: normalizeWorkspaceLayout(layout) };
}
