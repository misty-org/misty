import { ArrowDownUp, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { BrowserImportDialog, exportBookmarks } from "@/features/browser-import";
import {
  CollectionFilters,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  MenuItem,
  MenuTrigger,
  Pressable,
} from "@/shared/ui";
import { useState } from "react";
import { BookmarkEditor } from "@/features/bookmarks/BookmarkEditor";
import {
  BookmarkFolderDialog,
  type BookmarkFolderDraft,
} from "@/features/bookmarks/BookmarkFolderDialog";
import {
  bookmarkRoots,
  isBookmarkRoot,
  mobileBookmarksId,
  otherBookmarksId,
  removeBookmarkFolder,
  useBookmarkLibrary,
  type Bookmark,
} from "@/features/bookmarks/library";
import { InternalPageEmpty, InternalPageFrame } from "./InternalPageFrame";
import { BookmarkFolderRow, BookmarkLinkRow } from "./BookmarkRows";
import type { BrowserInternalPageProps } from "./types";

export function BookmarksPage(props: BrowserInternalPageProps) {
  const tree = useBookmarkLibrary();
  const [text, setText] = useState("");
  const [folderId, setFolderId] = useState<string>(otherBookmarksId);
  const [editing, setEditing] = useState<Bookmark | "new" | null>(null);
  const [folderDraft, setFolderDraft] = useState<BookmarkFolderDraft | null>(null);
  const [importing, setImporting] = useState(false);
  // A folder removed elsewhere falls back to Other bookmarks.
  const current = tree.folder(folderId) ? folderId : otherBookmarksId;
  const path = tree.path(current);
  const root = path[0]?.id ?? otherBookmarksId;
  const needle = text.trim().toLocaleLowerCase();
  const children = tree.children(current);
  const links = children.filter((node) => node.kind === "bookmark");
  const matches = needle
    ? tree.bookmarks.filter((b) => `${b.title} ${b.url}`.toLocaleLowerCase().includes(needle))
    : [];
  const location = (b: Bookmark) =>
    tree
      .path(b.folderId)
      .map((folder) => folder.name)
      .join(" / ");
  const roots = bookmarkRoots.filter(
    (r) => r.id !== mobileBookmarksId || tree.children(r.id).length || root === r.id,
  );
  return (
    <InternalPageFrame
      title="Bookmarks"
      search={{ value: text, placeholder: "Search bookmarks", onChange: setText }}
      actions={
        <>
          <DropdownMenu modal={false}>
            <MenuTrigger
              iconOnly
              label="Import and export bookmarks"
              icon={<ArrowDownUp size={16} />}
            />
            <DropdownMenuContent align="end">
              <MenuItem label="Import from another browser" onSelect={() => setImporting(true)} />
              <MenuItem
                label="Export bookmarks"
                onSelect={() => void exportBookmarks().catch(() => undefined)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu modal={false}>
            <MenuTrigger
              label="Add"
              variant="primary"
              className="h-9 px-4"
              icon={<Plus size={16} />}
            />
            <DropdownMenuContent align="end">
              <MenuItem label="Add bookmark" onSelect={() => setEditing("new")} />
              <MenuItem
                label="New folder"
                onSelect={() => setFolderDraft({ mode: "new", parentId: current })}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      toolbar={
        <CollectionFilters
          options={roots.map((r) => ({ value: r.id, label: r.label }))}
          value={root}
          onChange={setFolderId}
          actions={
            <DropdownMenu modal={false}>
              <MenuTrigger
                iconOnly
                label={`Manage folder ${path[path.length - 1]?.name ?? ""}`}
                icon={<MoreHorizontal size={16} />}
              />
              <DropdownMenuContent align="end">
                <MenuItem
                  label="Open all in new tabs"
                  disabled={!links.length}
                  onSelect={() => links.forEach((b) => props.openInNewView(b.url))}
                />
                {!isBookmarkRoot(current) && (
                  <>
                    <MenuItem
                      label="Rename folder"
                      onSelect={() =>
                        setFolderDraft({
                          mode: "rename",
                          id: current,
                          name: tree.folder(current)!.name,
                        })
                      }
                    />
                    <DropdownMenuSeparator />
                    <MenuItem
                      label="Remove folder, keep contents"
                      onSelect={() => {
                        setFolderId(tree.folder(current)?.parentId ?? otherBookmarksId);
                        removeBookmarkFolder(current);
                      }}
                    />
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      }
    >
      {!needle && path.length > 1 && (
        <nav
          aria-label="Folder path"
          className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-2"
        >
          {path.map((folder, index) =>
            index === path.length - 1 ? (
              <span
                key={folder.id}
                aria-current="page"
                className="truncate text-sm text-cream-bright"
              >
                {folder.name}
              </span>
            ) : (
              <span key={folder.id} className="flex min-w-0 items-center gap-1">
                <Pressable
                  className="truncate rounded-sm text-sm text-cream-muted hover:text-cream-bright"
                  onClick={() => setFolderId(folder.id)}
                >
                  {folder.name}
                </Pressable>
                <ChevronRight size={14} className="shrink-0 text-cream-muted" aria-hidden />
              </span>
            ),
          )}
        </nav>
      )}
      {needle ? (
        matches.length ? (
          <ul className="grid">
            {matches.map((b) => (
              <BookmarkLinkRow
                key={b.id}
                {...props}
                bookmark={b}
                location={location(b)}
                onEdit={() => setEditing(b)}
              />
            ))}
          </ul>
        ) : (
          <InternalPageEmpty title="No matching bookmarks" detail="Try another name or address." />
        )
      ) : children.length ? (
        <ul className="grid">
          {children.map((node) =>
            node.kind === "folder" ? (
              <BookmarkFolderRow
                key={node.id}
                folder={node}
                count={tree.children(node.id).length}
                onOpen={() => setFolderId(node.id)}
                onRename={() => setFolderDraft({ mode: "rename", id: node.id, name: node.name })}
                onMove={() =>
                  setFolderDraft({ mode: "move", id: node.id, parentId: node.parentId ?? current })
                }
                onRemove={() => removeBookmarkFolder(node.id)}
              />
            ) : (
              <BookmarkLinkRow
                key={node.id}
                {...props}
                bookmark={node}
                onEdit={() => setEditing(node)}
              />
            ),
          )}
        </ul>
      ) : (
        <InternalPageEmpty
          title={path.length > 1 ? "No bookmarks in this folder" : "No bookmarks yet"}
          detail="Save a page with the star in the address bar, or add a bookmark here."
        />
      )}
      {editing && (
        <BookmarkEditor
          bookmark={editing === "new" ? undefined : editing}
          folderId={current}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && <BrowserImportDialog onClose={() => setImporting(false)} />}
      {folderDraft && (
        <BookmarkFolderDialog draft={folderDraft} onClose={() => setFolderDraft(null)} />
      )}
    </InternalPageFrame>
  );
}
