import type { WorkspaceScopeKey, WorkspaceWindow } from "./model";
import {
  closeWindow,
  restoreWindow,
  type WorkspaceWindowsState,
  type WorkspaceWindowsUpdate,
} from "./windows";

export interface ClosedWindowState extends WorkspaceWindowsState {
  closedWindowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceWindow[]>>;
}

export function closeWindowRemembering(
  state: ClosedWindowState,
  windowId: string,
): (WorkspaceWindowsUpdate & Pick<ClosedWindowState, "closedWindowsByScope">) | null {
  const closing = state.windowsByScope[state.activeScopeKey]?.find(
    (workspaceWindow) => workspaceWindow.id === windowId,
  );
  const update = closeWindow(state, windowId);
  if (!closing || !update) return null;
  const existing = state.closedWindowsByScope[state.activeScopeKey] ?? [];
  return {
    ...update,
    closedWindowsByScope: {
      ...state.closedWindowsByScope,
      [state.activeScopeKey]: [
        closing,
        ...existing.filter((workspaceWindow) => workspaceWindow.id !== closing.id),
      ].slice(0, 10),
    },
  };
}

export function reopenRememberedWindow(state: ClosedWindowState) {
  const closed = state.closedWindowsByScope[state.activeScopeKey] ?? [];
  const window = closed[0];
  if (!window) return null;
  return {
    window,
    update: {
      ...restoreWindow(state, window),
      closedWindowsByScope: {
        ...state.closedWindowsByScope,
        [state.activeScopeKey]: closed.slice(1),
      },
    },
  };
}
