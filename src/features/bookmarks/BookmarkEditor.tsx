import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import {
  bookmarkUrl,
  createBookmarkFolder,
  removeBookmark,
  saveBookmark,
  unfiledFolderId,
  useBookmarkLibrary,
  type Bookmark,
} from "./library";

/** Mount a fresh editor for each request, so external updates never overwrite a draft. */
export function BookmarkEditor(props: {
  bookmark?: Bookmark;
  title?: string;
  url?: string;
  folderId?: string;
  onClose(): void;
}) {
  const { folders } = useBookmarkLibrary();
  const [title, setTitle] = useState(props.bookmark?.title ?? props.title ?? "");
  const [url, setUrl] = useState(props.bookmark?.url ?? props.url ?? "");
  const [folderId, setFolderId] = useState(
    props.bookmark?.folderId ?? props.folderId ?? unfiledFolderId,
  );
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>{props.bookmark ? "Edit bookmark" : "Add bookmark"}</DialogTitle>
        <DialogDescription>Keep a link in your bookmark library.</DialogDescription>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              bookmarkUrl(url);
              const target = folderId === "__new__" ? createBookmarkFolder(folderName) : folderId;
              saveBookmark({ id: props.bookmark?.id, title, url, folderId: target });
              props.onClose();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure));
            }
          }}
        >
          <Field label="Name">
            <Input
              autoFocus
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Address">
            <Input value={url} required onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Folder">
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!folders.some((f) => f.id === unfiledFolderId) && (
                  <SelectItem value={unfiledFolderId}>Bookmarks</SelectItem>
                )}
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
                <SelectItem value="__new__">New folder…</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {folderId === "__new__" && (
            <Field label="Folder name">
              <Input
                value={folderName}
                maxLength={160}
                required
                onChange={(e) => setFolderName(e.target.value)}
              />
            </Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            {props.bookmark && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  removeBookmark(props.bookmark!.id);
                  props.onClose();
                }}
              >
                Remove bookmark
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
