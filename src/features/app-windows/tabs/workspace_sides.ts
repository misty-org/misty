import { initialWorkspaceLayout, normalizeWorkspaceLayout } from "../profiles/windows";
import type { ClosedWorkspaceItem } from "./closed_workspace_items";
import { spaceWindow, useSpaceWindowStore, type SpaceWindowIdentity } from "./space_window";
import { useWorkspaceStore } from "./use_workspace_store";
import type { WorkspaceGroupKey, WorkspaceLayout } from "./workspace_views";

export type WorkspaceSide = "personal" | "spaces";

export interface AsideWorkspace {
  layout: WorkspaceLayout;
  lastUsedViewByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  closedItems: ClosedWorkspaceItem[];
}

export const sideOf = (identity: SpaceWindowIdentity): WorkspaceSide =>
  identity.personal ? "personal" : "spaces";

export const otherSide = (side: WorkspaceSide): WorkspaceSide =>
  side === "personal" ? "spaces" : "personal";

export function emptyAsideWorkspace(): AsideWorkspace {
  return {
    layout: normalizeWorkspaceLayout(initialWorkspaceLayout()),
    lastUsedViewByGroup: {},
    closedItems: [],
  };
}

export function showWorkspaceSide(side: WorkspaceSide) {
  const state = useWorkspaceStore.getState();
  if (state.side === side) return;
  if (!state.side) {
    useWorkspaceStore.setState({ side });
    return;
  }
  const shown = state.aside ?? emptyAsideWorkspace();
  useWorkspaceStore.setState({
    side,
    layout: shown.layout,
    lastUsedViewByGroup: shown.lastUsedViewByGroup,
    closedItems: shown.closedItems,
    aside: {
      layout: state.layout,
      lastUsedViewByGroup: state.lastUsedViewByGroup,
      closedItems: state.closedItems,
    },
  });
  window.dispatchEvent(new Event("misty:workspace-projection-applied"));
}

export function startWorkspaceSides(): () => void {
  const follow = () => showWorkspaceSide(sideOf(spaceWindow()));
  follow();
  const stopWindow = useSpaceWindowStore.subscribe((state, previous) => {
    if (state.identity !== previous.identity) follow();
  });
  const stopStore = useWorkspaceStore.subscribe((state) => {
    if (state.side !== sideOf(spaceWindow())) follow();
  });
  return () => {
    stopWindow();
    stopStore();
  };
}
