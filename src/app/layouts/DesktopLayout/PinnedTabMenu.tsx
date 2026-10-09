import { Pin, PinOff, RotateCcw, Star, StarOff } from "lucide-react";
import {
  addFavorite,
  isFavorite,
  removeFavorite,
  useFavorites,
} from "@/features/bookmarks/favorites";
import { dockTreeViews } from "@/features/workspace/dockTree";
import { activeLayoutView } from "@/features/workspace/layoutTabs";
import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import { parseBrowserViewState, type WorkspaceTab } from "@/features/workspace/model";
import { pinnableTabUrl } from "@/features/workspace/pinnedTabs";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { ContextMenuAction } from "@/shared/ui";

const updateOtherDevices = "Update Misty on your other devices to keep pinned tabs in sync.";

/** Pin and favorite actions for the page in a tab's right-click menu. */
export function TabPageMenu({ tab }: { tab: WorkspaceTab }) {
  return (
    <>
      <PinnedTabMenu tab={tab} />
      <FavoriteTabMenu tab={tab} />
    </>
  );
}

/** Pin and unpin in a tab's right-click menu. */
function PinnedTabMenu({ tab }: { tab: WorkspaceTab }) {
  // Synced workspaces keep pins only once every device understands them.
  const syncBlocksPins = useBrowserSyncStore((state) => {
    const sync = state.session?.sync;
    return Boolean(sync) && sync?.pinned_tabs !== true;
  });
  if (tab.pinnedUrl) {
    const view = activeLayoutView(tab);
    const current =
      view?.surfaceId === "browser" ? parseBrowserViewState(view.state).url : undefined;
    return (
      <>
        {current !== tab.pinnedUrl && (
          <ContextMenuAction
            label="Go back to pinned page"
            icon={<RotateCcw />}
            onSelect={() => useWorkspaceStore.getState().resetPinnedTab(tab.id)}
          />
        )}
        <ContextMenuAction
          label="Unpin tab"
          icon={<PinOff />}
          onSelect={() => useWorkspaceStore.getState().unpinTab(tab.id)}
        />
      </>
    );
  }
  if (!pinnableTabUrl(tab)) return null;
  return (
    <ContextMenuAction
      label="Pin tab"
      icon={<Pin />}
      disabled={syncBlocksPins}
      title={syncBlocksPins ? updateOtherDevices : undefined}
      onSelect={() => useWorkspaceStore.getState().pinTab(tab.id)}
    />
  );
}

/** Add the tab's page to Favorites, or remove the favorite it was opened from. */
function FavoriteTabMenu({ tab }: { tab: WorkspaceTab }) {
  const favorites = useFavorites();
  const views = dockTreeViews(tab.root);
  const view = views.length === 1 && views[0].surfaceId === "browser" ? views[0] : null;
  if (!view) return null;
  const state = parseBrowserViewState(view.state);
  if (isFavorite(favorites, state.bookmarkId))
    return (
      <ContextMenuAction
        label="Remove from favorites"
        icon={<StarOff />}
        onSelect={() => removeFavorite(state.bookmarkId!)}
      />
    );
  if (state.private || state.agentOwned || !/^https?:/.test(state.url)) return null;
  return (
    <ContextMenuAction
      label="Add to favorites"
      icon={<Star />}
      onSelect={() => {
        const id = addFavorite(state.url, view.title);
        // The favorite now switches to this tab instead of opening another.
        useWorkspaceStore.getState().updateBrowserView(view.id, { bookmarkId: id });
      }}
    />
  );
}
