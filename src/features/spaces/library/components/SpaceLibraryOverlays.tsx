import { FilePickerDialog } from "../../apps/file-picker/FilePickerDialog";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryDialogs } from "../SpaceLibraryDialogs";
import { openLibraryItem, SpaceLibraryItemViewer } from "./SpaceLibraryItemViewer";
import { LibraryItemContextMenu } from "./LibraryItemContextMenu";
import { useLibraryItemMenuActions } from "./useLibraryItemMenuActions";

export function SpaceLibraryOverlays() {
  const { data, itemActions, collectionActions } = useSpaceLibraryContext();
  const {
    canUploadLibrary,
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
        <FilePickerDialog
          purpose="upload"
          spaceId={data.spaceId}
          multiple
          onCancel={() => setFilePickerOpen(false)}
          // The upload tray shows each file's progress, so the picker closes at once.
          onPick={({ projectFiles, otherFiles }) => {
            setFilePickerOpen(false);
            void uploadFiles([
              ...projectFiles.map((path) => ({ path, from: "project" as const })),
              ...otherFiles.map((path) => ({ path, from: "picked" as const })),
            ]);
          }}
        />
      ) : null}
      {opened ? <SpaceLibraryItemViewer item={opened} /> : null}
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
