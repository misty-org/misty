import type { SharedRecord } from "@/features/browser-workspace/model";

/** The roots every major browser has. Other bookmarks keeps the ID and stored
 * label ("Bookmarks") of the former single default folder. */
export const bookmarksBarId = "group:bookmarks-bar";
export const otherBookmarksId = "group:bookmarks";
export const mobileBookmarksId = "group:bookmarks-mobile";
export const bookmarkRoots = [
  { id: bookmarksBarId, label: "Bookmarks bar", stored: "Bookmarks bar" },
  { id: otherBookmarksId, label: "Other bookmarks", stored: "Bookmarks" },
  { id: mobileBookmarksId, label: "Mobile bookmarks", stored: "Mobile bookmarks" },
] as const;
export type BookmarkRootId = (typeof bookmarkRoots)[number]["id"];
/** Folders nest at most this deep below a root (native sync enforces the same). */
export const maxFolderDepth = 64;

export function isBookmarkRoot(id: string): id is BookmarkRootId {
  return bookmarkRoots.some((root) => root.id === id);
}

export interface BookmarkFolder {
  id: string;
  name: string;
  order: number;
  /** `null` for the roots. */
  parentId: string | null;
  addedAt?: number;
}
export interface Bookmark {
  id: string;
  folderId: string;
  title: string;
  url: string;
  order: number;
  addedAt?: number;
}
export type BookmarkNode =
  ({ kind: "folder" } & BookmarkFolder) | ({ kind: "bookmark" } & Bookmark);

/** Folders as stored. A folder without a parent, or whose parent is gone,
 * sits in Other bookmarks; `bookmarkTree` also breaks any parent cycle. */
export function bookmarkFolders(records: SharedRecord<"folder">[]): BookmarkFolder[] {
  const ids = new Set(records.map((record) => record.id));
  return records
    .map(({ id, fields }) => {
      const root = bookmarkRoots.find((r) => r.id === id);
      const parent = fields.parent_id;
      return {
        id,
        name: root?.label ?? fields.label,
        order: fields.order,
        parentId: root
          ? null
          : parent && parent !== id && ids.has(parent)
            ? parent
            : otherBookmarksId,
        addedAt: fields.added_at,
      };
    })
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
      addedAt: fields.added_at,
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface BookmarkTree {
  /** Every folder, the three roots included even before they are stored. */
  folders: BookmarkFolder[];
  /** Every bookmark, with a folder that exists (lost folders read as Other bookmarks). */
  bookmarks: Bookmark[];
  folder(id: string): BookmarkFolder | undefined;
  /** Subfolders and links in one order, as browsers show them. */
  children(folderId: string): BookmarkNode[];
  /** The folder's ancestors from its root down, ending with the folder. */
  path(folderId: string): BookmarkFolder[];
  /** The folder and every folder below it. */
  descendants(folderId: string): Set<string>;
}

function nodeOrder(a: BookmarkNode, b: BookmarkNode) {
  return (
    a.order - b.order ||
    (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1) ||
    a.id.localeCompare(b.id)
  );
}

export function bookmarkTree(
  folderRecords: SharedRecord<"folder">[],
  bookmarkRecords: SharedRecord<"bookmark">[],
): BookmarkTree {
  const stored = bookmarkFolders(folderRecords);
  const byId = new Map(stored.map((folder) => [folder.id, folder]));
  bookmarkRoots.forEach((root, order) => {
    if (!byId.has(root.id))
      byId.set(root.id, { id: root.id, name: root.label, order, parentId: null });
  });
  // Concurrent moves on two devices can close a loop; its first folder found
  // goes back to Other bookmarks.
  for (const folder of byId.values()) {
    const seen = new Set<string>([folder.id]);
    let parent = folder.parentId;
    while (parent && !isBookmarkRoot(parent)) {
      if (seen.has(parent) || seen.size > maxFolderDepth) {
        byId.set(folder.id, { ...folder, parentId: otherBookmarksId });
        break;
      }
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
  }
  const folders = [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const links = bookmarks(bookmarkRecords).map((bookmark) =>
    byId.has(bookmark.folderId) ? bookmark : { ...bookmark, folderId: otherBookmarksId },
  );
  const childFolders = new Map<string, BookmarkFolder[]>();
  for (const folder of folders)
    if (folder.parentId)
      childFolders.set(folder.parentId, [...(childFolders.get(folder.parentId) ?? []), folder]);
  return {
    folders,
    bookmarks: links,
    folder: (id) => byId.get(id),
    children(folderId) {
      return [
        ...(childFolders.get(folderId) ?? []).map((f) => ({ kind: "folder" as const, ...f })),
        ...links
          .filter((b) => b.folderId === folderId)
          .map((b) => ({ kind: "bookmark" as const, ...b })),
      ].sort(nodeOrder);
    },
    path(folderId) {
      const path: BookmarkFolder[] = [];
      for (let folder = byId.get(folderId); folder; folder = byId.get(folder.parentId ?? "")) {
        path.unshift(folder);
        if (!folder.parentId || path.length > maxFolderDepth) break;
      }
      return path;
    },
    descendants(folderId) {
      const out = new Set<string>([folderId]);
      const queue = [folderId];
      while (queue.length)
        for (const child of childFolders.get(queue.shift()!) ?? [])
          if (!out.has(child.id)) {
            out.add(child.id);
            queue.push(child.id);
          }
      return out;
    },
  };
}

/** Every folder depth first, for folder pickers, labeled with its path.
 * `exclude` leaves out a folder and everything below it (moving a folder). */
export function folderChoices(tree: BookmarkTree, exclude?: string) {
  const skip = exclude ? tree.descendants(exclude) : new Set<string>();
  const out: { id: string; label: string; depth: number }[] = [];
  const visit = (folder: BookmarkFolder, path: string[]) => {
    if (skip.has(folder.id)) return;
    const labels = [...path, folder.name];
    out.push({ id: folder.id, label: labels.join(" / "), depth: path.length });
    for (const child of tree.children(folder.id)) if (child.kind === "folder") visit(child, labels);
  };
  for (const root of bookmarkRoots) visit(tree.folder(root.id)!, []);
  return out;
}
