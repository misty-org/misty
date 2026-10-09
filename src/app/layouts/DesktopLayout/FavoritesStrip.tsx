import { useState } from "react";
import { ExternalLink, StarOff } from "lucide-react";
import { removeFavorite, useFavorites } from "@/features/bookmarks/favorites";
import type { Bookmark } from "@/features/bookmarks/tree";
import { SavedWebsiteIcon } from "@/features/browser-workspace/SavedWebsiteIcon";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { dockTreeViews } from "@/features/workspace/dockTree";
import { activeLayoutView, layoutTabs } from "@/features/workspace/layoutTabs";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  cn,
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuTrigger,
  Pressable,
} from "@/shared/ui";

function bookmarkOf(view: WorkspaceView | null | undefined): string | undefined {
  return view?.surfaceId === "browser" ? parseBrowserViewState(view.state).bookmarkId : undefined;
}

/** The tab in this virtual window that a favorite opened, if it is still open. */
function openFavoriteTab(bookmarkId: string) {
  const state = useWorkspaceStore.getState();
  return layoutTabs(state.layout).find((tab) =>
    dockTreeViews(tab.root).some((view) => bookmarkOf(view) === bookmarkId),
  );
}

/**
 * Favorites lead the tab strip in every virtual window. A favorite switches to the
 * tab it opened in this window, or opens one; the list syncs with bookmarks.
 */
export function FavoritesStrip(props: { vertical: boolean; onOpen(view: WorkspaceView): void }) {
  const favorites = useFavorites();
  const activeBookmark = useWorkspaceStore((state) =>
    bookmarkOf(activeLayoutView(state.layout) ?? undefined),
  );
  if (!favorites.length) return null;
  const open = (favorite: Bookmark, newTab = false) => {
    const state = useWorkspaceStore.getState();
    const existing = newTab ? undefined : openFavoriteTab(favorite.id);
    if (existing) {
      const view = state.selectTab(existing.id);
      if (view) props.onOpen(view);
      return;
    }
    props.onOpen(state.openBrowserView({ url: favorite.url, bookmarkId: favorite.id }));
  };
  return (
    <div
      role="toolbar"
      aria-label="Favorites"
      data-misty-window-drag-block="true"
      className={cn(
        "misty-workspace-favorites",
        props.vertical && "misty-workspace-favorites-grid",
      )}
    >
      {favorites.map((favorite) => (
        <FavoriteTile
          key={favorite.id}
          favorite={favorite}
          active={favorite.id === activeBookmark}
          onOpen={(newTab) => open(favorite, newTab)}
        />
      ))}
    </div>
  );
}

function FavoriteTile(props: {
  favorite: Bookmark;
  active: boolean;
  onOpen(newTab: boolean): void;
}) {
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
          onClick={(event) => props.onOpen(event.metaKey || event.ctrlKey)}
          onAuxClick={(event) => {
            if (event.button === 1) props.onOpen(true);
          }}
        >
          <SavedWebsiteIcon url={props.favorite.url} />
        </Pressable>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuAction
          label="Open in new tab"
          icon={<ExternalLink />}
          onSelect={() => props.onOpen(true)}
        />
        <ContextMenuAction
          label="Remove from favorites"
          icon={<StarOff />}
          onSelect={() => removeFavorite(props.favorite.id)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
