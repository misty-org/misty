import type { SpaceLibraryItem } from "../../api/dto/entities";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryViewer } from "../SpaceLibraryViewer";
import type { SpaceLibraryData } from "../hook-signatures/useSpaceLibraryData";

/** The item open in Files, or null when none is. */
export function openLibraryItem(data: SpaceLibraryData): SpaceLibraryItem | null {
  const { selectedItemId, displayItems, items } = data;
  if (!selectedItemId) return null;
  return (
    displayItems.find((item) => item.id === selectedItemId) ??
    items.find((item) => item.id === selectedItemId) ??
    null
  );
}

/** The open item, in the preview over Files. */
export function SpaceLibraryItemViewer({ item }: { item: SpaceLibraryItem }) {
  const { data, itemActions } = useSpaceLibraryContext();
  const { spaceId, canEditLibrary, displayItems, setSelectedItemId } = data;
  return (
    <SpaceLibraryViewer
      spaceId={spaceId}
      item={item}
      items={displayItems}
      canEdit={canEditLibrary}
      canCopy
      returnFocusRef={data.libraryViewerTriggerRef}
      onClose={() => setSelectedItemId("")}
      onSelect={setSelectedItemId}
      onUpdate={itemActions.updateItem}
      onTrash={itemActions.trashItem}
    />
  );
}
