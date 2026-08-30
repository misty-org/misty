import {
  dockLeaves,
  parseBrowserTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";

export function latestAgentBrowserTab(): WorkspaceTab | null {
  return (
    dockLeaves(useWorkspaceStore.getState().layout.root)
      .flatMap((pane) => pane.tabs)
      .filter((tab) => tab.surfaceId === "browser")
      .sort((left, right) => right.lastFocusedAt - left.lastFocusedAt)[0] ?? null
  );
}

export function agentBrowserLabel(tab: WorkspaceTab) {
  try {
    return new URL(parseBrowserTabState(tab.state).url).hostname || "Browser tab";
  } catch {
    return "Browser tab";
  }
}
