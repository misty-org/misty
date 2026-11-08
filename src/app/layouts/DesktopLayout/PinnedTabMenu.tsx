import { AudioLines, Pin, PinOff, RotateCcw, Star, StarOff } from "lucide-react";
import { captureTab } from "@/features/voice";
import { browserRuntimeId } from "@/features/app-windows";
import { addFavorite, isFavorite, removeFavorite, useFavorites } from "@/features/browser";
import { dockTreeViews } from "@/features/app-windows";
import { activeLayoutView } from "@/features/app-windows";
import { parseBrowserViewState, type WorkspaceTab } from "@/features/app-windows";
import { pinnableTabUrl } from "@/features/app-windows";
import { useWorkspaceStore } from "@/features/app-windows";
import { ContextMenuAction } from "@/shared/ui";
import { isIncognitoWindow } from "@/features/app-windows";

/** Pin and favorite actions for the page in a tab's right-click menu. */
export function TabPageMenu({ tab }: { tab: WorkspaceTab }) {
  return (
    <>
      <PinnedTabMenu tab={tab} />
      <FavoriteTabMenu tab={tab} />
      <TranscribeTabMenu tab={tab} />
    </>
  );
}

/** Pin and unpin in a tab's right-click menu. */
function PinnedTabMenu({ tab }: { tab: WorkspaceTab }) {
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
  if (isIncognitoWindow() || state.agentOwned || !/^https?:/.test(state.url)) return null;
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

/** "Transcribe this tab": hear the page's own audio into a live Note. */
function TranscribeTabMenu({ tab }: { tab: WorkspaceTab }) {
  const views = dockTreeViews(tab.root);
  const view = views.length === 1 && views[0].surfaceId === "browser" ? views[0] : null;
  if (!view) return null;
  const state = parseBrowserViewState(view.state);
  if (!/^https?:/.test(state.url)) return null;
  return (
    <ContextMenuAction
      label="Transcribe this tab"
      icon={<AudioLines />}
      onSelect={() => void captureTab(browserRuntimeId(view), view.title, state.url)}
    />
  );
}
