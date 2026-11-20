import { DialogClose, IconButton } from "@misty/ui";
import { ClipboardCopy, Trash2, X } from "lucide-react";

interface LibraryViewerToolbarProps {
  canEdit: boolean;
  canCopy: boolean;
  onCopyItem: () => void;
  onTrash: () => void;
}

/** The open file's own controls: copy it, move it to Recently deleted, close the preview. */
export function LibraryViewerToolbar(props: LibraryViewerToolbarProps) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto py-1">
      {props.canCopy ? (
        <IconButton size="md" variant="secondary" label="Copy to clipboard" onClick={props.onCopyItem}>
          <ClipboardCopy />
        </IconButton>
      ) : null}
      {props.canEdit ? (
        <IconButton
          size="md"
          variant="secondary"
          label="Move to Recently Deleted"
          onClick={props.onTrash}
        >
          <Trash2 />
        </IconButton>
      ) : null}
      <DialogClose asChild>
        <IconButton size="md" variant="secondary" label="Close">
          <X />
        </IconButton>
      </DialogClose>
    </div>
  );
}
