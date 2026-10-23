import {
  appsId,
  bookmarkTree,
  bookmarksBarId,
  createBookmarkFolder,
  favoritesId,
  mobileBookmarksId,
  moveBookmarkFolder,
  otherBookmarksId,
  placeBookmarkNode,
  removeBookmark,
  removeBookmarkFolder,
  removeBookmarkTree,
  renameBookmarkFolder,
  saveBookmark,
  type BookmarkNode,
  type BookmarkTree,
} from "@/features/bookmarks/library";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { compatObject, emitCompatEvent, type CompatHandler } from "./events";

/** Chrome's root and its three folders, by the IDs extensions expect. */
const rootId = "0";
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
const toApi = (id: string) => Object.entries(apiRoots).find(([, misty]) => misty === id)?.[0] ?? id;
const fromApi = (value: unknown) => {
  const id = String(value ?? "");
  return apiRoots[id] ?? firefoxRoots[id] ?? id;
};

/** The bookmark tree as extensions see it. Favorites and Apps are Misty's own and
 * stay out of view. Children are listed once per folder per call. */
interface View {
  current: BookmarkTree;
  skip: Set<string>;
  children(folderId: string): BookmarkNode[];
}
function view(): View {
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

interface ApiNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded?: number;
  type: "bookmark" | "folder";
  children?: ApiNode[];
}

function apiNode(v: View, node: BookmarkNode, deep: boolean): ApiNode {
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

function rootNode(v: View, deep: boolean): ApiNode {
  const roots = [bookmarksBarId, otherBookmarksId, mobileBookmarksId].map((id, index) => ({
    ...apiNode(v, { kind: "folder", ...v.current.folder(id)! }, deep),
    parentId: rootId,
    index,
  }));
  return { id: rootId, title: "", type: "folder", ...(deep ? { children: roots } : {}) };
}

/** A visible folder or bookmark by API id; extensions never reach hidden ones. */
function find(v: View, value: unknown): BookmarkNode {
  const id = fromApi(value);
  const folder = v.current.folder(id);
  if (folder && !v.skip.has(folder.id)) return { kind: "folder", ...folder };
  const bookmark = v.current.bookmarks.find((item) => item.id === id);
  if (bookmark && !v.skip.has(bookmark.folderId)) return { kind: "bookmark", ...bookmark };
  throw new Error("Can't find bookmark for id.");
}

function describe(value: unknown, deep = false): ApiNode {
  const v = view();
  if (fromApi(value) === rootId) return rootNode(v, deep);
  return apiNode(v, find(v, value), deep);
}

function parentFolder(value: unknown): string {
  const id = value === undefined ? otherBookmarksId : fromApi(value);
  if (id === rootId) throw new Error("Bookmarks go in a folder inside the root.");
  const node = find(view(), id);
  if (node.kind !== "folder") throw new Error("The parent must be a folder.");
  return node.id;
}

function visibleBookmarks(v: View) {
  return v.current.bookmarks.filter((item) => !v.skip.has(item.folderId));
}

export const bookmarkHandlers: Record<string, CompatHandler> = {
  "bookmarks.getTree": () => [rootNode(view(), true)],
  "bookmarks.getSubTree": ([id]) => [describe(id, true)],
  "bookmarks.getChildren": ([id]) => {
    const v = view();
    const folder = fromApi(id);
    if (folder === rootId) return rootNode(v, true).children;
    const node = find(v, folder);
    if (node.kind !== "folder") return [];
    return v.children(node.id).map((child) => apiNode(v, child, false));
  },
  "bookmarks.get": ([ids]) => (Array.isArray(ids) ? ids : [ids]).map((id) => describe(id)),
  "bookmarks.getRecent": ([count]) => {
    const v = view();
    return visibleBookmarks(v)
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .slice(0, Math.max(1, Number(count) || 1))
      .map((item) => apiNode(v, { kind: "bookmark", ...item }, false));
  },
  "bookmarks.search": ([query]) => {
    const v = view();
    const details = typeof query === "string" ? { query } : compatObject(query);
    const words = String(details.query ?? "")
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return visibleBookmarks(v)
      .filter(
        (item) =>
          words.every((word) => `${item.title} ${item.url}`.toLocaleLowerCase().includes(word)) &&
          (details.url === undefined || item.url === details.url) &&
          (details.title === undefined || item.title === details.title),
      )
      .map((item) => apiNode(v, { kind: "bookmark", ...item }, false));
  },
  "bookmarks.create": ([value]) => {
    const details = compatObject(value);
    const parentId = parentFolder(details.parentId);
    const title = String(details.title ?? "");
    const id =
      typeof details.url === "string" && details.url
        ? saveBookmark({ title, url: details.url, folderId: parentId, addedAt: Date.now() })
        : createBookmarkFolder(title || "New folder", { parentId, addedAt: Date.now() });
    if (Number.isInteger(details.index)) placeBookmarkNode(id, Number(details.index));
    return describe(id);
  },
  "bookmarks.update": ([id, value]) => {
    const node = find(view(), id);
    const changes = compatObject(value);
    if (node.kind === "folder") {
      if (changes.title !== undefined) renameBookmarkFolder(node.id, String(changes.title));
    } else
      saveBookmark({
        id: node.id,
        title: changes.title !== undefined ? String(changes.title) : node.title,
        url: typeof changes.url === "string" ? changes.url : node.url,
        folderId: node.folderId,
      });
    return describe(node.id);
  },
  "bookmarks.move": ([id, value]) => {
    const node = find(view(), id);
    const destination = compatObject(value);
    const parentId =
      destination.parentId === undefined
        ? node.kind === "folder"
          ? node.parentId!
          : node.folderId
        : parentFolder(destination.parentId);
    if (node.kind === "folder") {
      if (parentId !== node.parentId) moveBookmarkFolder(node.id, parentId);
    } else if (parentId !== node.folderId)
      saveBookmark({ id: node.id, title: node.title, url: node.url, folderId: parentId });
    if (Number.isInteger(destination.index)) placeBookmarkNode(node.id, Number(destination.index));
    return describe(node.id);
  },
  "bookmarks.remove": ([id]) => {
    const v = view();
    const node = find(v, id);
    if (node.kind === "bookmark") return void removeBookmark(node.id);
    if (v.current.children(node.id).length)
      throw new Error("Can't remove non-empty folder (use recursive to remove a folder).");
    removeBookmarkFolder(node.id);
  },
  "bookmarks.removeTree": ([id]) => {
    const node = find(view(), id);
    if (node.kind !== "folder") throw new Error("Only folders can be removed as a tree.");
    removeBookmarkTree(node.id);
  },
};

interface Snapshot {
  parentId: string;
  order: number;
  title: string;
  url?: string;
  node: ApiNode;
}
function snapshot(): Map<string, Snapshot> {
  const v = view();
  const out = new Map<string, Snapshot>();
  for (const folder of v.current.folders)
    if (folder.parentId && !v.skip.has(folder.id))
      out.set(folder.id, {
        parentId: folder.parentId,
        order: folder.order,
        title: folder.name,
        node: apiNode(v, { kind: "folder", ...folder }, false),
      });
  for (const item of visibleBookmarks(v))
    out.set(item.id, {
      parentId: item.folderId,
      order: item.order,
      title: item.title,
      url: item.url,
      node: apiNode(v, { kind: "bookmark", ...item }, false),
    });
  return out;
}

/** Reports bookmark changes, from this device or synced ones, as bookmarks events. */
export function watchBookmarks(): () => void {
  let previous = snapshot();
  return useWorkspaceStore.subscribe((state, prior) => {
    if (state.bookmarks === prior.bookmarks && state.bookmarkFolders === prior.bookmarkFolders)
      return;
    const current = snapshot();
    for (const [id, now] of current) {
      const before = previous.get(id);
      const apiId = toApi(id);
      if (!before) {
        emitCompatEvent("bookmarks.onCreated", [apiId, now.node]);
        continue;
      }
      if (before.title !== now.title || before.url !== now.url)
        emitCompatEvent("bookmarks.onChanged", [
          apiId,
          { title: now.title, ...(now.url ? { url: now.url } : {}) },
        ]);
      if (before.parentId !== now.parentId || before.order !== now.order)
        emitCompatEvent("bookmarks.onMoved", [
          apiId,
          {
            parentId: toApi(now.parentId),
            index: now.node.index,
            oldParentId: toApi(before.parentId),
            oldIndex: before.node.index,
          },
        ]);
    }
    for (const [id, before] of previous)
      if (!current.has(id))
        emitCompatEvent("bookmarks.onRemoved", [
          toApi(id),
          { parentId: toApi(before.parentId), index: before.node.index, node: before.node },
        ]);
    previous = current;
  });
}
