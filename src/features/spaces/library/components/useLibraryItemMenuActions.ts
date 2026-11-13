import { transcribeLibraryFile } from "@/features/voice";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { libraryMediaKind } from "../library-viewer/libraryMediaKind";
import { libraryItemMIME } from "../SpaceLibraryPrimitives";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import type { LibraryItemMenuActions } from "./LibraryItemContextMenu";

/** The most the server reads of a file to transcribe it (`voiceFileMaxBytes`). */
const transcribeMaxBytes = 25_000_000;

function transcribable(item: SpaceLibraryItem) {
  const kind = libraryMediaKind(libraryItemMIME(item), item.file.intrinsic_metadata);
  if (!kind.isAudio && !kind.isVideo) return false;
  // A file too big to transcribe isn't offered it. One whose size isn't known is.
  const size = Number(item.file.intrinsic_metadata.byte_size ?? 0);
  return !Number.isFinite(size) || size <= transcribeMaxBytes;
}

/** What one Library item's menu offers, wired to the Library's actions. */
export function useLibraryItemMenuActions() {
  const { data, itemActions } = useSpaceLibraryContext();
  const { spaceId, canEditLibrary, collection, showTextDialog } = data;
  const { copyItemsToClipboard, duplicateItems, trashItem, restoreItem } = itemActions;
  return (item: SpaceLibraryItem): LibraryItemMenuActions => ({
    item,
    canCopy: true,
    canEdit: canEditLibrary,
    deleted: collection === "deleted",
    onTranscribe: transcribable(item)
      ? () => void transcribeLibraryFile(spaceId, item.id, item.display_name)
      : undefined,
    onCopy: () => void copyItemsToClipboard([item]),
    onDuplicate: () => void duplicateItems([item.id]),
    onRename: () =>
      showTextDialog({
        kind: "rename-item",
        title: "Rename Library item",
        primaryLabel: "Name",
        primaryValue: item.display_name,
        itemId: item.id,
      }),
    onEditTags: () =>
      showTextDialog({
        kind: "edit-tags",
        title: "Edit tags",
        primaryLabel: "Tags, separated by commas",
        primaryValue: item.tags.join(", "),
        itemId: item.id,
      }),
    onTrash: () => void trashItem(item),
    onRestore: () => void restoreItem(item),
  });
}
