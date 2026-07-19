import { Fragment, type MouseEvent as ReactMouseEvent } from "react";
import {
  Check,
  ClipboardCopy,
  Copy,
  EllipsisVertical,
  Folder,
  History,
  BookOpenText as LibraryIcon,
  MessagesSquare,
  Pencil,
  Play,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { MistyFilePicker } from "@/components/MistyFilePicker/MistyFilePicker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { spacesApi } from "@/spaces/api";

import { LibraryItemContextMenu } from "./components/LibraryItemContextMenu";
import { SpaceLibraryEmptyState, SpaceLibraryHeader } from "./components/SpaceLibraryChrome";
import { formatBytes, formatTime, libraryDateGroupLabel } from "./libraryFormat";
import { SpaceLibraryDialogs } from "./SpaceLibraryDialogs";
import { LibraryMemoryPlayback } from "./SpaceLibraryPlayback";
import {
  AlbumCover,
  LibraryCanEditContext,
  LibraryCollectionCard,
  LibraryDiscoveryCard,
  LibraryFacetGroup,
  LibraryItemThumbnail,
  LibraryMapView,
  LibrarySelect,
  libraryFileTypeLabel,
} from "./SpaceLibraryPrimitives";
import { LibraryItemViewer } from "./SpaceLibraryViewer";
import { useSpaceLibraryCollectionActions } from "./useSpaceLibraryCollectionActions";
import { useSpaceLibraryData } from "./useSpaceLibraryData";
import { useSpaceLibraryItemActions } from "./useSpaceLibraryItemActions";

export function SpaceLibrary({ spaceId }: { spaceId: string }) {
  const data = useSpaceLibraryData(spaceId);
  const {
    librarySearchParams, setLibrarySearchParams, requestedCollection, requestedCollectionId, activeSpace,
    canUploadLibrary, canEditLibrary, canCopyLibrary, items, setItems, visibleItems, setVisibleItems,
    usage, setUsage, assetStacks, setAssetStacks, albums, setAlbums, albumFolders, setAlbumFolders,
    selectedAlbumFolderId, setSelectedAlbumFolderId, groups, setGroups, people, setPeople, peoplePolicy,
    setPeoplePolicy, collection, setCollection, selectedCollectionId, setSelectedCollectionId, searchInput,
    setSearchInput, searchQuery, searchFocused, setSearchFocused, searchFacets, discovery, setDiscovery,
    sharedReferences, setSharedReferences, outgoingReferences, setOutgoingReferences, pins, setPins, importHistory,
    setImportHistory,
    memoryPlaybackOpen, setMemoryPlaybackOpen, memoryAudioItems, mediaType, setMediaType, libraryViewMode,
    setLibraryViewMode, sort, setSort, direction, setDirection, setReloadKey, nextAfter, setNextAfter,
    loadingMore, setLoadingMore, loading, uploadJobs, setUploadJobs, filePickerOpen, setFilePickerOpen,
    localError, setLocalError, selectedItemId, setSelectedItemId, libraryViewerTriggerRef, selectedItemIds,
    setSelectedItemIds, itemMenu, setItemMenu, bulkSaving, setBulkSaving, copiedEditDefinition,
    setCopiedEditDefinition, sensitiveGrants, setSensitiveGrants, unlockScope, setUnlockScope, unlockPassword,
    setUnlockPassword, unlockSaving, setUnlockSaving, metadataDialogAction, setMetadataDialogAction,
    metadataTags, setMetadataTags, metadataDate, setMetadataDate, metadataLocationName, setMetadataLocationName,
    metadataLatitude, setMetadataLatitude, metadataLongitude, setMetadataLongitude, albumDialogMode,
    setAlbumDialogMode, albumName, setAlbumName, albumDescription, setAlbumDescription, albumCoverItemId,
    setAlbumCoverItemId, albumSaving, setAlbumSaving, draggedAlbumItemId, setDraggedAlbumItemId,
    personDialogMode, setPersonDialogMode, personName, setPersonName, personKind, setPersonKind,
    personCoverItemId, setPersonCoverItemId, personSaving, setPersonSaving, textDialog, setTextDialog,
    textDialogSaving, setTextDialogSaving, textDialogError, setTextDialogError, displayItems, stackByItemID,
    selectedItems, currentAlbum, currentAlbumFolder, visibleAlbumFolders, visibleAlbumsForFolder, currentGroup,
    currentPerson, currentDiscoveryGroup, currentDateGroup, currentMapPoint, canReorderAlbum,
    sensitiveCollectionScope, sensitiveCollectionToken, libraryQuery, closeSensitiveUnlock, showTextDialog,
  } = data;

  const itemActions = useSpaceLibraryItemActions(data);
  const {
    loadMore, uploadFiles, createSelectedAssetStack, duplicateItems, copyItemsToClipboard,
    copySharedReferenceToClipboard, pasteEdits, setAssetStackCover, setAssetStackEffect,
    ungroupAssetStack, updateItem, replaceItem, trashItem, restoreItem, toggleSelectedItem,
    appendSearchFacet, applyBulkAction, openMetadataDialog, saveBulkMetadata, clearBulkMetadata,
    requestSensitiveUnlock, submitSensitiveUnlock,
  } = itemActions;
  const collectionActions = useSpaceLibraryCollectionActions(data, itemActions);
  const {
    mergeCurrentDuplicates, revokeSharedReference, selectCollection, isPinned, togglePin, movePin,
    updateCurrentMemory, pinnedDescriptor, openCreateAlbum, openEditAlbum, saveAlbum, createAlbumFolder,
    renameAlbumFolder, deleteAlbumFolder, deleteCurrentAlbum, reorderAlbumItem, togglePeoplePolicy,
    toggleIntelligencePolicy, openCreatePerson, openEditPerson, savePerson, deleteCurrentPerson,
    mergeCurrentPerson, applyPersonItems, createGroup, submitTextDialog,
  } = collectionActions;


  const uploading = uploadJobs.some((job) => !["ready", "failed"].includes(job.stage));
  const uploadProgress = uploadJobs.length > 0 ? Math.round(uploadJobs.reduce((total, job) => total + (job.stage === "ready" || job.stage === "failed" ? 1 : job.progress), 0) / uploadJobs.length * 100) : 0;
  const failedUploads = uploadJobs.filter((job) => job.stage === "failed");
  const menuItem = itemMenu ? items.find((item) => item.id === itemMenu.itemId) ?? visibleItems.find((item) => item.id === itemMenu.itemId) ?? null : null;
  const showItemMenu = (itemId: string, left: number, top: number) => {
    const menuWidth = 224;
    const menuHeight = 336;
    setItemMenu({
      itemId,
      left: Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8)),
    });
  };
  const openItemContextMenu = (event: ReactMouseEvent, itemId: string) => {
    event.preventDefault();
    event.stopPropagation();
    showItemMenu(itemId, event.clientX, event.clientY);
  };
  const addItemToAlbum = async (itemId: string, albumId: string) => {
    await spacesApi.addAlbumItems(spaceId, albumId, [itemId]);
    const result = await spacesApi.albums(spaceId);
    setAlbums(result.albums);
  };

  return (
    <LibraryCanEditContext.Provider value={canEditLibrary}>
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-transparent">
      <SpaceLibraryHeader uploadAvailable={canUploadLibrary} uploading={uploading} uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0} onUpload={() => setFilePickerOpen(true)} searchInput={searchInput} onSearchInput={setSearchInput} onSearchFocus={() => setSearchFocused(true)} onSearchBlur={() => window.setTimeout(() => setSearchFocused(false), 120)} mediaType={mediaType} onMediaType={(value) => setMediaType(value as typeof mediaType)} sort={sort} direction={direction} onSort={(nextSort, nextDirection) => { setSort(nextSort); setDirection(nextDirection); }} albumOrderAvailable={Boolean(currentAlbum)} viewMode={libraryViewMode} onViewMode={setLibraryViewMode} visibleItemCount={visibleItems.length}/>
      <div className="min-h-0 overflow-auto bg-transparent px-6 pb-6 pt-5">
        {uploadJobs.length > 0 ? <div className="mb-4 overflow-hidden rounded-xl bg-muted/35">
          <div className="flex items-center gap-3 px-3 py-2.5"><Upload className="shrink-0 text-muted-foreground" size={15}/><div className="min-w-0 flex-1"><p className="m-0 truncate text-xs font-medium">{uploading ? `Uploading ${uploadJobs.length} file${uploadJobs.length === 1 ? "" : "s"} in the background` : failedUploads.length > 0 ? `${uploadJobs.length - failedUploads.length} uploaded, ${failedUploads.length} failed` : `${uploadJobs.length} file${uploadJobs.length === 1 ? "" : "s"} uploaded`}</p><p className="m-0 mt-0.5 truncate text-[10px] text-muted-foreground">{uploading ? `${uploadProgress}% · You can keep using Misty while this finishes` : failedUploads[0]?.error ?? "Complete"}</p></div>{!uploading ? <Button size="icon" variant="outline" type="button" onClick={() => setUploadJobs([])} aria-label="Dismiss upload status"><X size={14}/></Button> : null}</div>
          <div className="h-0.5 bg-accent"><div className="h-full bg-primary transition-[width]" style={{ width: `${uploadProgress}%` }}/></div>
        </div> : null}
        {searchFocused && (searchFacets.tags.length > 0 || searchFacets.media_types.length > 0 || searchFacets.years.length > 0 || searchFacets.albums.length > 0 || searchFacets.utilities.length > 0) ? <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-muted/35 p-3" onMouseDown={(event) => event.preventDefault()}>
          {searchFacets.media_types.length > 0 ? <LibraryFacetGroup label="Media" facets={searchFacets.media_types} onSelect={(facet) => appendSearchFacet("type", facet.value)}/> : null}
          {searchFacets.tags.length > 0 ? <LibraryFacetGroup label="Tags" facets={searchFacets.tags} onSelect={(facet) => appendSearchFacet("tag", facet.value)}/> : null}
          {searchFacets.albums.length > 0 ? <LibraryFacetGroup label="Albums" facets={searchFacets.albums} onSelect={(facet) => appendSearchFacet("album", facet.label)}/> : null}
          {searchFacets.years.length > 0 ? <LibraryFacetGroup label="Years" facets={searchFacets.years} onSelect={(facet) => appendSearchFacet("year", facet.value)}/> : null}
          {searchFacets.utilities.length > 0 ? <LibraryFacetGroup label="Utilities" facets={searchFacets.utilities} onSelect={(facet) => selectCollection("utility", facet.value)}/> : null}
        </div> : null}
        {selectedItems.length > 0 ? <div className="mb-4 flex min-h-10 flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
          <span className="mr-1 text-xs font-medium">{selectedItems.length} selected</span>
          {canCopyLibrary && collection !== "deleted" ? <Button size="sm" variant="outline" type="button" disabled={bulkSaving} onClick={() => void copyItemsToClipboard(selectedItems)}><ClipboardCopy size={12}/>Copy</Button> : null}
          {canEditLibrary ? collection === "deleted" ? <Button size="sm" variant="outline" type="button" disabled={bulkSaving} onClick={() => void applyBulkAction("restore")}>Restore</Button> : <>
            <Button size="sm" variant="outline" type="button" disabled={bulkSaving} onClick={() => void applyBulkAction(collection === "favorites" ? "unfavorite" : "favorite")}><Star size={12}/>{collection === "favorites" ? "Unfavorite" : "Favorite"}</Button>
            {collection === "albums" && selectedCollectionId ? <Button size="sm" variant="outline" type="button" disabled={bulkSaving} onClick={() => void applyBulkAction("remove_from_album", { albumId: selectedCollectionId })}>Remove from album</Button> : null}
            <Button size="sm" variant="outline" type="button" disabled={bulkSaving} onClick={() => void applyBulkAction("trash")}><Trash2 size={12}/>Delete</Button>
          </> : null}
          <Button className="ml-auto grid size-7 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground" type="button" disabled={bulkSaving} onClick={() => setSelectedItemIds([])} aria-label="Clear selection"><X size={13}/></Button>
        </div> : null}
        {localError ? <Button className="mb-4 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-xs text-red-200" type="button" onClick={() => setLocalError("")}>{localError}</Button> : null}
        {(collection === "months" || collection === "years" || collection === "recent-days") && !selectedCollectionId ? <div className="mb-5"><div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">{(collection === "months" ? discovery.months : collection === "years" ? discovery.years : discovery.recent_days).map((group) => <LibraryDiscoveryCard key={`${group.kind}:${group.id}`} spaceId={spaceId} group={group} fallbackIcon={collection === "years" ? History : LibraryIcon} onClick={() => selectCollection(collection, group.id)}/>)}</div>{(collection === "months" ? discovery.months : collection === "years" ? discovery.years : discovery.recent_days).length === 0 ? <SpaceLibraryEmptyState collection={collection} uploadAvailable={canUploadLibrary} uploading={uploading} uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0} onUpload={() => setFilePickerOpen(true)}/> : null}</div> : null}
        {collection === "collections" ? <div className="grid gap-8">
          <section>
            <h4 className="mb-3 mt-0 text-sm">Recently Added</h4>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {displayItems.slice(0, 10).map((item) => <Button className="w-[180px] shrink-0 overflow-hidden rounded-xl border-0 bg-card p-0 text-left shadow-xs ring-1 ring-foreground/10 transition-colors hover:bg-accent" type="button" key={item.id} onClick={(event) => { libraryViewerTriggerRef.current = event.currentTarget; setSelectedItemId(item.id); }} aria-label={`Open ${item.display_name}`}><span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-muted text-muted-foreground"><LibraryItemThumbnail spaceId={spaceId} item={item} reauthenticationToken={sensitiveCollectionToken}/></span><span className="block p-3"><span className="block truncate text-xs font-medium text-foreground">{item.display_name}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))} · {formatTime(item.added_at)}</span></span></Button>)}
              {displayItems.length === 0 ? <p className="m-0 py-4 text-xs text-muted-foreground">No recently added items.</p> : null}
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between gap-3"><h4 className="m-0 text-sm">Albums</h4>{canEditLibrary ? <Button size="sm" variant="outline" type="button" onClick={openCreateAlbum}><Plus size={13}/>New album</Button> : null}</div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {albums.map((album) => <Button className="w-[180px] shrink-0 overflow-hidden rounded-xl border-0 bg-card p-0 text-left shadow-xs ring-1 ring-foreground/10 transition-colors hover:bg-accent" type="button" key={album.id} onClick={() => selectCollection("albums", album.id)}><AlbumCover spaceId={spaceId} itemId={album.cover_item_id}/><span className="block p-3"><span className="block truncate text-xs font-medium">{album.name}</span><span className="mt-1 block text-[10px] text-muted-foreground">{album.item_count} items</span></span></Button>)}
              {albums.length === 0 ? <p className="m-0 py-4 text-xs text-muted-foreground">No albums yet.</p> : null}
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between gap-3"><h4 className="m-0 text-sm">Groups</h4>{canEditLibrary ? <Button size="sm" variant="outline" type="button" onClick={() => void createGroup()}><Plus size={13}/>New smart group</Button> : null}</div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {groups.map((group) => <Button className="w-[180px] shrink-0 rounded-xl border-0 bg-card p-4 text-left shadow-xs ring-1 ring-foreground/10 transition-colors hover:bg-accent" type="button" key={group.id} onClick={() => selectCollection("groups", group.id)}><LibraryIcon size={22}/><span className="mb-0 mt-5 block truncate text-xs font-medium">{group.name}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{group.rules.all.length} rules</span></Button>)}
              {groups.length === 0 ? <p className="m-0 py-4 text-xs text-muted-foreground">No groups yet.</p> : null}
            </div>
          </section>
        </div> : null}
        {collection === "albums" && !selectedCollectionId ? <div className="mb-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2">{currentAlbumFolder ? <Button className="border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => setSelectedAlbumFolderId(currentAlbumFolder.parent_folder_id ?? "")}>←</Button> : null}<h4 className="m-0 text-sm">{currentAlbumFolder?.name ?? "Albums"}</h4></div>{canEditLibrary ? <div className="flex gap-2">{currentAlbumFolder ? <><Button size="sm" variant="outline" type="button" onClick={() => void renameAlbumFolder()}><Pencil size={12}/>Rename</Button><Button size="sm" variant="outline" type="button" onClick={() => void deleteAlbumFolder()}><Trash2 size={12}/>Delete</Button></> : null}<Button size="sm" variant="outline" type="button" onClick={() => void createAlbumFolder()}><Folder size={13}/>New folder</Button><Button size="sm" variant="outline" type="button" onClick={openCreateAlbum}><Plus size={13}/>New album</Button></div> : null}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{visibleAlbumFolders.map((folder) => <Button className="rounded-xl border-0 bg-card p-4 text-left shadow-xs ring-1 ring-foreground/10 hover:bg-accent" type="button" key={folder.id} onClick={() => setSelectedAlbumFolderId(folder.id)}><Folder size={26}/><p className="mb-0 mt-5 truncate text-xs font-medium">{folder.name}</p><p className="mb-0 mt-1 text-[10px] text-muted-foreground">{folder.album_count + folder.folder_count} items</p></Button>)}{visibleAlbumsForFolder.map((album) => <Button className="overflow-hidden rounded-xl border-0 bg-card p-0 text-left shadow-xs ring-1 ring-foreground/10 hover:bg-accent" type="button" key={album.id} onClick={() => selectCollection("albums", album.id)}><AlbumCover spaceId={spaceId} itemId={album.cover_item_id}/><div className="p-3"><p className="m-0 truncate text-xs font-medium">{album.name}</p><p className="mb-0 mt-1 text-[10px] text-muted-foreground">{album.item_count} items</p></div></Button>)}</div>
          {visibleAlbumFolders.length === 0 && visibleAlbumsForFolder.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">Nothing to see here...</div> : null}
        </div> : null}
        {collection === "groups" && !selectedCollectionId ? <div className="mb-5"><div className="mb-3 flex items-center justify-between"><h4 className="m-0 text-sm">Groups</h4>{canEditLibrary ? <Button size="sm" variant="outline" type="button" onClick={() => void createGroup()}><Plus size={13}/>New smart group</Button> : null}</div><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{groups.map((group) => <Button className="rounded-xl border-0 bg-card p-4 text-left shadow-xs ring-1 ring-foreground/10 hover:bg-accent" type="button" key={group.id} onClick={() => void selectCollection("groups", group.id)}><LibraryIcon size={22}/><p className="mb-0 mt-3 truncate text-xs font-medium">{group.name}</p><p className="mb-0 mt-1 truncate text-[10px] text-muted-foreground">{group.rules.all.length} rules</p></Button>)}</div></div> : null}
        {collection === "map" && !selectedCollectionId ? <LibraryMapView points={discovery.map_points} onBack={() => selectCollection("collections")} onSelect={(point) => selectCollection("map", point.id)}/> : null}
        {collection === "imports" ? <div className="mb-5"><Button className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => selectCollection("collections")}>← Collections</Button><div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">{importHistory.map((entry) => <article className="rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10" key={entry.id}><div className="flex items-center justify-between gap-3"><History size={20}/><span className="rounded-lg bg-muted px-2 py-1 text-[10px] capitalize text-muted-foreground">{entry.direction}</span></div><p className="mb-0 mt-3 truncate text-xs font-medium">{entry.display_name}</p><p className="mb-0 mt-1 truncate text-[10px] text-muted-foreground">{entry.direction === "incoming" ? "From" : "To"} {entry.counterpart_space_name}</p><p className="mb-0 mt-3 text-[10px] text-muted-foreground">{formatBytes(entry.logical_bytes)} · {formatTime(entry.completed_at ?? entry.created_at)} · {entry.state}</p></article>)}</div>{importHistory.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">Nothing to see here...</div> : null}</div> : null}
        {collection === "shared" ? <div className="mb-5"><Button className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => selectCollection("collections")}>← Collections</Button>{sharedReferences.length > 0 ? <section><h4 className="mb-3 mt-0 text-sm">Shared with this Space</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{sharedReferences.map((reference) => <article className="rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10" key={reference.id}><MessagesSquare size={20}/><p className="mb-0 mt-3 truncate text-xs font-medium">{reference.display_name}</p><p className="mb-3 mt-1 truncate text-[10px] text-muted-foreground">From {reference.source_space_name} · {formatBytes(reference.byte_size)}</p>{canCopyLibrary ? <Button size="sm" variant="outline" type="button" disabled={bulkSaving} onClick={() => void copySharedReferenceToClipboard(reference)}><ClipboardCopy size={12}/>Copy</Button> : null}</article>)}</div></section> : null}{outgoingReferences.length > 0 ? <section className="mt-7"><h4 className="mb-3 mt-0 text-sm">Shared by this Space</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{outgoingReferences.map((reference) => <article className="rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10" key={reference.id}><MessagesSquare size={20}/><p className="mb-0 mt-3 truncate text-xs font-medium">{reference.display_name}</p><p className="mb-3 mt-1 truncate text-[10px] text-muted-foreground">To {reference.destination_space_name}</p>{canEditLibrary ? <Button size="sm" variant="outline" type="button" onClick={() => void revokeSharedReference(reference)}><X size={12}/>Stop sharing</Button> : null}</article>)}</div></section> : null}{sharedReferences.length === 0 && outgoingReferences.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">Nothing to see here...</div> : null}</div> : null}
        {collection === "duplicate" && !selectedCollectionId ? <div className="mb-5"><Button className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => selectCollection("collections")}>← Collections</Button><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{discovery.duplicates.map((group, index) => <LibraryDiscoveryCard key={group.id} spaceId={spaceId} group={{ ...group, title: `Duplicates ${index + 1}` }} fallbackIcon={Copy} onClick={() => selectCollection("duplicate", group.id)}/>)}</div></div> : null}
        {collection === "people" && !selectedCollectionId && peoplePolicy ? <div className="mb-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h4 className="m-0 text-sm">People & Pets</h4>{canEditLibrary ? <div className="flex flex-wrap gap-2">{activeSpace?.role === "owner" ? <><Button size="sm" variant="outline" type="button" onClick={() => void togglePeoplePolicy("person")}>{peoplePolicy.faces_enabled ? "People on" : "People off"}</Button><Button size="sm" variant="outline" type="button" onClick={() => void togglePeoplePolicy("pet")}>{peoplePolicy.pets_enabled ? "Pets on" : "Pets off"}</Button></> : null}{peoplePolicy.faces_enabled ? <Button size="sm" variant="outline" type="button" onClick={() => openCreatePerson("person")}><Plus size={13}/>Person</Button> : null}{peoplePolicy.pets_enabled ? <Button size="sm" variant="outline" type="button" onClick={() => openCreatePerson("pet")}><Plus size={13}/>Pet</Button> : null}</div> : null}</div><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{people.map((person) => <Button className="overflow-hidden rounded-xl border-0 bg-card p-0 text-left shadow-xs ring-1 ring-foreground/10 hover:bg-accent" type="button" key={person.id} onClick={() => selectCollection("people", person.id)}><AlbumCover spaceId={spaceId} itemId={person.cover_item_id}/><div className="p-3"><p className="m-0 truncate text-xs font-medium">{person.name || (person.kind === "pet" ? "Unnamed pet" : "Unnamed person")}</p><p className="mb-0 mt-1 text-[10px] text-muted-foreground">{person.item_count} items · {person.kind === "pet" ? "Pet" : "Person"}</p></div></Button>)}</div>{people.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">Nothing to see here...</div> : null}</div> : null}
        {currentDateGroup ? <div className="mb-4"><Button className="border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => selectCollection(collection)}>← {collection === "recent-days" ? "Recent Days" : collection === "months" ? "Months" : "Years"}</Button><h4 className="mb-0 mt-2 text-sm">{currentDateGroup.title}</h4><p className="mb-0 mt-1 text-xs text-muted-foreground">{currentDateGroup.subtitle}</p></div> : null}
        {currentPerson ? <div className="mb-4 flex items-center justify-between gap-3"><div><Button className="border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => selectCollection("people")}>← People & Pets</Button><h4 className="mb-0 mt-2 text-sm">{currentPerson.name || (currentPerson.kind === "pet" ? "Unnamed pet" : "Unnamed person")}</h4></div>{canEditLibrary ? <div className="flex flex-wrap gap-2"><LibrarySelect className="h-8 w-40" value="" onChange={(value) => { if (value) void mergeCurrentPerson(value); }} label="Merge this identity" options={[["","Merge into…"],...people.filter((person) => person.id !== currentPerson.id && person.kind === currentPerson.kind).map((person) => [person.id,person.name || "Unnamed"] as [string,string])]}/><Button size="sm" variant="outline" type="button" onClick={openEditPerson}><Pencil size={12}/>Edit</Button><Button size="sm" variant="outline" type="button" onClick={() => void deleteCurrentPerson()}><Trash2 size={12}/>Remove</Button></div> : null}</div> : currentAlbum ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><Button className="border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => { setSelectedAlbumFolderId(currentAlbum.folder_id ?? ""); selectCollection("albums"); }}>← Albums</Button><h4 className="mb-0 mt-2 text-sm">{currentAlbum.name}</h4>{currentAlbum.description ? <p className="mb-0 mt-1 text-xs text-muted-foreground">{currentAlbum.description}</p> : null}</div>{canEditLibrary ? <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" aria-label="Album actions"><EllipsisVertical size={15}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={openEditAlbum}><Pencil size={13}/>Edit album</DropdownMenuItem><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void deleteCurrentAlbum()}><Trash2 size={13}/>Delete album</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</div> : currentMapPoint ? <div className="mb-4"><Button className="border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => selectCollection("map")}>← Map</Button><h4 className="mb-0 mt-2 text-sm">{currentMapPoint.name}</h4><p className="mb-0 mt-1 text-xs text-muted-foreground">{currentMapPoint.latitude.toFixed(2)}, {currentMapPoint.longitude.toFixed(2)}</p></div> : currentDiscoveryGroup ? <div className="mb-4 flex items-end justify-between gap-3"><div><Button className="border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => selectCollection(currentDiscoveryGroup.kind === "duplicate" ? "duplicate" : "collections")}>← {currentDiscoveryGroup.kind === "duplicate" ? "Duplicates" : "Collections"}</Button><h4 className="mb-0 mt-2 text-sm">{currentDiscoveryGroup.title}</h4><p className="mb-0 mt-1 text-xs text-muted-foreground">{currentDiscoveryGroup.subtitle}</p></div><div className="flex gap-2">{currentDiscoveryGroup.kind === "memory" && visibleItems.length > 0 ? <Button size="sm" type="button" onClick={() => setMemoryPlaybackOpen(true)}><Play size={13}/>Play memory</Button> : null}{canEditLibrary && currentDiscoveryGroup.kind === "duplicate" ? <Button size="sm" type="button" disabled={bulkSaving || visibleItems.length < 2} onClick={() => void mergeCurrentDuplicates()}>{bulkSaving ? "Merging…" : "Merge"}</Button> : null}</div></div> : selectedCollectionId && !currentDateGroup ? <Button className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground" type="button" onClick={() => selectCollection("collections")}>← Collections</Button> : null}
        {canEditLibrary && currentDiscoveryGroup?.kind === "memory" ? <div className="mb-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" type="button" onClick={() => showTextDialog({ kind: "rename-memory", title: "Rename memory", primaryLabel: "Memory title", primaryValue: currentDiscoveryGroup.title })}><Pencil size={12}/>Rename</Button><LibrarySelect className="h-8 w-40" value={currentDiscoveryGroup.cover_item_id ?? ""} onChange={(value) => void updateCurrentMemory({ cover_item_id: value })} label="Choose memory key photo" options={[["","Automatic"],...visibleItems.map((candidate) => [candidate.id,candidate.display_name] as [string,string])]}/><LibrarySelect className="h-8 w-40" value={currentDiscoveryGroup.music_item_id ?? ""} onChange={(value) => void updateCurrentMemory({ music_item_id: value })} label="Choose memory music" options={[["","No music"],...memoryAudioItems.map((candidate) => [candidate.id,candidate.display_name] as [string,string])]}/><LibrarySelect className="h-8 w-40" value={String(currentDiscoveryGroup.playback_seconds ?? 4.5)} onChange={(value) => void updateCurrentMemory({ playback_seconds: Number(value) })} label="Choose memory pace" options={[["2","Fast"],["4.5","Medium"],["7","Slow"]]}/></div> : null}
        {loading ? <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">Loading Library…</div> : collection === "collections" || collection === "shared" || collection === "imports" || (collection === "recent-days" || collection === "months" || collection === "years" || collection === "people" || collection === "albums" || collection === "groups" || collection === "duplicate" || collection === "map") && !selectedCollectionId ? null : sensitiveCollectionScope && !sensitiveCollectionToken ? <div className="grid min-h-64 place-items-center"><Button size="sm" type="button" onClick={() => requestSensitiveUnlock(sensitiveCollectionScope)}>Unlock {collection === "hidden" ? "Hidden" : "Recently Deleted"}</Button></div> : displayItems.length === 0 ? (
          <SpaceLibraryEmptyState collection={collection} searching={Boolean(searchQuery || mediaType)} uploadAvailable={canUploadLibrary} uploading={uploading} uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0} onUpload={() => setFilePickerOpen(true)} onClearSearch={() => { setSearchInput(""); setMediaType(""); }}/>
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: libraryViewMode === "list" ? "1fr" : "repeat(auto-fill,minmax(270px,1fr))" }}>
            {displayItems.map((item, itemIndex) => {
              const dateGroup = libraryDateGroupLabel(item, sort);
              const previousDateGroup = itemIndex > 0 ? libraryDateGroupLabel(displayItems[itemIndex - 1], sort) : "";
              const assetStack = stackByItemID.get(item.id);
              const listLayout = libraryViewMode === "list";
              return <Fragment key={item.id}>
              {dateGroup && dateGroup !== previousDateGroup ? <h4 className="col-span-full mb-0 mt-3 text-xs font-semibold text-muted-foreground first:mt-0">{dateGroup}</h4> : null}
              <article className={`group relative min-w-0 rounded-xl bg-card p-2 shadow-xs transition-[background-color,box-shadow] hover:bg-accent ${listLayout ? "grid grid-cols-[132px_minmax(0,1fr)] items-center gap-3" : ""} ${selectedItemIds.includes(item.id) ? "ring-2 ring-primary" : "ring-1 ring-foreground/10"}`} draggable={canReorderAlbum && selectedItemIds.length === 0} onContextMenu={(event) => openItemContextMenu(event, item.id)} onDragStart={() => setDraggedAlbumItemId(item.id)} onDragEnd={() => setDraggedAlbumItemId("")} onDragOver={(event) => { if (canReorderAlbum) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); void reorderAlbumItem(item.id); }}>
              <div className="relative min-w-0"><Button className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg border-0 bg-muted text-muted-foreground" type="button" onClick={(event) => { libraryViewerTriggerRef.current = event.currentTarget; setSelectedItemId(item.id); }} aria-label={`Open ${item.display_name}`}><LibraryItemThumbnail spaceId={spaceId} item={item} reauthenticationToken={sensitiveCollectionToken}/>{assetStack ? <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-1 text-[9px] font-semibold capitalize text-white">{assetStack.kind === "live_photo" ? "Live" : assetStack.kind === "raw_pair" ? "RAW+" : `${assetStack.members.length} burst`}</span> : null}</Button>{canEditLibrary || canCopyLibrary ? <Button className={`absolute right-2 top-2 z-10 grid size-5 place-items-center rounded-md border shadow-xs transition-opacity ${selectedItemIds.includes(item.id) ? "border-primary bg-primary text-primary-foreground opacity-100" : "pointer-events-none border-white/50 bg-black/55 text-transparent opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"}`} type="button" aria-label={`${selectedItemIds.includes(item.id) ? "Deselect" : "Select"} ${item.display_name}`} aria-pressed={selectedItemIds.includes(item.id)} onClick={(event) => { event.stopPropagation(); toggleSelectedItem(item.id); }}><Check size={12}/></Button> : null}</div>
              <div className={`${listLayout ? "min-w-0 py-1 pr-1" : "px-1 pb-1 pt-2.5"}`}>
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1"><p className="m-0 truncate text-xs font-semibold text-foreground" title={item.display_name}>{item.display_name}</p><p className="m-0 mt-1 truncate text-[10px] text-muted-foreground">{formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))} · {formatTime(item.added_at)}</p></div>
                  {canEditLibrary || canCopyLibrary ? <div className={`flex shrink-0 items-center gap-0.5 transition-opacity ${itemMenu?.itemId === item.id ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"}`} aria-label={`Actions for ${item.display_name}`}>
                    {canEditLibrary ? <Button className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground" type="button" onClick={() => void updateItem(item, { favorite: !item.favorite })} title={item.favorite ? "Remove favorite" : "Favorite"} aria-label={`${item.favorite ? "Remove from favorites" : "Add to favorites"}: ${item.display_name}`}><Star size={14} fill={item.favorite ? "currentColor" : "none"}/></Button> : null}
                    <Button className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground" type="button" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); showItemMenu(item.id, rect.right - 224, rect.bottom + 4); }} aria-label={`More actions for ${item.display_name}`} aria-haspopup="menu"><EllipsisVertical size={15}/></Button>
                  </div> : null}
                </div>
                <dl className={`${listLayout ? "mt-3 grid grid-cols-3 gap-x-4" : "mt-3 grid gap-1.5"} text-[10px] leading-4`}>
                  <div className={listLayout ? "min-w-0" : "flex items-center justify-between gap-3"}><dt className="text-muted-foreground">Size</dt><dd className="m-0 truncate text-muted-foreground">{formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))}</dd></div>
                  <div className={listLayout ? "min-w-0" : "flex items-center justify-between gap-3"}><dt className="text-muted-foreground">Date</dt><dd className="m-0 truncate text-muted-foreground">{formatTime(item.added_at)}</dd></div>
                  <div className={listLayout ? "min-w-0" : "flex items-center justify-between gap-3"}><dt className="text-muted-foreground">File type</dt><dd className="m-0 truncate text-muted-foreground">{libraryFileTypeLabel(item)}</dd></div>
                </dl>
              </div>
              </article>
              </Fragment>;
            })}
            {nextAfter ? <div className="col-span-full grid place-items-center pt-3"><Button size="sm" variant="outline" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</Button></div> : null}
          </div>
        )}
      </div>
      {itemMenu && menuItem ? <LibraryItemContextMenu
        state={itemMenu}
        item={menuItem}
        albums={albums}
        canCopy={canCopyLibrary}
        canEdit={canEditLibrary}
        deleted={collection === "deleted"}
        onClose={() => setItemMenu(null)}
        onCopy={() => void copyItemsToClipboard([menuItem])}
        onDuplicate={() => void duplicateItems([menuItem.id])}
        onRename={() => showTextDialog({ kind: "rename-item", title: "Rename Library item", primaryLabel: "Name", primaryValue: menuItem.display_name, itemId: menuItem.id })}
        onEditTags={() => showTextDialog({ kind: "edit-tags", title: "Edit tags", primaryLabel: "Tags, separated by commas", primaryValue: menuItem.tags.join(", "), itemId: menuItem.id })}
        onAddToAlbum={(albumId) => void addItemToAlbum(menuItem.id, albumId).catch((error) => setLocalError(error instanceof Error ? error.message : "The item could not be added to that album."))}
        onToggleFavorite={() => void updateItem(menuItem, { favorite: !menuItem.favorite })}
        onTrash={() => void trashItem(menuItem)}
        onRestore={() => void restoreItem(menuItem)}
      /> : null}
      {filePickerOpen && canUploadLibrary ? <MistyFilePicker mode="file" multiple title="Add files to this Space" onCancel={() => setFilePickerOpen(false)} onSelect={(path) => { setFilePickerOpen(false); void uploadFiles([path]); }} onSelectMany={(paths) => { setFilePickerOpen(false); void uploadFiles(paths); }}/> : null}
      {selectedItemId ? <LibraryItemViewer spaceId={spaceId} item={displayItems.find((item) => item.id === selectedItemId) ?? items.find((item) => item.id === selectedItemId) ?? null} items={displayItems} allItems={items} assetStack={stackByItemID.get(selectedItemId) ?? null} reauthenticationToken={sensitiveCollectionToken} canEdit={canEditLibrary} canCopy={canCopyLibrary} returnFocusRef={libraryViewerTriggerRef} onCopyEdit={(definition) => setCopiedEditDefinition(structuredClone(definition))} onSetStackCover={setAssetStackCover} onSetStackEffect={setAssetStackEffect} onUngroupStack={ungroupAssetStack} onClose={() => setSelectedItemId("")} onSelect={setSelectedItemId} onUpdate={updateItem} onReplaceItem={replaceItem} onRenditionReady={() => setReloadKey((current) => current + 1)} onTrash={trashItem}/> : null}
      {memoryPlaybackOpen && currentDiscoveryGroup?.kind === "memory" ? <LibraryMemoryPlayback spaceId={spaceId} group={currentDiscoveryGroup} items={visibleItems} onClose={() => setMemoryPlaybackOpen(false)}/> : null}
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
    </div>
    </LibraryCanEditContext.Provider>
  );
}
