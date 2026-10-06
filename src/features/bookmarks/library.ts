import { useMemo } from "react";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { resolveDirectAddress } from "@/features/browser-workspace/address";
import type { SharedRecord } from "@/features/browser-workspace/model";
import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import {
  bookmarkRoots,
  bookmarkTree,
  isBookmarkRoot,
  maxFolderDepth,
  otherBookmarksId,
  type BookmarkRootId,
} from "./tree";

export * from "./tree";

// Keep the encrypted v1 wire names and IDs. They now represent bookmark folders
// and bookmarks only; live tab grouping has a separate model and lifecycle.
export function useBookmarkLibrary() {
  const folders = useWorkspaceStore((s) => s.bookmarkFolders);
  const items = useWorkspaceStore((s) => s.bookmarks);
  return useMemo(() => bookmarkTree(folders, items), [folders, items]);
}
function currentTree() {
  const state = useWorkspaceStore.getState();
  return bookmarkTree(state.bookmarkFolders, state.bookmarks);
}
function name(value: string) {
  const result = value.trim();
  if (!result || result.length > 160) throw new Error("Use a name between 1 and 160 characters.");
  return result;
}
export function bookmarkUrl(value: string) {
  const resolved = resolveDirectAddress(value.trim());
  if (!resolved) throw new Error("Enter a website address, such as example.com.");
  const url = new URL(resolved);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("Use an http or https address without a username or password.");
  return url.href;
}

export const nestedFoldersUnavailable =
  "Update Misty on your other devices to put folders inside folders.";
/** Folders below a root other than Other bookmarks need every synced device
 * to understand nesting. Without sync, nothing else has to. */
export function canNestBookmarkFolders() {
  const sync = useBrowserSyncStore.getState().session?.sync;
  return !sync || sync.nested_bookmarks === true;
}
/** The next order after a folder's existing subfolders and links. */
function nextOrder(folderId: string) {
  return (
    Math.max(
      -1,
      ...currentTree()
        .children(folderId)
        .map((node) => node.order),
    ) + 1
  );
}
/** Parent field for a folder placed in `parentId`. Folders directly in Other
 * bookmarks store none, which keeps them readable by older versions. */
function placement(parentId: string): { parent_id?: string } {
  if (parentId === otherBookmarksId) return {};
  if (!canNestBookmarkFolders()) throw new Error(nestedFoldersUnavailable);
  return { parent_id: parentId };
}

export function ensureBookmarkRoot(id: BookmarkRootId) {
  const state = useWorkspaceStore.getState();
  if (state.bookmarkFolders.some((folder) => folder.id === id)) return id;
  const index = bookmarkRoots.findIndex((root) => root.id === id);
  useWorkspaceStore.setState({
    migratedTabGroupIds: [...state.migratedTabGroupIds, id],
    bookmarkFolders: [
      ...state.bookmarkFolders,
      {
        kind: "folder",
        id,
        fields: { label: bookmarkRoots[index].stored, icon: "folder", hidden: false, order: index },
      },
    ],
  });
  return id;
}
function ensureFolder(id: string) {
  if (isBookmarkRoot(id)) ensureBookmarkRoot(id);
  if (!useWorkspaceStore.getState().bookmarkFolders.some((f) => f.id === id))
    throw new Error("Choose an existing folder.");
}

export function createBookmarkFolder(
  value: string,
  options: { parentId?: string; id?: string; addedAt?: number } = {},
) {
  const label = name(value),
    parentId = options.parentId ?? otherBookmarksId,
    id = options.id ?? `folder:${crypto.randomUUID()}`;
  if (useWorkspaceStore.getState().bookmarkFolders.some((folder) => folder.id === id)) return id;
  ensureFolder(parentId);
  if (currentTree().path(parentId).length > maxFolderDepth)
    throw new Error("Folders can't nest any deeper here.");
  const fields: SharedRecord<"folder">["fields"] = {
    label,
    icon: "folder",
    hidden: false,
    order: nextOrder(parentId),
    ...placement(parentId),
    ...(options.addedAt ? { added_at: options.addedAt } : {}),
  };
  const state = useWorkspaceStore.getState();
  useWorkspaceStore.setState({
    migratedTabGroupIds: [...state.migratedTabGroupIds, id],
    bookmarkFolders: [...state.bookmarkFolders, { kind: "folder", id, fields }],
  });
  return id;
}
export function renameBookmarkFolder(id: string, value: string) {
  if (isBookmarkRoot(id)) throw new Error("This folder can't be renamed.");
  const label = name(value);
  useWorkspaceStore.setState((s) => ({
    bookmarkFolders: s.bookmarkFolders.map((f) =>
      f.id === id ? { ...f, fields: { ...f.fields, label } } : f,
    ),
  }));
}
function withParent(fields: SharedRecord<"folder">["fields"], parentId: string, order: number) {
  const next = { ...fields, order, ...placement(parentId) };
  if (parentId === otherBookmarksId) delete next.parent_id;
  return next;
}
export function moveBookmarkFolder(id: string, parentId: string) {
  const tree = currentTree();
  if (isBookmarkRoot(id)) throw new Error("This folder can't be moved.");
  if (tree.descendants(id).has(parentId))
    throw new Error("A folder can't go inside itself or its own folders.");
  ensureFolder(parentId);
  const order = nextOrder(parentId);
  useWorkspaceStore.setState((s) => ({
    bookmarkFolders: s.bookmarkFolders.map((f) =>
      f.id === id ? { ...f, fields: withParent(f.fields, parentId, order) } : f,
    ),
  }));
}
/** Removing a folder moves its subfolders and links up into its parent. */
export function removeBookmarkFolder(id: string) {
  if (isBookmarkRoot(id)) return;
  const tree = currentTree();
  const parentId = tree.folder(id)?.parentId ?? otherBookmarksId;
  const children = tree.children(id);
  if (children.length) ensureFolder(parentId);
  const start = nextOrder(parentId);
  const order = new Map(children.map((node, index) => [node.id, start + index]));
  useWorkspaceStore.setState((s) => ({
    bookmarkFolders: s.bookmarkFolders
      .filter((f) => f.id !== id)
      .map((f) =>
        order.has(f.id) ? { ...f, fields: withParent(f.fields, parentId, order.get(f.id)!) } : f,
      ),
    bookmarks: s.bookmarks.map((b) =>
      order.has(b.id)
        ? { ...b, fields: { ...b.fields, folder_id: parentId, order: order.get(b.id)! } }
        : b,
    ),
  }));
}
export function saveBookmark(input: {
  id?: string;
  title: string;
  url: string;
  folderId?: string;
  addedAt?: number;
}) {
  const url = bookmarkUrl(input.url),
    title = name(input.title || new URL(url).hostname);
  const folderId = input.folderId || otherBookmarksId;
  ensureFolder(folderId);
  const state = useWorkspaceStore.getState();
  const existing = input.id ? state.bookmarks.find((b) => b.id === input.id) : undefined;
  if (input.id && !existing)
    throw new Error("This bookmark was removed. Add it again to save a new copy.");
  const id = existing?.id ?? `bookmark:${crypto.randomUUID()}`;
  const addedAt = existing?.fields.added_at ?? input.addedAt;
  const record: SharedRecord<"bookmark"> = {
    kind: "bookmark",
    id,
    fields: {
      folder_id: folderId,
      title,
      url,
      pinned: true,
      order: existing?.fields.folder_id === folderId ? existing.fields.order : nextOrder(folderId),
      ...(addedAt ? { added_at: addedAt } : {}),
    },
  };
  useWorkspaceStore.setState({
    bookmarks: existing
      ? state.bookmarks.map((b) => (b.id === id ? record : b))
      : [...state.bookmarks, record],
  });
  return id;
}
export function removeBookmark(id: string) {
  useWorkspaceStore.setState((s) => ({
    bookmarks: s.bookmarks.filter((b) => b.id !== id),
  }));
}
