import { useState } from "react";
import { StarOff } from "lucide-react";
import { removeFavorite, useFavorites } from "@/features/bookmarks/favorites";
import type { Bookmark } from "@/features/bookmarks/tree";
import { SavedWebsiteIcon } from "@/features/browser-sync/SavedWebsiteIcon";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { activeLayoutView } from "@/features/workspace/layoutTabs";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuTrigger,
  Pressable,
} from "@/shared/ui";

function originOf(address: string): string {
  try {
    return new URL(address).origin;
  } catch {
    return address;
  }
}

/**
 * Whether a view is still the page its favorite opened. A tab keeps the favorite's id after it
 * navigates, so the id alone is stale: a tab that opened YouTube and has since gone to another
 * site is no longer that favorite, and clicking the favorite must not land there.
 */
function isFavoritePage(view: WorkspaceView | null | undefined, favorite: Bookmark): boolean {
  if (view?.surfaceId !== "browser") return false;
  const state = parseBrowserViewState(view.state);
  return state.bookmarkId === favorite.id && originOf(state.url) === originOf(favorite.url);
}

/**
 * Favorites lead the tab strip in every virtual window. A favorite always opens a new tab, never
 * switching to one already open; the list syncs with bookmarks.
 */
export function FavoritesStrip(props: { onOpen(view: WorkspaceView): void }) {
  const favorites = useFavorites();
  const activeView = useWorkspaceStore((state) => activeLayoutView(state.layout));
  const open = (favorite: Bookmark) => {
    props.onOpen(
      useWorkspaceStore.getState().openBrowserView({ url: favorite.url, bookmarkId: favorite.id }),
    );
  };
  return (
    <div
      role="toolbar"
      aria-label="Favorites"
      data-misty-window-drag-block="true"
      data-empty={favorites.length === 0 || undefined}
      className="misty-workspace-favorites misty-workspace-favorites-grid"
    >
      {favorites.map((favorite) => (
        <FavoriteTile
          key={favorite.id}
          favorite={favorite}
          active={isFavoritePage(activeView, favorite)}
          onOpen={() => open(favorite)}
        />
      ))}
    </div>
  );
}

function FavoriteTile(props: { favorite: Bookmark; active: boolean; onOpen(): void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const reason = `favorite-menu:${props.favorite.id}`;
  return (
    <ContextMenu
      onOpenChange={(open) => {
        setMenuOpen(open);
        setBrowserWebviewsSuspended(open, reason);
      }}
    >
      <ContextMenuTrigger asChild>
        <Pressable
          aria-label={props.favorite.title}
          title={props.favorite.title}
          aria-current={props.active ? "page" : undefined}
          data-active={props.active || undefined}
          data-menu-open={menuOpen || undefined}
          className="misty-workspace-favorite"
          onClick={props.onOpen}
          onAuxClick={(event) => {
            if (event.button === 1) props.onOpen();
          }}
        >
          <SavedWebsiteIcon url={props.favorite.url} />
        </Pressable>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuAction
          label="Remove from favorites"
          icon={<StarOff />}
          onSelect={() => removeFavorite(props.favorite.id)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
