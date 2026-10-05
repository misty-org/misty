import { LibraryPicker as MistyFilePicker } from "../LibraryRuntime";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryDialogs } from "../SpaceLibraryDialogs";
import { LibraryItemViewer } from "../SpaceLibraryViewer";
import { publicBetaFeatureEnabled } from "@/features/launch";
import { transcribeLibraryFile } from "@/features/voice";
import { libraryMediaKind } from "../libraryViewer/libraryMediaKind";
import { libraryItemMIME } from "../SpaceLibraryPrimitives";
import { LibraryItemContextMenu } from "./LibraryItemContextMenu";

export function SpaceLibraryOverlays() {
  const { data, itemActions, collectionActions } = useSpaceLibraryContext();
  const {
    spaceId,
    canUploadLibrary,
    canEditLibrary,
    items,
    visibleItems,
    displayItems,
    collection,
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
    showTextDialog,
  } = data;
  const {
    uploadFiles,
    duplicateItems,
    copyItemsToClipboard,
    updateItem,
    replaceItem,
    trashItem,
    restoreItem,
    saveBulkMetadata,
  } = itemActions;
  const { submitTextDialog } = collectionActions;
  const menuItem = itemMenu
    ? (items.find((item) => item.id === itemMenu.itemId) ??
      visibleItems.find((item) => item.id === itemMenu.itemId) ??
      null)
    : null;

  return (
    <>
      {itemMenu && menuItem ? (
        <LibraryItemContextMenu
          state={itemMenu}
          item={menuItem}
          canCopy
          canEdit={canEditLibrary}
          deleted={collection === "deleted"}
          onClose={() => setItemMenu(null)}
          onTranscribe={
            transcribable(menuItem)
              ? () => void transcribeLibraryFile(spaceId, menuItem.id, menuItem.display_name)
              : undefined
          }
          onCopy={() => void copyItemsToClipboard([menuItem])}
          onDuplicate={() => void duplicateItems([menuItem.id])}
          onRename={() =>
            showTextDialog({
              kind: "rename-item",
              title: "Rename Library item",
              primaryLabel: "Name",
              primaryValue: menuItem.display_name,
              itemId: menuItem.id,
            })
          }
          onEditTags={() =>
            showTextDialog({
              kind: "edit-tags",
              title: "Edit tags",
              primaryLabel: "Tags, separated by commas",
              primaryValue: menuItem.tags.join(", "),
              itemId: menuItem.id,
            })
          }
          onToggleFavorite={() => void updateItem(menuItem, { favorite: !menuItem.favorite })}
          onTrash={() => void trashItem(menuItem)}
          onRestore={() => void restoreItem(menuItem)}
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
        <LibraryItemViewer
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

/** Audio and video files can be transcribed once voice notes are on. */
function transcribable(item: Parameters<typeof libraryItemMIME>[0]) {
  if (!publicBetaFeatureEnabled("voiceNotes")) return false;
  const kind = libraryMediaKind(libraryItemMIME(item), item.file.intrinsic_metadata);
  return kind.isAudio || kind.isVideo;
}
