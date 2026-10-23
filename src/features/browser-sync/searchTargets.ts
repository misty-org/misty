import type { NavigateFunction } from "react-router-dom";
import { useWorkspaceStore, type WorkspaceView } from "@/features/workspace";
import type { OmniboxMatch } from "@/features/browser/omnibox";

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

/** A web address, beside the focused pane. */
export function openTargetBeside(target: { url: string }): void {
  openBeside(() => useWorkspaceStore.getState().openBrowserView({ url: target.url }));
}

/** Switches to an open tab in whichever window holds it. */
function switchToTab(tabId: string): void {
  window.dispatchEvent(new CustomEvent("misty:focus-workspace-tab", { detail: { tabId } }));
}

export function openMatch(match: OmniboxMatch, navigate: NavigateFunction): void {
  const target = match.target;
  if (target.type === "switch-tab") switchToTab(target.tabId);
  else openInNewBrowserTab(target.url, navigate);
}
