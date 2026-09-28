import { Bookmark, Folder, MoreHorizontal, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  Field,
  Input,
  ListRow,
  ListRowButton,
  MenuItem,
  MenuTrigger,
} from "@/shared/ui";
import { useState } from "react";
import { BookmarkEditor } from "@/features/bookmarks/BookmarkEditor";
import {
  createBookmarkFolder,
  removeBookmark,
  removeBookmarkFolder,
  renameBookmarkFolder,
  unfiledFolderId,
  useBookmarkLibrary,
  type Bookmark as BookmarkItem,
} from "@/features/bookmarks/library";
import { InternalPageEmpty, InternalPageFrame, SiteIcon } from "./InternalPageFrame";
import type { BrowserInternalPageProps } from "./types";

export function BookmarksPage(props: BrowserInternalPageProps) {
  const { folders, bookmarks } = useBookmarkLibrary();
  const [text, setText] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BookmarkItem | "new" | null>(null);
  const [folderDraft, setFolderDraft] = useState<{ id?: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const selected = folders.find((f) => f.id === folderId);
  const needle = text.trim().toLocaleLowerCase();
  const matches = bookmarks.filter(
    (b) =>
      (!selected || b.folderId === selected.id) &&
      (!needle || `${b.title} ${b.url}`.toLocaleLowerCase().includes(needle)),
  );
  return (
    <InternalPageFrame
      title="Bookmarks"
      icon={Bookmark}
      search={{ value: text, placeholder: "Search bookmarks", onChange: setText }}
      actions={
        <DropdownMenu modal={false}>
          <MenuTrigger label="Add" icon={<Plus size={16} />} />
          <DropdownMenuContent align="end">
            <MenuItem label="Add bookmark" onSelect={() => setEditing("new")} />
            <MenuItem
              label="New folder"
              onSelect={() => {
                setError("");
                setFolderDraft({ name: "" });
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-1" aria-label="Bookmark folders">
        <Button
          size="sm"
          variant={selected ? "ghost" : "secondary"}
          aria-pressed={!selected}
          onClick={() => setFolderId(null)}
        >
          All bookmarks
        </Button>
        {folders.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={selected?.id === f.id ? "secondary" : "ghost"}
            aria-pressed={selected?.id === f.id}
            className="max-w-48"
            onClick={() => setFolderId(f.id)}
          >
            <Folder size={14} />
            <span className="truncate">{f.name}</span>
          </Button>
        ))}
      </div>
      {selected && (
        <div className="mb-2 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{selected.name}</h2>
          <DropdownMenu modal={false}>
            <MenuTrigger
              iconOnly
              label={`Manage folder ${selected.name}`}
              icon={<MoreHorizontal size={16} />}
            />
            <DropdownMenuContent align="end">
              <MenuItem
                label="Open all in new tabs"
                disabled={!matches.length}
                onSelect={() => matches.forEach((b) => props.openInNewTab(b.url))}
              />
              <MenuItem
                label="Rename folder"
                onSelect={() => {
                  setError("");
                  setFolderDraft({ id: selected.id, name: selected.name });
                }}
              />
              <DropdownMenuSeparator />
              <MenuItem
                label="Remove folder, keep bookmarks"
                disabled={selected.id === unfiledFolderId}
                onSelect={() => {
                  removeBookmarkFolder(selected.id);
                  setFolderId(null);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {matches.length ? (
        <ul className="grid">
          {matches.map((b) => (
            <ListRow key={b.id}>
              <SiteIcon url={b.url} />
              <ListRowButton
                title={b.url}
                onClick={(event) =>
                  event.metaKey || event.ctrlKey ? props.openInNewTab(b.url) : props.navigate(b.url)
                }
              >
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-1.5">
                  <span className="max-w-full truncate text-sm text-cream-bright">{b.title}</span>
                  <span className="max-w-full truncate text-xs text-cream-muted">{b.url}</span>
                </span>
                {!selected && (
                  <span className="max-w-32 truncate text-xs text-cream-muted">
                    {folders.find((f) => f.id === b.folderId)?.name ?? "Recovered bookmarks"}
                  </span>
                )}
              </ListRowButton>
              <DropdownMenu modal={false}>
                <MenuTrigger
                  iconOnly
                  label={`Manage bookmark ${b.title}`}
                  icon={<MoreHorizontal size={16} />}
                />
                <DropdownMenuContent align="end">
                  <MenuItem label="Open in new tab" onSelect={() => props.openInNewTab(b.url)} />
                  <MenuItem label="Edit bookmark" onSelect={() => setEditing(b)} />
                  <DropdownMenuSeparator />
                  <MenuItem label="Remove bookmark" onSelect={() => removeBookmark(b.id)} />
                </DropdownMenuContent>
              </DropdownMenu>
            </ListRow>
          ))}
        </ul>
      ) : (
        <InternalPageEmpty
          title={needle ? "No matching bookmarks" : "No bookmarks yet"}
          detail={
            needle
              ? "Try another name or address."
              : "Save a page with the star in the address bar, or add a bookmark here."
          }
        />
      )}
      {editing && (
        <BookmarkEditor
          bookmark={editing === "new" ? undefined : editing}
          folderId={selected?.id}
          onClose={() => setEditing(null)}
        />
      )}
      {folderDraft && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setFolderDraft(null);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogTitle>{folderDraft.id ? "Rename folder" : "New folder"}</DialogTitle>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  if (folderDraft.id) renameBookmarkFolder(folderDraft.id, folderDraft.name);
                  else setFolderId(createBookmarkFolder(folderDraft.name));
                  setFolderDraft(null);
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : String(failure));
                }
              }}
            >
              <Field label="Folder name">
                <Input
                  autoFocus
                  required
                  maxLength={160}
                  value={folderDraft.name}
                  onChange={(e) => setFolderDraft({ ...folderDraft, name: e.target.value })}
                />
              </Field>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button variant="ghost" type="button" onClick={() => setFolderDraft(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </InternalPageFrame>
  );
}
