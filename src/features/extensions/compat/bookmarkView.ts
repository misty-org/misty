import {
  appsId,
  bookmarkTree,
  bookmarksBarId,
  favoritesId,
  mobileBookmarksId,
  otherBookmarksId,
  type BookmarkNode,
  type BookmarkTree,
} from "@/features/bookmarks/library";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";

// The bookmark tree as the bookmarks API (bookmarks.ts) shows it to extensions.

/** Chrome's root and its three folders, by the IDs extensions expect. */
export const rootId = "0";
const apiRoots: Record<string, string> = {
  "1": bookmarksBarId,
  "2": otherBookmarksId,
  "3": mobileBookmarksId,
};
/** Firefox names the same folders differently. */
const firefoxRoots: Record<string, string> = {
  root________: rootId,
  toolbar_____: bookmarksBarId,
  unfiled_____: otherBookmarksId,
  menu________: otherBookmarksId,
  mobile______: mobileBookmarksId,
};
export const toApi = (id: string) =>
  Object.entries(apiRoots).find(([, misty]) => misty === id)?.[0] ?? id;
export const fromApi = (value: unknown) => {
  const id = String(value ?? "");
  return apiRoots[id] ?? firefoxRoots[id] ?? id;
};

/** The bookmark tree as extensions see it. Favorites and Apps are Misty's own and
 * stay out of view. Children are listed once per folder per call. */
export interface View {
  current: BookmarkTree;
  skip: Set<string>;
  children(folderId: string): BookmarkNode[];
}
export function view(): View {
  const state = useWorkspaceStore.getState();
  const current = bookmarkTree(state.bookmarkFolders, state.bookmarks);
  const skip = new Set([...current.descendants(favoritesId), ...current.descendants(appsId)]);
  const cache = new Map<string, BookmarkNode[]>();
  return {
    current,
    skip,
    children(folderId) {
      let list = cache.get(folderId);
      if (!list)
        cache.set(
          folderId,
          (list = current
            .children(folderId)
            .filter(
              (node) => !skip.has(node.id) && (node.kind === "folder" || !skip.has(node.folderId)),
            )),
        );
      return list;
    },
  };
}

export interface ApiNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded?: number;
  type: "bookmark" | "folder";
  children?: ApiNode[];
}

export function apiNode(v: View, node: BookmarkNode, deep: boolean): ApiNode {
  const parent = node.kind === "folder" ? node.parentId : node.folderId;
  const base = {
    id: toApi(node.id),
    parentId: parent ? toApi(parent) : rootId,
    index: parent
      ? Math.max(
          0,
          v.children(parent).findIndex((item) => item.id === node.id),
        )
      : 0,
    dateAdded: node.addedAt,
  };
  if (node.kind === "bookmark")
    return { ...base, title: node.title, url: node.url, type: "bookmark" };
  return {
    ...base,
    title: node.name,
    type: "folder",
    ...(deep ? { children: v.children(node.id).map((child) => apiNode(v, child, true)) } : {}),
  };
}

export function rootNode(v: View, deep: boolean): ApiNode {
  const roots = [bookmarksBarId, otherBookmarksId, mobileBookmarksId].map((id, index) => ({
    ...apiNode(v, { kind: "folder", ...v.current.folder(id)! }, deep),
    parentId: rootId,
    index,
  }));
  return { id: rootId, title: "", type: "folder", ...(deep ? { children: roots } : {}) };
}

/** A visible folder or bookmark by API id; extensions never reach hidden ones. */
export function find(v: View, value: unknown): BookmarkNode {
  const id = fromApi(value);
  const folder = v.current.folder(id);
  if (folder && !v.skip.has(folder.id)) return { kind: "folder", ...folder };
  const bookmark = v.current.bookmarks.find((item) => item.id === id);
  if (bookmark && !v.skip.has(bookmark.folderId)) return { kind: "bookmark", ...bookmark };
  throw new Error("Can't find bookmark for id.");
}

export function describe(value: unknown, deep = false): ApiNode {
  const v = view();
  if (fromApi(value) === rootId) return rootNode(v, deep);
  return apiNode(v, find(v, value), deep);
}

export function parentFolder(value: unknown): string {
  const id = value === undefined ? otherBookmarksId : fromApi(value);
  if (id === rootId) throw new Error("Bookmarks go in a folder inside the root.");
  const node = find(view(), id);
  if (node.kind !== "folder") throw new Error("The parent must be a folder.");
  return node.id;
}

export function visibleBookmarks(v: View) {
  return v.current.bookmarks.filter((item) => !v.skip.has(item.folderId));
}
