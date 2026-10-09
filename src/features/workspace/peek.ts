import { create } from "zustand";
import { dockTreeViews } from "./dockTree";
import { layoutTabs } from "./layoutTabs";
import type { WorkspaceView } from "./model";
import { useWorkspaceStore } from "./useWorkspaceStore";

/**
 * Peek shows a link over the page it came from. The peeked page is a real tab
 * placed right after its source, so keeping it is just ending the overlay;
 * closing it closes that tab and returns to the source.
 */
export const usePeekStore = create<{ peek: { tabId: string; sourceTabId: string } | null }>(() => ({
  peek: null,
}));

function ownerTab(viewId: string) {
  return layoutTabs(useWorkspaceStore.getState().layout).find((tab) =>
    dockTreeViews(tab.root).some((view) => view.id === viewId),
  );
}

export function openPeek(url: string, sourceViewId: string): WorkspaceView | null {
  const source = ownerTab(sourceViewId);
  if (!source) return null;
  // Opening from a private page keeps the peek private too.
  const view = useWorkspaceStore.getState().openBrowserView({ url, sourceViewId });
  const store = useWorkspaceStore.getState();
  const peekTab = ownerTab(view.id);
  if (!peekTab) return view;
  const ids = layoutTabs(store.layout)
    .map((tab) => tab.id)
    .filter((id) => id !== peekTab.id);
  ids.splice(ids.indexOf(source.id) + 1, 0, peekTab.id);
  store.reorderTabs(ids);
  useWorkspaceStore.getState().selectTab(peekTab.id);
  usePeekStore.setState({ peek: { tabId: peekTab.id, sourceTabId: source.id } });
  return view;
}

/** Keeps the peeked page as an ordinary tab. */
export function keepPeek(): void {
  usePeekStore.setState({ peek: null });
}

/** Closes the peeked page and shows its source again. Returns the source's active view. */
export function closePeek(): WorkspaceView | null {
  const peek = usePeekStore.getState().peek;
  if (!peek) return null;
  usePeekStore.setState({ peek: null });
  const store = useWorkspaceStore.getState();
  if (!store.closeTab(peek.tabId)) return null;
  const source = layoutTabs(useWorkspaceStore.getState().layout).find(
    (tab) => tab.id === peek.sourceTabId,
  );
  return source ? useWorkspaceStore.getState().selectTab(source.id) : null;
}
