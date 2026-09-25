import { invoke } from "@tauri-apps/api/core";
export { visibleAutopilotAvailable, betaExecutionMode } from "./betaModes";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { currentVirtualWindows } from "@/features/workspace/virtualWindows";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves } from "@/features/workspace/dockTree";
import { useUserStore } from "@/features/auth/core";
import { isApiSessionTransitioning } from "@/api/client/session";

export function workspaceAutopilotContext(accountId: string, _legacySpaceId: string) {
  const spaceId = "";
  const state = useWorkspaceStore.getState();
  if (!accountId || isApiSessionTransitioning() || useUserStore.getState().me?.id !== accountId)
    throw new Error("The account changed. Start a new task in the current workspace.");
  return {
    accountId,
    spaceId,
    spaceName: "", // Retained wire field for historical agent runs.
    activeWindowId: state.activeVirtualWindowId,
    activePaneId: state.layout.focusedPaneId,
    activeTabId: state.layout.activeLayoutTabId,
    // These describe open views only; closed history and background file content are excluded.
    windows: currentVirtualWindows(state)
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
              const view = pane.tabs.find((item) => item.id === pane.activeTabId) ?? pane.tabs[0];
              return { id: pane.id, app: view?.surfaceId, title: view?.title, route: view?.route };
            }),
          })),
      })),
  };
}
export async function startWorkspaceAutopilot(taskId: string, accountId: string, spaceId: string) {
  await invoke("agent_workspace_context", {
    taskId,
    context: workspaceAutopilotContext(accountId, spaceId),
    start: true,
  });
}
export function watchWorkspaceAutopilot(
  taskId: string,
  accountId: string,
  spaceId: string,
  stop: (reason?: string) => void,
) {
  let disposed = false;
  let previous = "";
  // Serialize updates so a slow earlier route snapshot cannot replace a newer one.
  let pending = Promise.resolve();
  const update = () => {
    if (disposed) return;
    try {
      const context = workspaceAutopilotContext(accountId, spaceId);
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
