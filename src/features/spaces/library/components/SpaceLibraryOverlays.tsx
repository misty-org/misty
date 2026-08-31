import { MistyFilePicker } from "@/features/picker";
import { spacesApi } from "@/api/spaces/api";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryDialogs } from "../SpaceLibraryDialogs";
import { LibraryMemoryPlayback } from "../SpaceLibraryPlayback";
import { LibraryItemViewer } from "../SpaceLibraryViewer";
import { LibraryItemContextMenu } from "./LibraryItemContextMenu";

export function SpaceLibraryOverlays() {
  const { data, itemActions, collectionActions } = useSpaceLibraryContext();
  const {
    spaceId,
    canUploadLibrary,
    canImportLibrary,
    canEditLibrary,
    canCopyLibrary,
    items,
    setAlbums,
    visibleItems,
    displayItems,
    albums,
    collection,
    itemMenu,
    setItemMenu,
    filePickerOpen,
    setFilePickerOpen,
    selectedItemId,
    setSelectedItemId,
    libraryViewerTriggerRef,
    stackByItemID,
    sensitiveCollectionToken,
    memoryPlaybackOpen,
    setMemoryPlaybackOpen,
    currentDiscoveryGroup,
    localError,
    setLocalError,
    albumDialogMode,
    setAlbumDialogMode,
    albumName,
    setAlbumName,
    albumDescription,
    setAlbumDescription,
    albumCoverItemId,
    setAlbumCoverItemId,
    albumSaving,
    personDialogMode,
    setPersonDialogMode,
    personName,
    setPersonName,
    personKind,
    personCoverItemId,
    setPersonCoverItemId,
    personSaving,
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
    unlockScope,
    unlockPassword,
    setUnlockPassword,
    unlockSaving,
    closeSensitiveUnlock,
    setCopiedEditDefinition,
    setReloadKey,
    showTextDialog,
  } = data;
  const {
    uploadFiles,
    duplicateItems,
    copyItemsToClipboard,
    setAssetStackCover,
    setAssetStackEffect,
    ungroupAssetStack,
    updateItem,
    replaceItem,
    trashItem,
    restoreItem,
    saveBulkMetadata,
    submitSensitiveUnlock,
  } = itemActions;
  const { saveAlbum, savePerson, submitTextDialog } = collectionActions;
  const menuItem = itemMenu
    ? (items.find((item) => item.id === itemMenu.itemId) ??
      visibleItems.find((item) => item.id === itemMenu.itemId) ??
      null)
    : null;

  const addItemToAlbum = async (itemId: string, albumId: string) => {
    await spacesApi.addAlbumItems(spaceId, albumId, [itemId]);
    const result = await spacesApi.albums(spaceId);
    setAlbums(result.albums);
  };

  return (
    <>
      {itemMenu && menuItem ? (
        <LibraryItemContextMenu
          state={itemMenu}
          item={menuItem}
          albums={albums}
          canCopy={canCopyLibrary}
          canEdit={canEditLibrary}
          deleted={collection === "deleted"}
          onClose={() => setItemMenu(null)}
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
          onAddToAlbum={(albumId) =>
            void addItemToAlbum(menuItem.id, albumId).catch((error) =>
              setLocalError(
                error instanceof Error
                  ? error.message
                  : "The item could not be added to that album.",
              ),
            )
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
          allowRemoteFiles={canImportLibrary}
          onCancel={() => setFilePickerOpen(false)}
          onSelect={(path) => {
            setFilePickerOpen(false);
            void uploadFiles([path]);
          }}
          onSelectMany={(paths) => {
            setFilePickerOpen(false);
            void uploadFiles(paths);
          }}
          onSelectPreparedMany={(selection) => {
            setFilePickerOpen(false);
            const provenance = Object.fromEntries(
              selection.filter((item) => item.source).map((item) => [item.localPath, item.source!]),
            );
            void uploadFiles(
              selection.map((item) => item.localPath),
              provenance,
            );
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
          allItems={items}
          assetStack={stackByItemID.get(selectedItemId) ?? null}
          reauthenticationToken={sensitiveCollectionToken}
          canEdit={canEditLibrary}
          canCopy={canCopyLibrary}
          returnFocusRef={libraryViewerTriggerRef}
          onCopyEdit={(definition) => setCopiedEditDefinition(structuredClone(definition))}
          onSetStackCover={setAssetStackCover}
          onSetStackEffect={setAssetStackEffect}
          onUngroupStack={ungroupAssetStack}
          onClose={() => setSelectedItemId("")}
          onSelect={setSelectedItemId}
          onUpdate={updateItem}
          onReplaceItem={replaceItem}
          onRenditionReady={() => setReloadKey((current) => current + 1)}
          onTrash={trashItem}
        />
      ) : null}
      {memoryPlaybackOpen && currentDiscoveryGroup?.kind === "memory" ? (
        <LibraryMemoryPlayback
          spaceId={spaceId}
          group={currentDiscoveryGroup}
          items={visibleItems}
          onClose={() => setMemoryPlaybackOpen(false)}
        />
      ) : null}
      <SpaceLibraryDialogs
        album={{
          mode: albumDialogMode,
          name: albumName,
          description: albumDescription,
          coverItemId: albumCoverItemId,
          saving: albumSaving,
          items: visibleItems,
          setName: setAlbumName,
          setDescription: setAlbumDescription,
          setCoverItemId: setAlbumCoverItemId,
          close: () => setAlbumDialogMode(""),
          submit: (event) => void saveAlbum(event),
        }}
        person={{
          mode: personDialogMode,
          kind: personKind,
          name: personName,
          coverItemId: personCoverItemId,
          saving: personSaving,
          items: visibleItems,
          setName: setPersonName,
          setCoverItemId: setPersonCoverItemId,
          close: () => setPersonDialogMode(""),
          submit: (event) => void savePerson(event),
        }}
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
        unlock={{
          scope: unlockScope,
          password: unlockPassword,
          saving: unlockSaving,
          error: localError,
          setPassword: setUnlockPassword,
          close: closeSensitiveUnlock,
          submit: (event) => void submitSensitiveUnlock(event),
        }}
      />
    </>
  );
}
