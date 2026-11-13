import type { LibraryEditVersion, SpaceLibraryItem } from "../../api/dto/entities";
import { Button, DialogClose, IconButton } from "@/shared/ui";
import { ClipboardCopy, Copy, SlidersHorizontal, Trash2, X } from "lucide-react";

interface LibraryViewerToolbarProps {
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
        <Button variant="secondary" type="button" onClick={props.onCopyEdit}>
          <Copy />
          Copy edits
        </Button>
      ) : null}
      {canEdit ? (
        <Button
          variant="secondary"
          type="button"
          disabled={props.editSaving}
          onClick={props.onSaveAsCopy}
        >
          <Copy />
          Save as copy
        </Button>
      ) : null}
      {canEdit && props.editing ? (
        <Button type="button" loading={props.editSaving} onClick={props.onSaveEdit}>
          Save
        </Button>
      ) : null}
      {canEdit && props.editingAvailable ? (
        <IconButton size="md" variant="secondary" label="Edit" onClick={props.onBeginEditing}>
          <SlidersHorizontal />
        </IconButton>
      ) : null}
      {canCopy ? (
        <IconButton
          size="md"
          variant="secondary"
          label={copyLabel}
          disabled={Boolean(activeEdit) && !renditionReady}
          onClick={props.onCopyItem}
        >
          <ClipboardCopy />
        </IconButton>
      ) : null}
      {canEdit ? (
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
