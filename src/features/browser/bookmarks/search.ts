import type { Bookmark, BookmarkTree } from "./tree";

/** The folders a bookmark sits in, outermost first: "Bookmarks bar / Work". */
export function bookmarkLocation(tree: BookmarkTree, bookmark: Bookmark): string {
  return tree
    .path(bookmark.folderId)
    .map((folder) => folder.name)
    .join(" / ");
}

/** Bookmarks whose title or address contains the text, in tree order. */
export function searchBookmarks(tree: BookmarkTree, text: string): Bookmark[] {
  const needle = text.trim().toLocaleLowerCase();
  if (!needle) return [];
  return tree.bookmarks.filter((bookmark) =>
    `${bookmark.title} ${bookmark.url}`.toLocaleLowerCase().includes(needle),
  );
}
