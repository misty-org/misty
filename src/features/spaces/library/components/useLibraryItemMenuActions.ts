import { transcribeLibraryFile } from "@/features/voice";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { libraryMediaKind } from "../library-viewer/libraryMediaKind";
import { libraryItemMIME } from "../SpaceLibraryPrimitives";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import type { LibraryItemMenuActions } from "./LibraryItemContextMenu";

function transcribable(item: SpaceLibraryItem) {
  const kind = libraryMediaKind(libraryItemMIME(item), item.file.intrinsic_metadata);
  return kind.isAudio || kind.isVideo;
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
