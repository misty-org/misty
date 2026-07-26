import {
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
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui";
import { Skeleton } from "@/ui";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";

import { SpaceLibraryCollectionOverview } from "./components/SpaceLibraryCollections";
import { SpaceLibraryOverlays } from "./components/SpaceLibraryOverlays";
import { SpaceLibraryEmptyState } from "./components/SpaceLibraryChrome";
import { SpaceLibraryItems } from "./components/SpaceLibraryItems";
import { SpaceLibraryTopChrome } from "./components/SpaceLibraryStatus";
import { formatBytes, formatTime } from "./libraryFormat";
import {
  AlbumCover,
  LibraryCanEditContext,
  LibraryCollectionCard,
  LibraryDiscoveryCard,
  LibraryMapView,
  LibrarySelect,
} from "./SpaceLibraryPrimitives";
import { SpaceLibraryProvider } from "./SpaceLibraryContext";
import { useSpaceLibraryCollectionActions } from "./useSpaceLibraryCollectionActions";
import { useSpaceLibraryData } from "./useSpaceLibraryData";
import { useSpaceLibraryItemActions } from "./useSpaceLibraryItemActions";

const libraryItemSkeletonCount = Array.from({ length: 10 }, (_, index) => index);

export function SpaceLibrary({ spaceId }: { spaceId: string }) {
  const data = useSpaceLibraryData(spaceId);
  const {
    activeSpace,
    canUploadLibrary,
    canEditLibrary,
    canCopyLibrary,
    visibleItems,
    usage,
    setSelectedAlbumFolderId,
    peoplePolicy,
    collection,
    selectedCollectionId,
    setSearchInput,
    searchQuery,
    discovery,
    sharedReferences,
    outgoingReferences,
    importHistory,
    setMemoryPlaybackOpen,
    memoryAudioItems,
    mediaType,
    setMediaType,
    loading,
    uploadJobs,
    setFilePickerOpen,
    bulkSaving,
    displayItems,
    currentAlbum,
    currentAlbumFolder,
    visibleAlbumFolders,
    visibleAlbumsForFolder,
    currentDiscoveryGroup,
    currentDateGroup,
    currentMapPoint,
    sensitiveCollectionScope,
    sensitiveCollectionToken,
    showTextDialog,
  } = data;

  const itemActions = useSpaceLibraryItemActions(data);
  const { copySharedReferenceToClipboard, requestSensitiveUnlock } = itemActions;
  const collectionActions = useSpaceLibraryCollectionActions(data, itemActions);
  const {
    mergeCurrentDuplicates,
    revokeSharedReference,
    selectCollection,
    updateCurrentMemory,
    openCreateAlbum,
    openEditAlbum,
    createAlbumFolder,
    renameAlbumFolder,
    deleteAlbumFolder,
    deleteCurrentAlbum,
    toggleIntelligencePolicy,
  } = collectionActions;

  const uploading = uploadJobs.some((job) => !["ready", "failed"].includes(job.stage));
  const [librarySkeletonVisible] = useMinimumSpin(loading);
  return (
    <SpaceLibraryProvider value={{ data, itemActions, collectionActions }}>
      <LibraryCanEditContext.Provider value={canEditLibrary}>
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-transparent">
          <SpaceLibraryTopChrome />
          <div className="min-h-0 overflow-auto bg-transparent px-6 pb-6 pt-5">
            {collection === "smart" && peoplePolicy ? (
              <section className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card/70 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <h2 className="m-0 text-sm font-semibold">Smart Library</h2>
                    <p className="mb-0 mt-1 max-w-xl text-xs text-muted-foreground">
                      Search this Space by meaning and use generated captions and tags. Analysis
                      pauses at the weekly Hosted AI limit without blocking uploads.
                    </p>
                    <p className="mb-0 mt-2 text-[11px] text-muted-foreground">
                      {peoplePolicy.ai_enabled
                        ? peoplePolicy.queued_ai_jobs > 0
                          ? `${peoplePolicy.queued_ai_jobs} item${peoplePolicy.queued_ai_jobs === 1 ? "" : "s"} queued for analysis`
                          : "Analysis is on and up to date"
                        : "Analysis is off"}
                    </p>
                  </div>
                </div>
                {activeSpace?.role === "owner" ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={peoplePolicy.ai_enabled ? "secondary" : "default"}
                      onClick={() => void toggleIntelligencePolicy("ai")}
                    >
                      {peoplePolicy.ai_enabled ? "Turn off" : "Enable Smart Library"}
                    </Button>
                    {peoplePolicy.ai_enabled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void toggleIntelligencePolicy("semantic")}
                      >
                        {peoplePolicy.semantic_search_enabled
                          ? "Semantic search on"
                          : "Enable semantic search"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
            {(collection === "months" || collection === "years" || collection === "recent-days") &&
            !selectedCollectionId ? (
              <div className="mb-5">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                  {(collection === "months"
                    ? discovery.months
                    : collection === "years"
                      ? discovery.years
                      : discovery.recent_days
                  ).map((group) => (
                    <LibraryDiscoveryCard
                      key={`${group.kind}:${group.id}`}
                      spaceId={spaceId}
                      group={group}
                      fallbackIcon={collection === "years" ? History : LibraryIcon}
                      onClick={() => selectCollection(collection, group.id)}
                    />
                  ))}
                </div>
                {(collection === "months"
                  ? discovery.months
                  : collection === "years"
                    ? discovery.years
                    : discovery.recent_days
                ).length === 0 ? (
                  <SpaceLibraryEmptyState
                    collection={collection}
                    uploadAvailable={canUploadLibrary}
                    uploading={uploading}
                    uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0}
                    onUpload={() => setFilePickerOpen(true)}
                  />
                ) : null}
              </div>
            ) : null}
            {collection === "collections" ? <SpaceLibraryCollectionOverview /> : null}
            {collection === "albums" && !selectedCollectionId ? (
              <div className="mb-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {currentAlbumFolder ? (
                      <Button
                        className="border-0 bg-transparent p-0 text-xs text-muted-foreground"
                        type="button"
                        onClick={() =>
                          setSelectedAlbumFolderId(currentAlbumFolder.parent_folder_id ?? "")
                        }
                      >
                        ←
                      </Button>
                    ) : null}
                    <h4 className="m-0 text-sm">{currentAlbumFolder?.name ?? "Albums"}</h4>
                  </div>
                  {canEditLibrary ? (
                    <div className="flex gap-2">
                      {currentAlbumFolder ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() => void renameAlbumFolder()}
                          >
                            <Pencil size={12} />
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() => void deleteAlbumFolder()}
                          >
                            <Trash2 size={12} />
                            Delete
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => void createAlbumFolder()}
                      >
                        <Folder size={13} />
                        New folder
                      </Button>
                      <Button size="sm" variant="outline" type="button" onClick={openCreateAlbum}>
                        <Plus size={13} />
                        New album
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {visibleAlbumFolders.map((folder) => (
                    <Button
                      className="rounded-xl border-0 bg-card p-4 text-left shadow-xs inset-ring-1 inset-ring-foreground/10 hover:bg-accent"
                      type="button"
                      key={folder.id}
                      onClick={() => setSelectedAlbumFolderId(folder.id)}
                    >
                      <Folder size={26} />
                      <p className="mb-0 mt-5 truncate text-xs font-medium">{folder.name}</p>
                      <p className="mb-0 mt-1 text-[10px] text-muted-foreground">
                        {folder.album_count + folder.folder_count} items
                      </p>
                    </Button>
                  ))}
                  {visibleAlbumsForFolder.map((album) => (
                    <Button
                      className="overflow-hidden rounded-xl border-0 bg-card p-0 text-left shadow-xs inset-ring-1 inset-ring-foreground/10 hover:bg-accent"
                      type="button"
                      key={album.id}
                      onClick={() => selectCollection("albums", album.id)}
                    >
                      <AlbumCover spaceId={spaceId} itemId={album.cover_item_id} />
                      <div className="p-3">
                        <p className="m-0 truncate text-xs font-medium">{album.name}</p>
                        <p className="mb-0 mt-1 text-[10px] text-muted-foreground">
                          {album.item_count} items
                        </p>
                      </div>
                    </Button>
                  ))}
                </div>
                {visibleAlbumFolders.length === 0 && visibleAlbumsForFolder.length === 0 ? (
                  <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
                    Nothing to see here...
                  </div>
                ) : null}
              </div>
            ) : null}
            {collection === "map" && !selectedCollectionId ? (
              <LibraryMapView
                points={discovery.map_points}
                onBack={() => selectCollection("collections")}
                onSelect={(point) => selectCollection("map", point.id)}
              />
            ) : null}
            {collection === "imports" ? (
              <div className="mb-5">
                <Button
                  className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground"
                  type="button"
                  onClick={() => selectCollection("collections")}
                >
                  ← Collections
                </Button>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {importHistory.map((entry) => (
                    <article
                      className="rounded-xl bg-card p-4 shadow-xs inset-ring-1 inset-ring-foreground/10"
                      key={entry.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <History size={20} />
                        <span className="rounded-lg bg-muted px-2 py-1 text-[10px] capitalize text-muted-foreground">
                          {entry.direction}
                        </span>
                      </div>
                      <p className="mb-0 mt-3 truncate text-xs font-medium">{entry.display_name}</p>
                      <p className="mb-0 mt-1 truncate text-[10px] text-muted-foreground">
                        {entry.direction === "incoming" ? "From" : "To"}{" "}
                        {entry.counterpart_space_name}
                      </p>
                      <p className="mb-0 mt-3 text-[10px] text-muted-foreground">
                        {formatBytes(entry.logical_bytes)} ·{" "}
                        {formatTime(entry.completed_at ?? entry.created_at)} · {entry.state}
                      </p>
                    </article>
                  ))}
                </div>
                {importHistory.length === 0 ? (
                  <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
                    Nothing to see here...
                  </div>
                ) : null}
              </div>
            ) : null}
            {collection === "shared" ? (
              <div className="mb-5">
                <Button
                  className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground"
                  type="button"
                  onClick={() => selectCollection("collections")}
                >
                  ← Collections
                </Button>
                {sharedReferences.length > 0 ? (
                  <section>
                    <h4 className="mb-3 mt-0 text-sm">Shared with this Space</h4>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
                      {sharedReferences.map((reference) => (
                        <article
                          className="rounded-xl bg-card p-4 shadow-xs inset-ring-1 inset-ring-foreground/10"
                          key={reference.id}
                        >
                          <MessagesSquare size={20} />
                          <p className="mb-0 mt-3 truncate text-xs font-medium">
                            {reference.display_name}
                          </p>
                          <p className="mb-3 mt-1 truncate text-[10px] text-muted-foreground">
                            From {reference.source_space_name} · {formatBytes(reference.byte_size)}
                          </p>
                          {canCopyLibrary ? (
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              disabled={bulkSaving}
                              onClick={() => void copySharedReferenceToClipboard(reference)}
                            >
                              <ClipboardCopy size={12} />
                              Copy
                            </Button>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
                {outgoingReferences.length > 0 ? (
                  <section className="mt-7">
                    <h4 className="mb-3 mt-0 text-sm">Shared by this Space</h4>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
                      {outgoingReferences.map((reference) => (
                        <article
                          className="rounded-xl bg-card p-4 shadow-xs inset-ring-1 inset-ring-foreground/10"
                          key={reference.id}
                        >
                          <MessagesSquare size={20} />
                          <p className="mb-0 mt-3 truncate text-xs font-medium">
                            {reference.display_name}
                          </p>
                          <p className="mb-3 mt-1 truncate text-[10px] text-muted-foreground">
                            To {reference.destination_space_name}
                          </p>
                          {canEditLibrary ? (
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => void revokeSharedReference(reference)}
                            >
                              <X size={12} />
                              Stop sharing
                            </Button>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
                {sharedReferences.length === 0 && outgoingReferences.length === 0 ? (
                  <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
                    Nothing to see here...
                  </div>
                ) : null}
              </div>
            ) : null}
            {collection === "duplicate" && !selectedCollectionId ? (
              <div className="mb-5">
                <Button
                  className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground"
                  type="button"
                  onClick={() => selectCollection("collections")}
                >
                  ← Collections
                </Button>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {discovery.duplicates.map((group, index) => (
                    <LibraryDiscoveryCard
                      key={group.id}
                      spaceId={spaceId}
                      group={{ ...group, title: `Duplicates ${index + 1}` }}
                      fallbackIcon={Copy}
                      onClick={() => selectCollection("duplicate", group.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {currentDateGroup ? (
              <div className="mb-4">
                <Button
                  className="border-0 bg-transparent p-0 text-xs text-muted-foreground"
                  type="button"
                  onClick={() => selectCollection(collection)}
                >
                  ←{" "}
                  {collection === "recent-days"
                    ? "Recent Days"
                    : collection === "months"
                      ? "Months"
                      : "Years"}
                </Button>
                <h4 className="mb-0 mt-2 text-sm">{currentDateGroup.title}</h4>
                <p className="mb-0 mt-1 text-xs text-muted-foreground">
                  {currentDateGroup.subtitle}
                </p>
              </div>
            ) : null}
            {currentAlbum ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Button
                    className="border-0 bg-transparent p-0 text-xs text-muted-foreground"
                    type="button"
                    onClick={() => {
                      setSelectedAlbumFolderId(currentAlbum.folder_id ?? "");
                      selectCollection("albums");
                    }}
                  >
                    ← Albums
                  </Button>
                  <h4 className="mb-0 mt-2 text-sm">{currentAlbum.name}</h4>
                  {currentAlbum.description ? (
                    <p className="mb-0 mt-1 text-xs text-muted-foreground">
                      {currentAlbum.description}
                    </p>
                  ) : null}
                </div>
                {canEditLibrary ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="outline" aria-label="Album actions">
                        <EllipsisVertical size={15} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={openEditAlbum}>
                        <Pencil size={13} />
                        Edit album
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => void deleteCurrentAlbum()}
                      >
                        <Trash2 size={13} />
                        Delete album
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ) : currentMapPoint ? (
              <div className="mb-4">
                <Button
                  className="border-0 bg-transparent p-0 text-xs text-muted-foreground"
                  type="button"
                  onClick={() => selectCollection("map")}
                >
                  ← Map
                </Button>
                <h4 className="mb-0 mt-2 text-sm">{currentMapPoint.name}</h4>
                <p className="mb-0 mt-1 text-xs text-muted-foreground">
                  {currentMapPoint.latitude.toFixed(2)}, {currentMapPoint.longitude.toFixed(2)}
                </p>
              </div>
            ) : currentDiscoveryGroup ? (
              <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                  <Button
                    className="border-0 bg-transparent p-0 text-xs text-muted-foreground"
                    type="button"
                    onClick={() =>
                      selectCollection(
                        currentDiscoveryGroup.kind === "duplicate" ? "duplicate" : "collections",
                      )
                    }
                  >
                    ← {currentDiscoveryGroup.kind === "duplicate" ? "Duplicates" : "Collections"}
                  </Button>
                  <h4 className="mb-0 mt-2 text-sm">{currentDiscoveryGroup.title}</h4>
                  <p className="mb-0 mt-1 text-xs text-muted-foreground">
                    {currentDiscoveryGroup.subtitle}
                  </p>
                </div>
                <div className="flex gap-2">
                  {currentDiscoveryGroup.kind === "memory" && visibleItems.length > 0 ? (
                    <Button size="sm" type="button" onClick={() => setMemoryPlaybackOpen(true)}>
                      <Play size={13} />
                      Play memory
                    </Button>
                  ) : null}
                  {canEditLibrary && currentDiscoveryGroup.kind === "duplicate" ? (
                    <Button
                      size="sm"
                      type="button"
                      disabled={bulkSaving || visibleItems.length < 2}
                      onClick={() => void mergeCurrentDuplicates()}
                    >
                      {bulkSaving ? "Merging…" : "Merge"}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : selectedCollectionId && !currentDateGroup ? (
              <Button
                className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground"
                type="button"
                onClick={() => selectCollection("collections")}
              >
                ← Collections
              </Button>
            ) : null}
            {canEditLibrary && currentDiscoveryGroup?.kind === "memory" ? (
              <div className="mb-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    showTextDialog({
                      kind: "rename-memory",
                      title: "Rename memory",
                      primaryLabel: "Memory title",
                      primaryValue: currentDiscoveryGroup.title,
                    })
                  }
                >
                  <Pencil size={12} />
                  Rename
                </Button>
                <LibrarySelect
                  className="h-8 w-40"
                  value={currentDiscoveryGroup.cover_item_id ?? ""}
                  onChange={(value) => void updateCurrentMemory({ cover_item_id: value })}
                  label="Choose memory key photo"
                  options={[
                    ["", "Automatic"],
                    ...visibleItems.map(
                      (candidate) => [candidate.id, candidate.display_name] as [string, string],
                    ),
                  ]}
                />
                <LibrarySelect
                  className="h-8 w-40"
                  value={currentDiscoveryGroup.music_item_id ?? ""}
                  onChange={(value) => void updateCurrentMemory({ music_item_id: value })}
                  label="Choose memory music"
                  options={[
                    ["", "No music"],
                    ...memoryAudioItems.map(
                      (candidate) => [candidate.id, candidate.display_name] as [string, string],
                    ),
                  ]}
                />
                <LibrarySelect
                  className="h-8 w-40"
                  value={String(currentDiscoveryGroup.playback_seconds ?? 4.5)}
                  onChange={(value) =>
                    void updateCurrentMemory({ playback_seconds: Number(value) })
                  }
                  label="Choose memory pace"
                  options={[
                    ["2", "Fast"],
                    ["4.5", "Medium"],
                    ["7", "Slow"],
                  ]}
                />
              </div>
            ) : null}
            {librarySkeletonVisible ? (
              <div
                className="grid gap-3.5"
                style={{ gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))" }}
                aria-busy="true"
                role="status"
              >
                <span className="sr-only">Loading Library</span>
                {libraryItemSkeletonCount.map((index) => (
                  <div className="grid gap-2" key={index}>
                    <Skeleton className="aspect-square w-full rounded-lg" />
                    <Skeleton className="h-3.5 w-3/4 rounded" />
                  </div>
                ))}
              </div>
            ) : collection === "collections" ||
              collection === "shared" ||
              collection === "imports" ||
              ((collection === "recent-days" ||
                collection === "months" ||
                collection === "years" ||
                collection === "albums" ||
                collection === "duplicate" ||
                collection === "map") &&
                !selectedCollectionId) ? null : sensitiveCollectionScope &&
              !sensitiveCollectionToken ? (
              <div className="grid min-h-64 place-items-center">
                <Button
                  size="sm"
                  type="button"
                  onClick={() => requestSensitiveUnlock(sensitiveCollectionScope)}
                >
                  Unlock {collection === "hidden" ? "Hidden" : "Recently Deleted"}
                </Button>
              </div>
            ) : displayItems.length === 0 ? (
              <SpaceLibraryEmptyState
                collection={collection}
                searching={Boolean(searchQuery || mediaType)}
                uploadAvailable={canUploadLibrary}
                uploading={uploading}
                uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0}
                onUpload={() => setFilePickerOpen(true)}
                onClearSearch={() => {
                  setSearchInput("");
                  setMediaType("");
                }}
              />
            ) : (
              <SpaceLibraryItems />
            )}
          </div>
          <SpaceLibraryOverlays />
        </div>
      </LibraryCanEditContext.Provider>
    </SpaceLibraryProvider>
  );
}
