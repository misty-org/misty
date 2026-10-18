import type { LibraryEditVersion, SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { Button, DialogClose, IconButton } from "@/shared/ui";
import { ClipboardCopy, Copy, SlidersHorizontal, Trash2, X } from "lucide-react";

export interface LibraryViewerToolbarProps {
  item: SpaceLibraryItem;
  activeEdit: LibraryEditVersion | null;
  renditionReady: boolean;
  canEdit: boolean;
  canCopy: boolean;
  editing: boolean;
  editSaving: boolean;
  editingAvailable: boolean;
  onCopyEdit: () => void;
  onSaveAsCopy: () => void;
  onSaveEdit: () => void;
  onBeginEditing: () => void;
  onCopyItem: () => void;
  onTrash: () => void;
}

export function LibraryViewerToolbar(props: LibraryViewerToolbarProps) {
  const { canEdit, canCopy, activeEdit, renditionReady } = props;
  const copyLabel = activeEdit
    ? renditionReady
      ? "Copy edited media"
      : "Edited media is rendering"
    : "Copy to clipboard";

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto py-1">
      {canEdit && activeEdit ? (
        <Button size="sm" variant="outline" type="button" onClick={props.onCopyEdit}>
          <Copy size={12} />
          Copy edits
        </Button>
      ) : null}
      {canEdit ? (
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={props.editSaving}
          onClick={props.onSaveAsCopy}
        >
          <Copy size={12} />
          Save as copy
        </Button>
      ) : null}
      {canEdit && props.editing ? (
        <Button size="sm" type="button" disabled={props.editSaving} onClick={props.onSaveEdit}>
          {props.editSaving ? "Saving…" : "Save"}
        </Button>
      ) : null}
      {canEdit && props.editingAvailable ? (
        <IconButton size="md" variant="outline" label="Edit" onClick={props.onBeginEditing}>
          <SlidersHorizontal size={15} />
        </IconButton>
      ) : null}
      {canCopy ? (
        <IconButton
          size="md"
          variant="outline"
          label={copyLabel}
          disabled={Boolean(activeEdit) && !renditionReady}
          onClick={props.onCopyItem}
        >
          <ClipboardCopy size={15} />
        </IconButton>
      ) : null}
      {canEdit ? (
        <IconButton
          size="md"
          variant="outline"
          label="Move to Recently Deleted"
          onClick={props.onTrash}
        >
          <Trash2 size={15} />
        </IconButton>
      ) : null}
      <DialogClose asChild>
        <IconButton size="md" variant="outline" label="Close" tooltip={false}>
          <X size={15} />
        </IconButton>
      </DialogClose>
    </div>
  );
}
