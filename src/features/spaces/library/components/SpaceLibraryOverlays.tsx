import { MistyFilePicker } from "@/features/files";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryDialogs } from "../SpaceLibraryDialogs";
import { libraryItemOpensInEditor } from "../SpaceLibraryViewer";
import { openLibraryItem, SpaceLibraryItemViewer } from "./SpaceLibraryItemViewer";
import { LibraryItemContextMenu } from "./LibraryItemContextMenu";
import { useLibraryItemMenuActions } from "./useLibraryItemMenuActions";

export function SpaceLibraryOverlays() {
  const { data, itemActions, collectionActions } = useSpaceLibraryContext();
  const {
    canUploadLibrary,
    canEditLibrary,
    items,
    visibleItems,
    itemMenu,
    setItemMenu,
    filePickerOpen,
    setFilePickerOpen,
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
  } = data;
  const { uploadFiles, saveBulkMetadata } = itemActions;
  const { submitTextDialog } = collectionActions;
  const menuActions = useLibraryItemMenuActions();
  const opened = openLibraryItem(data);
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
      {/* Photos and videos open in their editors in the page itself (SpaceLibrary). */}
      {opened && !libraryItemOpensInEditor(opened, canEditLibrary) ? (
        <SpaceLibraryItemViewer item={opened} />
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
