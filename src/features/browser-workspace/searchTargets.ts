import type { NavigateFunction } from "react-router-dom";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceView,
} from "@/features/workspace";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { OmniboxMatch } from "@/features/browser/omnibox";
import type { ScopedSearchResult } from "./scopedSearchSources";

/** Opens a page in a new browser tab and shows it. Throws when the address cannot be opened. */
export function openInNewBrowserTab(url: string, navigate: NavigateFunction): void {
  const tab = useWorkspaceStore.getState().openBrowserView({ url });
  navigate(tab.route, { replace: true });
}

/** Opens a tab and docks it in a split beside the focused pane (⌘⏎). */
function openBeside(open: () => WorkspaceView | null): void {
  const store = useWorkspaceStore.getState();
  const paneId = store.layout.focusedPaneId;
  const view = open();
  if (view) useWorkspaceStore.getState().splitPane(paneId, "right", view.id);
}

/** A web address or an app route, beside the focused pane. */
export function openTargetBeside(target: { url: string } | { route: string }): void {
  if ("url" in target) {
    openBeside(() => useWorkspaceStore.getState().openBrowserView({ url: target.url }));
    return;
  }
  const surface = workspaceSurfaceFromRoute(target.route);
  if (surface)
    openBeside(() => useWorkspaceStore.getState().openSurface({ ...surface, forceNew: true }));
}

/** Switches to an open tab in whichever window holds it. */
function switchToTab(tabId: string): void {
  window.dispatchEvent(new CustomEvent("misty:focus-workspace-tab", { detail: { tabId } }));
}

export function openMatch(match: OmniboxMatch, navigate: NavigateFunction): void {
  const target = match.target;
  if (target.type === "switch-tab") switchToTab(target.tabId);
  else if (target.type === "open-in-app") navigate(target.url);
  else openInNewBrowserTab(target.url, navigate);
}

/** Opens a result. A returned message means the box should stay open and show it. */
export function openResult(result: ScopedSearchResult, navigate: NavigateFunction): string | void {
  const target = result.target;
  switch (target.kind) {
    case "route":
      navigate(target.route);
      return;
    case "agent":
      useMistyStore.setState({
        selectedAgentId: target.agentId,
        activeConversationId: target.conversationId,
      });
      navigate(`/agents?agent=${encodeURIComponent(target.agentId)}`);
      return;
    case "url":
      openInNewBrowserTab(target.url, navigate);
      return;
    case "tab":
      switchToTab(target.tabId);
      return;
    case "run":
      return target.run();
  }
}
