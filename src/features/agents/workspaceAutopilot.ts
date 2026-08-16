import { invoke } from "@tauri-apps/api/core";
export { visibleAutopilotAvailable } from "./betaModes";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { currentWindows } from "@/features/workspace/windows";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves } from "@/features/workspace/dockTree";
import { useUserStore } from "@/features/auth/core";
import { isApiSessionTransitioning } from "@/api/client/session";
import { useCompanionState } from "./companion/companionState";

export function workspaceAutopilotContext(
  accountId: string,
  _legacySpaceId: string,
  desktopControl = false,
) {
  const spaceId = "";
  const state = useWorkspaceStore.getState();
  if (!accountId || isApiSessionTransitioning() || useUserStore.getState().me?.id !== accountId)
    throw new Error("The account changed. Start a new task in the current workspace.");
  return {
    accountId,
    desktopControl,
    askBeforeControl: desktopControl && useCompanionState.getState().presentation.ask === true,
    spaceId,
    spaceName: "", // Retained wire field for historical agent runs.
    activeWindowId: state.activeWindowId,
    activePaneId: state.layout.focusedPaneId,
    activeTabId: state.layout.activeTabId,
    // These describe open views only; closed history and background file content are excluded.
    windows: currentWindows(state)
      .slice(0, 12)
      .map((window) => ({
        id: window.id,
        title: window.title,
        tabs: layoutTabs(window.layout)
          .slice(0, 30)
          .map((tab) => ({
            id: tab.id,
            title: tab.title,
            panes: dockLeaves(tab.root).map((pane) => {
              const view =
                pane.views.find((item) => item.id === pane.activeViewId) ?? pane.views[0];
              return { id: pane.id, app: view?.surfaceId, title: view?.title, route: view?.route };
            }),
          })),
      })),
  };
}
export async function startWorkspaceAutopilot(
  taskId: string,
  accountId: string,
  spaceId: string,
  desktopControl = false,
) {
  await invoke("agent_workspace_context", {
    taskId,
    context: workspaceAutopilotContext(accountId, spaceId, desktopControl),
    start: true,
  });
}
export function watchWorkspaceAutopilot(
  taskId: string,
  accountId: string,
  spaceId: string,
  stop: (reason?: string) => void,
  desktopControl = false,
) {
  let disposed = false;
  let previous = "";
  // Serialize updates so a slow earlier route snapshot cannot replace a newer one.
  let pending = Promise.resolve();
  const update = () => {
    if (disposed) return;
    try {
      const context = workspaceAutopilotContext(accountId, spaceId, desktopControl);
      const encoded = JSON.stringify(context);
      if (encoded === previous) return;
      previous = encoded;
      pending = pending
        .then(async () => {
          if (!disposed) await invoke("agent_workspace_context", { taskId, context, start: false });
        })
        .catch((reason) => {
          if (!disposed) stop(String(reason));
        });
    } catch (reason) {
      stop(String(reason));
    }
  };
  const removers = [useWorkspaceStore.subscribe(update), useUserStore.subscribe(update)];
  update();
  return () => {
    disposed = true;
    removers.forEach((remove) => remove());
  };
}
