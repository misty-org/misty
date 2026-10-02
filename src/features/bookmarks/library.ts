import { useMemo } from "react";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { resolveDirectAddress } from "@/features/browser-workspace/address";
import type { SharedRecord } from "@/features/browser-workspace/model";

export interface BookmarkFolder {
  id: string;
  name: string;
  order: number;
}
export interface Bookmark {
  id: string;
  folderId: string;
  title: string;
  url: string;
  order: number;
}
export const unfiledFolderId = "group:bookmarks";

// Keep the encrypted v1 wire names and IDs. They now represent bookmark folders
// and bookmarks only; live tab grouping has a separate model and lifecycle.
export function bookmarkFolders(records: SharedRecord<"folder">[]): BookmarkFolder[] {
  return records
    .map(({ id, fields }) => ({ id, name: fields.label, order: fields.order }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function bookmarks(records: SharedRecord<"bookmark">[]): Bookmark[] {
  return records
    .map(({ id, fields }) => ({
      id,
      folderId: fields.folder_id,
      title: fields.title,
      url: fields.url,
      order: fields.order,
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function useBookmarkLibrary() {
  const folders = useWorkspaceStore((s) => s.bookmarkFolders);
  const items = useWorkspaceStore((s) => s.bookmarks);
  return useMemo(
    () => ({ folders: bookmarkFolders(folders), bookmarks: bookmarks(items) }),
    [folders, items],
  );
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
export function createBookmarkFolder(value: string, id = `folder:${crypto.randomUUID()}`) {
  const label = name(value),
    state = useWorkspaceStore.getState();
  if (state.bookmarkFolders.some((folder) => folder.id === id)) return id;
  useWorkspaceStore.setState({
    migratedTabGroupIds: [...state.migratedTabGroupIds, id],
    bookmarkFolders: [
      ...state.bookmarkFolders,
      {
        kind: "folder",
        id,
        fields: {
          label,
          icon: "folder",
          hidden: false,
          order: Math.max(-1, ...state.bookmarkFolders.map((f) => f.fields.order)) + 1,
        },
      },
    ],
  });
  return id;
}
export function renameBookmarkFolder(id: string, value: string) {
  const label = name(value);
  useWorkspaceStore.setState((s) => ({
    bookmarkFolders: s.bookmarkFolders.map((f) =>
      f.id === id ? { ...f, fields: { ...f.fields, label } } : f,
    ),
  }));
}
/** Removing a folder retains its bookmarks in the default folder. */
export function removeBookmarkFolder(id: string) {
  if (id === unfiledFolderId) return;
  const state = useWorkspaceStore.getState();
  if (state.bookmarks.some((b) => b.fields.folder_id === id))
    createBookmarkFolder("Bookmarks", unfiledFolderId);
  useWorkspaceStore.setState((s) => ({
    bookmarkFolders: s.bookmarkFolders.filter((f) => f.id !== id),
    bookmarks: s.bookmarks.map((b) =>
      b.fields.folder_id === id ? { ...b, fields: { ...b.fields, folder_id: unfiledFolderId } } : b,
    ),
  }));
}
export function saveBookmark(input: {
  id?: string;
  title: string;
  url: string;
  folderId?: string;
}) {
  const url = bookmarkUrl(input.url),
    title = name(input.title || new URL(url).hostname);
  const folderId = input.folderId || unfiledFolderId;
  if (folderId === unfiledFolderId) createBookmarkFolder("Bookmarks", folderId);
  const state = useWorkspaceStore.getState();
  if (!state.bookmarkFolders.some((f) => f.id === folderId))
    throw new Error("Choose an existing folder.");
  const existing = input.id ? state.bookmarks.find((b) => b.id === input.id) : undefined;
  if (input.id && !existing)
    throw new Error("This bookmark was removed. Add it again to save a new copy.");
  const id = existing?.id ?? `bookmark:${crypto.randomUUID()}`;
  const record: SharedRecord<"bookmark"> = {
    kind: "bookmark",
    id,
    fields: {
      folder_id: folderId,
      title,
      url,
      pinned: true,
      order:
        existing?.fields.folder_id === folderId
          ? existing.fields.order
          : Math.max(
              -1,
              ...state.bookmarks
                .filter((b) => b.fields.folder_id === folderId)
                .map((b) => b.fields.order),
            ) + 1,
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
