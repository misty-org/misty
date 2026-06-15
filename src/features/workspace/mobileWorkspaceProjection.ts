import { dockLeaves } from "./dockTree";
import type {
  WorkspaceScopeKey,
  WorkspaceSurfaceId,
  WorkspaceTab,
  WorkspaceVirtualWindow,
} from "./model";

export interface WorkspaceTabProjection {
  tab: WorkspaceTab;
  paneId: string;
  windowId: string;
  scopeKey: WorkspaceScopeKey;
}

export interface WorkspaceWindowProjection {
  window: WorkspaceVirtualWindow;
  tabs: WorkspaceTabProjection[];
}

export interface MobileWorkspaceProjectionState {
  activeScopeKey: WorkspaceScopeKey;
  virtualWindowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceVirtualWindow[]>>;
}

export function flattenWorkspaceTabs(
  state: MobileWorkspaceProjectionState,
  options: { excludeSurfaceIds?: ReadonlySet<WorkspaceSurfaceId> } = {},
): WorkspaceTabProjection[] {
  const excluded = options.excludeSurfaceIds;
  return (state.virtualWindowsByScope[state.activeScopeKey] ?? [])
    .flatMap((workspaceWindow) =>
      dockLeaves(workspaceWindow.layout.root).flatMap((pane) =>
        pane.tabs.map((tab) => ({
          tab,
          paneId: pane.id,
          windowId: workspaceWindow.id,
          scopeKey: state.activeScopeKey,
        })),
      ),
    )
    .filter((entry) => !excluded?.has(entry.tab.surfaceId))
    .sort((left, right) => {
      const recency = right.tab.lastFocusedAt - left.tab.lastFocusedAt;
      return (
        recency ||
        right.tab.createdAt - left.tab.createdAt ||
        left.tab.id.localeCompare(right.tab.id)
      );
    });
}

/** Groups the read-only mobile projection without moving tabs or rewriting desktop panes. */
export function groupWorkspaceTabsByWindow(
  state: MobileWorkspaceProjectionState,
  options: { excludeSurfaceIds?: ReadonlySet<WorkspaceSurfaceId> } = {},
): WorkspaceWindowProjection[] {
  const tabs = flattenWorkspaceTabs(state, options);
  const tabsByWindow = new Map<string, WorkspaceTabProjection[]>();
  for (const tab of tabs) {
    const entries = tabsByWindow.get(tab.windowId) ?? [];
    entries.push(tab);
    tabsByWindow.set(tab.windowId, entries);
  }

  return (state.virtualWindowsByScope[state.activeScopeKey] ?? []).map((workspaceWindow) => ({
    window: workspaceWindow,
    tabs: tabsByWindow.get(workspaceWindow.id) ?? [],
  }));
}
