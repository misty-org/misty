import { MistyFilePicker } from "@/features/files";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryDialogs } from "../SpaceLibraryDialogs";
import { SpaceLibraryViewer } from "../SpaceLibraryViewer";
import { LibraryItemContextMenu } from "./LibraryItemContextMenu";
import { useLibraryItemMenuActions } from "./useLibraryItemMenuActions";

export function SpaceLibraryOverlays() {
  const { data, itemActions, collectionActions } = useSpaceLibraryContext();
  const {
    spaceId,
    canUploadLibrary,
    canEditLibrary,
    items,
    visibleItems,
    displayItems,
    itemMenu,
    setItemMenu,
    filePickerOpen,
    setFilePickerOpen,
    selectedItemId,
    setSelectedItemId,
    libraryViewerTriggerRef,
    metadataDialogAction,
    setMetadataDialogAction,
    selectedItems,
    metadataTags,
    setMetadataTags,
    metadataDate,
    setMetadataDate,
    metadataLocationName,
    setMetadataLocationName,
    metadataLatitude,
    setMetadataLatitude,
    metadataLongitude,
    setMetadataLongitude,
    bulkSaving,
    textDialog,
    setTextDialog,
    textDialogSaving,
    textDialogError,
    setCopiedEditDefinition,
    setReloadKey,
  } = data;
  const { uploadFiles, updateItem, replaceItem, trashItem, saveBulkMetadata } = itemActions;
  const { submitTextDialog } = collectionActions;
  const menuActions = useLibraryItemMenuActions();
  const menuItem = itemMenu
    ? (items.find((item) => item.id === itemMenu.itemId) ??
      visibleItems.find((item) => item.id === itemMenu.itemId) ??
      null)
    : null;

  return (
    <>
      {itemMenu && menuItem ? (
        <LibraryItemContextMenu
          {...menuActions(menuItem)}
          state={itemMenu}
          onClose={() => setItemMenu(null)}
        />
      ) : null}
      {filePickerOpen && canUploadLibrary ? (
        <MistyFilePicker
          mode="file"
          multiple
          title="Add files to this Space"
          onCancel={() => setFilePickerOpen(false)}
          onSelect={(path) => {
            setFilePickerOpen(false);
            void uploadFiles([path]);
          }}
          onSelectMany={(paths) => {
            setFilePickerOpen(false);
            void uploadFiles(paths);
          }}
        />
      ) : null}
      {selectedItemId ? (
        <SpaceLibraryViewer
          spaceId={spaceId}
          item={
            displayItems.find((item) => item.id === selectedItemId) ??
            items.find((item) => item.id === selectedItemId) ??
            null
          }
          items={displayItems}
          canEdit={canEditLibrary}
          canCopy
          returnFocusRef={libraryViewerTriggerRef}
          onCopyEdit={(definition) => setCopiedEditDefinition(structuredClone(definition))}
          onClose={() => setSelectedItemId("")}
          onSelect={setSelectedItemId}
          onUpdate={updateItem}
          onReplaceItem={replaceItem}
          onRenditionReady={() => setReloadKey((current) => current + 1)}
          onTrash={trashItem}
        />
      ) : null}
      <SpaceLibraryDialogs
        metadata={{
          action: metadataDialogAction,
          selectedCount: selectedItems.length,
          tags: metadataTags,
          date: metadataDate,
          locationName: metadataLocationName,
          latitude: metadataLatitude,
          longitude: metadataLongitude,
          saving: bulkSaving,
          setTags: setMetadataTags,
          setDate: setMetadataDate,
          setLocationName: setMetadataLocationName,
          setLatitude: setMetadataLatitude,
          setLongitude: setMetadataLongitude,
          close: () => setMetadataDialogAction(""),
          submit: (event) => void saveBulkMetadata(event),
        }}
        text={{
          state: textDialog,
          saving: textDialogSaving,
          error: textDialogError,
          setState: setTextDialog,
          close: () => setTextDialog(null),
          submit: (event) => void submitTextDialog(event),
        }}
      />
    </>
  );
}
