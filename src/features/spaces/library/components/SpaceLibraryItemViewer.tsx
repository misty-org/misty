import type { SpaceLibraryItem } from "../../api/dto/entities";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryViewer } from "../SpaceLibraryViewer";
import type { SpaceLibraryData } from "../hook-signatures/useSpaceLibraryData";

/** The item open in Media, or null when none is. */
export function openLibraryItem(data: SpaceLibraryData): SpaceLibraryItem | null {
  const { selectedItemId, displayItems, items } = data;
  if (!selectedItemId) return null;
  return (
    displayItems.find((item) => item.id === selectedItemId) ??
    items.find((item) => item.id === selectedItemId) ??
    null
  );
}

/** The open item: in its editor in the page, or in the viewer over it. */
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
      onCopyEdit={(definition) => data.setCopiedEditDefinition(structuredClone(definition))}
      onClose={() => setSelectedItemId("")}
      onSelect={setSelectedItemId}
      onUpdate={itemActions.updateItem}
      onReplaceItem={itemActions.replaceItem}
      onRenditionReady={() => data.setReloadKey((current) => current + 1)}
      onTrash={itemActions.trashItem}
    />
  );
}
