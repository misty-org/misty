import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dockLeaves, dockTreeViews } from "./dockTree";
import { layoutTabs } from "./layoutTabs";
import { parseBrowserViewState } from "./model";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { tabArchiveHours } from "./tabArchiveSettings";

/** A tab closed for being idle, kept so it can be opened again. */
export interface ArchivedTab {
  id: string;
  accountId: string;
  url: string;
  title: string;
  archivedAt: number;
}

const maxArchived = 200;

/** Archived tabs stay on this device, each tied to the account that owned it. */
export const useTabArchiveStore = create(
  persist<{
    tabs: ArchivedTab[];
    /** When each view was last on screen, so idleness survives restarts. */
    lastActive: Record<string, number>;
    remove(id: string): void;
  }>(
    (set) => ({
      tabs: [],
      lastActive: {},
      remove: (id) => set((state) => ({ tabs: state.tabs.filter((tab) => tab.id !== id) })),
    }),
    { name: "misty:archived-tabs:v1" },
  ),
);

function shownViews(): string[] {
  const { layout } = useWorkspaceStore.getState();
  return dockLeaves(layout.root).flatMap((pane) =>
    pane.activeViewId ? [pane.activeViewId] : pane.views.slice(0, 1).map((view) => view.id),
  );
}

/**
 * Closes ordinary web tabs in the active virtual window that nobody has looked
 * at for the configured time, like Arc's archive. Pinned, grouped, private,
 * agent and sound-playing tabs stay. Each one is listed in History › Archived.
 */
export function startTabArchive(options: {
  accountId: () => string;
  audible: (viewId: string) => boolean;
}): () => void {
  const touch = (ids: string[]) => {
    if (!ids.length) return;
    const now = Date.now();
    useTabArchiveStore.setState((state) => ({
      lastActive: { ...state.lastActive, ...Object.fromEntries(ids.map((id) => [id, now])) },
    }));
  };
  let shown = shownViews();
  touch(shown);
  // Layout changes with every title update; only a change of what is on screen counts.
  const stopWatching = useWorkspaceStore.subscribe((state, previous) => {
    if (state.layout === previous.layout) return;
    const next = shownViews();
    if (next.join() === shown.join()) return;
    touch([...shown, ...next]);
    shown = next;
  });
  const sweep = () => {
    const accountId = options.accountId();
    const store = useWorkspaceStore.getState();
    const tabs = layoutTabs(store.layout);
    const live = new Set(tabs.flatMap((tab) => dockTreeViews(tab.root).map((view) => view.id)));
    const now = Date.now();
    const { lastActive } = useTabArchiveStore.getState();
    const seen: Record<string, number> = {};
    for (const id of Object.keys(lastActive)) if (live.has(id)) seen[id] = lastActive[id];
    // A tab first seen now starts its idle time now, whatever its synced history says.
    for (const id of live) seen[id] ??= now;
    useTabArchiveStore.setState({ lastActive: seen });
    const archiveAfterHours = tabArchiveHours();
    if (!archiveAfterHours || !accountId) return;
    const cutoff = now - archiveAfterHours * 3_600_000;
    const archived: ArchivedTab[] = [];
    for (const tab of tabs) {
      if (tab.id === store.layout.activeTabId || tab.pinnedUrl || tab.tabGroupId) continue;
      const views = dockTreeViews(tab.root);
      if (views.length !== 1 || views[0].surfaceId !== "browser") continue;
      const view = views[0];
      const state = parseBrowserViewState(view.state);
      if (state.private || state.agentOwned || options.audible(view.id)) continue;
      if (!/^https?:/.test(state.url) || seen[view.id] > cutoff) continue;
      if (!useWorkspaceStore.getState().closeTab(tab.id)) continue;
      archived.push({
        id: `archived:${view.id}:${now}`,
        accountId,
        url: state.url,
        title: view.title,
        archivedAt: now,
      });
    }
    if (archived.length)
      useTabArchiveStore.setState((current) => ({
        tabs: [...archived, ...current.tabs].slice(0, maxArchived),
      }));
  };
  const timer = window.setInterval(sweep, 5 * 60_000);
  return () => {
    window.clearInterval(timer);
    stopWatching();
  };
}
