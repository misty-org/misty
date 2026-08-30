import type { WorkspaceScopeKey, WorkspaceVirtualWindow } from "./model";
import {
  closeVirtualWindow,
  restoreVirtualWindow,
  type VirtualWorkspaceState,
  type VirtualWorkspaceUpdate,
} from "./virtualWindows";

export interface ClosedVirtualWindowState extends VirtualWorkspaceState {
  closedVirtualWindowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceVirtualWindow[]>>;
}

export function closeVirtualWindowRemembering(
  state: ClosedVirtualWindowState,
  windowId: string,
): (VirtualWorkspaceUpdate & Pick<ClosedVirtualWindowState, "closedVirtualWindowsByScope">) | null {
  const closing = state.virtualWindowsByScope[state.activeScopeKey]?.find(
    (workspaceWindow) => workspaceWindow.id === windowId,
  );
  const update = closeVirtualWindow(state, windowId);
  if (!closing || !update) return null;
  const existing = state.closedVirtualWindowsByScope[state.activeScopeKey] ?? [];
  return {
    ...update,
    closedVirtualWindowsByScope: {
      ...state.closedVirtualWindowsByScope,
      [state.activeScopeKey]: [
        closing,
        ...existing.filter((workspaceWindow) => workspaceWindow.id !== closing.id),
      ].slice(0, 10),
    },
  };
}

export function reopenRememberedVirtualWindow(state: ClosedVirtualWindowState) {
  const closed = state.closedVirtualWindowsByScope[state.activeScopeKey] ?? [];
  const window = closed[0];
  if (!window) return null;
  return {
    window,
    update: {
      ...restoreVirtualWindow(state, window),
      closedVirtualWindowsByScope: {
        ...state.closedVirtualWindowsByScope,
        [state.activeScopeKey]: closed.slice(1),
      },
    },
  };
}
