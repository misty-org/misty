import {
  recoverPaneHistoryViews,
  isEmptyTab,
  layoutTabs,
  migrateTabs,
  activateTab,
} from "../panes/layout_tabs";
import { reconcileGroupIdentities } from "../panes/group_identity";
import {
  capDockLeaves,
  createDockLeaf,
  dockLeaves,
  fillEmptyDockLeaves,
  normalizeDockNode,
} from "../panes/dock_tree";
import {
  maxWorkspacePanes,
  type WorkspaceLayout,
  type WorkspaceWindow,
} from "../tabs/workspace_views";
import { createDefaultWorkspaceView } from "../tabs/workspace_default_view";
import { currentWindowId, useProfileWindowStore } from "./profile_window";
import type { DockingLayout } from "@/app/shell/docking_layout";

export interface WorkspaceWindowsState {
  activeWindowId: string;
  layout: WorkspaceLayout;
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

function currentWindow(state: WorkspaceWindowsState): WorkspaceWindow {
  const { profile } = useProfileWindowStore.getState();
  return {
    id: state.activeWindowId,
    title: profile.name,
    ...(state.dockingLayout ? { dockingLayout: state.dockingLayout } : {}),
    layout: state.layout,
    createdAt: 0,
    lastFocusedAt: 0,
  };
}

export function currentWindows(state: WorkspaceWindowsState): WorkspaceWindow[] {
  return [currentWindow(state)];
}

export function withActiveWindowLayout(layout: WorkspaceLayout): WorkspaceWindowsUpdate {
  return { layout: normalizeWorkspaceLayout(layout) };
}
