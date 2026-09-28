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
export function bookmarkFolders(records: SharedRecord<"group">[]): BookmarkFolder[] {
  return records
    .map(({ id, fields }) => ({ id, name: fields.label, order: fields.order }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function bookmarks(records: SharedRecord<"website">[]): Bookmark[] {
  return records
    .map(({ id, fields }) => ({
      id,
      folderId: fields.group_id,
      title: fields.title,
      url: fields.url,
      order: fields.order,
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function useBookmarkLibrary() {
  const folders = useWorkspaceStore((s) => s.websiteGroups);
  const items = useWorkspaceStore((s) => s.savedWebsites);
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
export function createBookmarkFolder(value: string, id = `group:${crypto.randomUUID()}`) {
  const label = name(value),
    state = useWorkspaceStore.getState();
  if (state.websiteGroups.some((folder) => folder.id === id)) return id;
  useWorkspaceStore.setState({
    migratedTabGroupIds: [...state.migratedTabGroupIds, id],
    websiteGroups: [
      ...state.websiteGroups,
      {
        kind: "group",
        id,
        fields: {
          label,
          icon: "folder",
          hidden: false,
          order: Math.max(-1, ...state.websiteGroups.map((f) => f.fields.order)) + 1,
        },
      },
    ],
  });
  return id;
}
export function renameBookmarkFolder(id: string, value: string) {
  const label = name(value);
  useWorkspaceStore.setState((s) => ({
    websiteGroups: s.websiteGroups.map((f) =>
      f.id === id ? { ...f, fields: { ...f.fields, label } } : f,
    ),
  }));
}
/** Removing a folder retains its bookmarks in the default folder. */
export function removeBookmarkFolder(id: string) {
  if (id === unfiledFolderId) return;
  const state = useWorkspaceStore.getState();
  if (state.savedWebsites.some((b) => b.fields.group_id === id))
    createBookmarkFolder("Bookmarks", unfiledFolderId);
  useWorkspaceStore.setState((s) => ({
    websiteGroups: s.websiteGroups.filter((f) => f.id !== id),
    savedWebsites: s.savedWebsites.map((b) =>
      b.fields.group_id === id ? { ...b, fields: { ...b.fields, group_id: unfiledFolderId } } : b,
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
  if (!state.websiteGroups.some((f) => f.id === folderId))
    throw new Error("Choose an existing folder.");
  const existing = input.id ? state.savedWebsites.find((b) => b.id === input.id) : undefined;
  if (input.id && !existing)
    throw new Error("This bookmark was removed. Add it again to save a new copy.");
  const id = existing?.id ?? `website:${crypto.randomUUID()}`;
  const record: SharedRecord<"website"> = {
    kind: "website",
    id,
    fields: {
      group_id: folderId,
      title,
      url,
      pinned: true,
      order:
        existing?.fields.group_id === folderId
          ? existing.fields.order
          : Math.max(
              -1,
              ...state.savedWebsites
                .filter((b) => b.fields.group_id === folderId)
                .map((b) => b.fields.order),
            ) + 1,
    },
  };
  useWorkspaceStore.setState({
    savedWebsites: existing
      ? state.savedWebsites.map((b) => (b.id === id ? record : b))
      : [...state.savedWebsites, record],
  });
  return id;
}
export function removeBookmark(id: string) {
  useWorkspaceStore.setState((s) => ({
    savedWebsites: s.savedWebsites.filter((b) => b.id !== id),
  }));
}
