import {
  bookmarkRoots,
  bookmarksBarId,
  favoritesId,
  appsId,
  bookmarkTree,
  canNestBookmarkFolders,
  mobileBookmarksId,
  nestedFoldersUnavailable,
  otherBookmarksId,
  type BookmarkTree,
} from "@/features/bookmarks/library";
import type { SharedRecord } from "@/features/browser-workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { browserImport, type ImportedBookmarkNode, type ImportedBookmarkRoots } from "./native";

type Folders = SharedRecord<"folder">[];
type Links = SharedRecord<"bookmark">[];
export interface BookmarkMergeResult {
  folders: Folders;
  bookmarks: Links;
  added: { links: number; folders: number };
  /** Links already in the same folder, left as they were. */
  duplicates: number;
}

const targets = [
  ["bar", bookmarksBarId],
  ["other", otherBookmarksId],
  ["mobile", mobileBookmarksId],
] as const;

/** Whether placing `roots` needs folders below a root other than Other bookmarks. */
export function needsNestedFolders(roots: ImportedBookmarkRoots) {
  const hasFolder = (nodes: ImportedBookmarkNode[]) => nodes.some((n) => n.kind === "folder");
  return (
    hasFolder(roots.bar) ||
    hasFolder(roots.mobile) ||
    roots.other.some((n) => n.kind === "folder" && hasFolder(n.children))
  );
}

/**
 * Merges imported roots into the library the way browsers do on import: each
 * root into Misty's matching root, folders with the same name in the same
 * place reused, and links already in that folder skipped, so importing twice
 * changes nothing.
 */
export function mergeImportedBookmarks(
  current: { folders: Folders; bookmarks: Links },
  roots: ImportedBookmarkRoots,
): BookmarkMergeResult {
  const folders = [...current.folders];
  const bookmarks = [...current.bookmarks];
  const added = { links: 0, folders: 0 };
  let duplicates = 0;
  const tree: BookmarkTree = bookmarkTree(folders, bookmarks);
  // Per folder: subfolder names, link addresses and the next order, filled lazily.
  const known = new Map<string, { names: Map<string, string>; urls: Set<string>; next: number }>();
  const contents = (folderId: string) => {
    let entry = known.get(folderId);
    if (!entry) {
      const children = tree.children(folderId);
      entry = {
        names: new Map(
          children.flatMap((c) => (c.kind === "folder" ? [[c.name, c.id] as const] : [])),
        ),
        urls: new Set(children.flatMap((c) => (c.kind === "bookmark" ? [c.url] : []))),
        next: Math.max(-1, ...children.map((c) => c.order)) + 1,
      };
      known.set(folderId, entry);
    }
    return entry;
  };
  const ensureRoot = (id: string) => {
    if (folders.some((f) => f.id === id)) return;
    const index = bookmarkRoots.findIndex((root) => root.id === id);
    folders.push({
      kind: "folder",
      id,
      fields: { label: bookmarkRoots[index].stored, icon: "folder", hidden: false, order: index },
    });
  };
  const place = (parentId: string, nodes: ImportedBookmarkNode[]) => {
    const here = contents(parentId);
    for (const node of nodes) {
      if (node.kind === "link") {
        if (here.urls.has(node.url)) {
          duplicates += 1;
          continue;
        }
        here.urls.add(node.url);
        bookmarks.push({
          kind: "bookmark",
          id: `bookmark:${crypto.randomUUID()}`,
          fields: {
            folder_id: parentId,
            title: node.title,
            url: node.url,
            order: here.next++,
            pinned: true,
            ...(node.addedAt ? { added_at: node.addedAt } : {}),
          },
        });
        added.links += 1;
        continue;
      }
      let id = here.names.get(node.title);
      if (!id) {
        id = `folder:${crypto.randomUUID()}`;
        here.names.set(node.title, id);
        known.set(id, { names: new Map(), urls: new Set(), next: 0 });
        folders.push({
          kind: "folder",
          id,
          fields: {
            label: node.title,
            icon: "folder",
            hidden: false,
            order: here.next++,
            ...(parentId === otherBookmarksId ? {} : { parent_id: parentId }),
            ...(node.addedAt ? { added_at: node.addedAt } : {}),
          },
        });
        added.folders += 1;
      }
      place(id, node.children);
    }
  };
  for (const [key, rootId] of targets) {
    if (!roots[key].length) continue;
    ensureRoot(rootId);
    place(rootId, roots[key]);
  }
  return { folders, bookmarks, added, duplicates };
}

/** Applies an import to the library in one change. */
export function importBookmarks(roots: ImportedBookmarkRoots) {
  if (needsNestedFolders(roots) && !canNestBookmarkFolders())
    throw new Error(nestedFoldersUnavailable);
  const state = useWorkspaceStore.getState();
  const result = mergeImportedBookmarks(
    { folders: state.bookmarkFolders, bookmarks: state.bookmarks },
    roots,
  );
  const before = new Set(state.bookmarkFolders.map((f) => f.id));
  useWorkspaceStore.setState({
    // New folders are bookmark folders, never former saved-link groups.
    migratedTabGroupIds: [
      ...state.migratedTabGroupIds,
      ...result.folders.filter((f) => !before.has(f.id)).map((f) => f.id),
    ],
    bookmarkFolders: result.folders,
    bookmarks: result.bookmarks,
  });
  return result;
}

/** The library as the universal bookmarks file shapes it. */
export function libraryRoots(tree: BookmarkTree): ImportedBookmarkRoots {
  const nodes = (folderId: string): ImportedBookmarkNode[] =>
    tree
      .children(folderId)
      .map((node) =>
        node.kind === "folder"
          ? { kind: "folder", title: node.name, addedAt: node.addedAt, children: nodes(node.id) }
          : { kind: "link", title: node.title, url: node.url, addedAt: node.addedAt },
      );
  // Other browsers have no Favorites or Apps roots; they travel as folders in Other bookmarks.
  const extra = [
    { title: "Favorites", children: nodes(favoritesId) },
    { title: "Apps", children: nodes(appsId) },
  ].filter((folder) => folder.children.length);
  return {
    bar: nodes(bookmarksBarId),
    other: [
      ...nodes(otherBookmarksId),
      ...extra.map((folder) => ({ kind: "folder" as const, ...folder })),
    ],
    mobile: nodes(mobileBookmarksId),
  };
}

/** Saves the library as an HTML file; `false` when the person cancels. */
export function exportBookmarks() {
  const state = useWorkspaceStore.getState();
  return browserImport.saveBookmarks(
    libraryRoots(bookmarkTree(state.bookmarkFolders, state.bookmarks)),
  );
}
