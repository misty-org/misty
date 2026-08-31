import type {
  LibraryAssetStack,
  LibraryEditVersion,
  SpaceLibraryItem,
} from "@/api/spaces/dto/interfaces/types";
import { Button, DialogClose } from "@/shared/ui";
import { ClipboardCopy, Copy, EyeOff, SlidersHorizontal, Star, Trash2, X } from "lucide-react";

export interface LibraryViewerToolbarProps {
  item: SpaceLibraryItem;
  assetStack: LibraryAssetStack | null;
  stackMediaID: string;
  stackMemberRole: string | undefined;
  activeEdit: LibraryEditVersion | null;
  renditionReady: boolean;
  canEdit: boolean;
  canCopy: boolean;
  editing: boolean;
  editSaving: boolean;
  editingAvailable: boolean;
  onSetStackCover: () => void;
  onUngroupStack: () => void;
  onCopyEdit: () => void;
  onSaveAsCopy: () => void;
  onSaveEdit: () => void;
  onToggleFavorite: () => void;
  onToggleHidden: () => void;
  onBeginEditing: () => void;
  onCopyItem: () => void;
  onTrash: () => void;
}

export function LibraryViewerToolbar(props: LibraryViewerToolbarProps) {
  const { item, assetStack, canEdit, canCopy, activeEdit, renditionReady } = props;
  const canMakeKeyPhoto =
    canEdit &&
    assetStack !== null &&
    props.stackMediaID !== assetStack.cover_item_id &&
    props.stackMemberRole !== "motion" &&
    props.stackMemberRole !== "raw";
  const copyLabel = activeEdit
    ? renditionReady
      ? "Copy edited media"
      : "Edited media is rendering"
    : "Copy to clipboard";

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto py-1">
      {canMakeKeyPhoto ? (
        <Button size="sm" variant="outline" type="button" onClick={props.onSetStackCover}>
          Make key photo
        </Button>
      ) : null}
      {canEdit && assetStack ? (
        <Button size="sm" variant="outline" type="button" onClick={props.onUngroupStack}>
          Ungroup
        </Button>
      ) : null}
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
      {canEdit ? (
        <IconButton
          icon={<Star size={15} fill={item.favorite ? "currentColor" : "none"} />}
          label={item.favorite ? "Remove favorite" : "Favorite"}
          onClick={props.onToggleFavorite}
        />
      ) : null}
      {canEdit ? (
        <IconButton
          icon={<EyeOff size={15} />}
          label={item.hidden ? "Unhide" : "Hide"}
          onClick={props.onToggleHidden}
        />
      ) : null}
      {canEdit && props.editingAvailable ? (
        <IconButton
          icon={<SlidersHorizontal size={15} />}
          label="Edit"
          onClick={props.onBeginEditing}
        />
      ) : null}
      {canCopy ? (
        <IconButton
          icon={<ClipboardCopy size={15} />}
          label={copyLabel}
          disabled={Boolean(activeEdit) && !renditionReady}
          onClick={props.onCopyItem}
        />
      ) : null}
      {canEdit ? (
        <IconButton
          icon={<Trash2 size={15} />}
          label="Move to Recently Deleted"
          onClick={props.onTrash}
        />
      ) : null}
      <DialogClose asChild>
        <Button size="icon" variant="outline" type="button" aria-label="Close">
          <X size={15} />
        </Button>
      </DialogClose>
    </div>
  );
}

function IconButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="icon"
      variant="outline"
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
    </Button>
  );
}
