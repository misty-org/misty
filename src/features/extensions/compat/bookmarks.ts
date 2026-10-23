import {
  createBookmarkFolder,
  moveBookmarkFolder,
  placeBookmarkNode,
  removeBookmark,
  removeBookmarkFolder,
  removeBookmarkTree,
  renameBookmarkFolder,
  saveBookmark,
} from "@/features/bookmarks/library";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  apiNode,
  describe,
  find,
  fromApi,
  parentFolder,
  rootId,
  rootNode,
  toApi,
  view,
  visibleBookmarks,
  type ApiNode,
} from "./bookmarkView";
import { compatObject, emitCompatEvent, type CompatHandler } from "./events";

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
