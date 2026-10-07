import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
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
  createBookmarkFolder,
  folderChoices,
  moveBookmarkFolder,
  renameBookmarkFolder,
  useBookmarkLibrary,
} from "./library";

export type BookmarkFolderDraft =
  | { mode: "new"; parentId: string }
  | { mode: "rename"; id: string; name: string }
  | { mode: "move"; id: string; parentId: string };

/** New, rename and move for bookmark folders, in the shared compact dialog. */
export function BookmarkFolderDialog(props: {
  draft: BookmarkFolderDraft;
  onClose(): void;
  onCreated?(id: string): void;
}) {
  const { draft } = props;
  const tree = useBookmarkLibrary();
  const [name, setName] = useState(draft.mode === "rename" ? draft.name : "");
  const [parentId, setParentId] = useState(draft.mode === "rename" ? "" : draft.parentId);
  const [error, setError] = useState("");
  const choices = folderChoices(tree, draft.mode === "move" ? draft.id : undefined);
  const title =
    draft.mode === "new" ? "New folder" : draft.mode === "rename" ? "Rename folder" : "Move folder";
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>{title}</DialogTitle>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              if (draft.mode === "rename") renameBookmarkFolder(draft.id, name);
              else if (draft.mode === "move") moveBookmarkFolder(draft.id, parentId);
              else props.onCreated?.(createBookmarkFolder(name, { parentId }));
              props.onClose();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure));
            }
          }}
        >
          {draft.mode !== "move" && (
            <Field label="Folder name">
              <Input
                autoFocus
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}
          {draft.mode !== "rename" && (
            <Field label={draft.mode === "move" ? "Move to" : "Inside"}>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((choice) => (
                    <SelectItem key={choice.id} value={choice.id}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit">{draft.mode === "move" ? "Move" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
