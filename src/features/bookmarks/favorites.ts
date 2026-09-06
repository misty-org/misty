import { useMemo } from "react";
import { useBookmarkLibrary, removeBookmark, saveBookmark } from "./library";
import { favoritesId, type Bookmark } from "./tree";

/** Links saved directly in Favorites, in their saved order. Subfolders are not shown. */
export function useFavorites(): Bookmark[] {
  const tree = useBookmarkLibrary();
  return useMemo(
    () =>
      tree
        .children(favoritesId)
        .flatMap((node) => (node.kind === "bookmark" ? [node as Bookmark] : [])),
    [tree],
  );
}

export function isFavorite(bookmarks: readonly Bookmark[], bookmarkId: string | undefined) {
  return Boolean(bookmarkId) && bookmarks.some((bookmark) => bookmark.id === bookmarkId);
}

/** Saves a page to Favorites and returns the new bookmark's id. */
export function addFavorite(url: string, title: string): string {
  return saveBookmark({ url, title, folderId: favoritesId });
}

export function removeFavorite(id: string): void {
  removeBookmark(id);
}
