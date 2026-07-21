import { ClipboardCopy, Star, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/ui";

import { LibraryFacetGroup } from "../SpaceLibraryPrimitives";
import { SpaceLibraryEmptyState, SpaceLibraryHeader } from "./SpaceLibraryChrome";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";

export function SpaceLibraryTopChrome() {
  const { data, itemActions, collectionActions } = useSpaceLibraryContext();
  const {
    canUploadLibrary,
    canCopyLibrary,
    canEditLibrary,
    usage,
    uploadJobs,
    searchInput,
    setSearchInput,
    setSearchFocused,
    searchFocused,
    searchFacets,
    mediaType,
    setMediaType,
    sort,
    setSort,
    direction,
    setDirection,
    currentAlbum,
    libraryViewMode,
    setLibraryViewMode,
    libraryItemScale,
    setLibraryItemScale,
    visibleItems,
    selectedItems,
    selectedItemIds,
    setSelectedItemIds,
    bulkSaving,
    collection,
    localError,
    setLocalError,
  } = data;
  const { appendSearchFacet, copyItemsToClipboard, applyBulkAction } = itemActions;
  const { selectCollection } = collectionActions;
  const { failedUploads, uploadProgress, uploading } = uploadStatus(uploadJobs);
  const uploadDisabled = uploading || (usage?.remaining_bytes ?? 1) <= 0;

  return (
    <>
      <SpaceLibraryHeader
        uploadAvailable={canUploadLibrary}
        uploading={uploading}
        uploadDisabled={uploadDisabled}
        onUpload={() => data.setFilePickerOpen(true)}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchFocus={() => setSearchFocused(true)}
        onSearchBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
        mediaType={mediaType}
        onMediaType={(value) => setMediaType(value as typeof mediaType)}
        sort={sort}
        direction={direction}
        onSort={(nextSort, nextDirection) => {
          setSort(nextSort);
          setDirection(nextDirection);
        }}
        albumOrderAvailable={Boolean(currentAlbum)}
        viewMode={libraryViewMode}
        onViewMode={setLibraryViewMode}
        itemScale={libraryItemScale}
        onItemScale={setLibraryItemScale}
        visibleItemCount={visibleItems.length}
      />
      <SpaceLibraryInlineStatus />
    </>
  );
}

export function SpaceLibraryInlineStatus() {
  const { data, itemActions, collectionActions } = useSpaceLibraryContext();
  const {
    canCopyLibrary,
    canEditLibrary,
    usage,
    uploadJobs,
    searchFocused,
    selectedItems,
    selectedItemIds,
    setSelectedItemIds,
    bulkSaving,
    collection,
    localError,
    setLocalError,
  } = data;
  const { appendSearchFacet, copyItemsToClipboard, applyBulkAction } = itemActions;
  const { selectCollection } = collectionActions;
  const { failedUploads, uploadProgress, uploading } = uploadStatus(uploadJobs);

  return (
    <>
      {uploadJobs.length > 0 ? (
        <SpaceLibraryUploadStatus
          failedUploadError={failedUploads[0]?.error}
          uploadCount={uploadJobs.length}
          uploadProgress={uploadProgress}
          uploading={uploading}
          failedCount={failedUploads.length}
          onDismiss={() => data.setUploadJobs([])}
        />
      ) : null}
      {searchFocused ? (
        <SpaceLibraryFacetSuggestions
          onSelectCollection={selectCollection}
          onAppendFacet={appendSearchFacet}
        />
      ) : null}
      {selectedItems.length > 0 ? (
        <SpaceLibrarySelectionToolbar
          canCopy={canCopyLibrary}
          canEdit={canEditLibrary}
          bulkSaving={bulkSaving}
          collection={collection}
          selectedCount={selectedItems.length}
          onCopy={() => void copyItemsToClipboard(selectedItems)}
          onFavorite={() =>
            void applyBulkAction(collection === "favorites" ? "unfavorite" : "favorite")
          }
          onRemoveFromAlbum={() =>
            void applyBulkAction("remove_from_album", {
              albumId: data.selectedCollectionId,
            })
          }
          onRestore={() => void applyBulkAction("restore")}
          onTrash={() => void applyBulkAction("trash")}
          onClear={() => setSelectedItemIds([])}
          showRemoveFromAlbum={collection === "albums" && Boolean(data.selectedCollectionId)}
        />
      ) : null}
      {localError ? (
        <Button
          className="mb-4 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-xs text-red-200"
          type="button"
          onClick={() => setLocalError("")}
        >
          {localError}
        </Button>
      ) : null}
    </>
  );
}

export function SpaceLibraryUploadEmptyState() {
  const { data } = useSpaceLibraryContext();
  const { uploadJobs, usage, canUploadLibrary } = data;
  const { uploading } = uploadStatus(uploadJobs);

  return (
    <SpaceLibraryEmptyState
      collection={data.collection}
      searching={Boolean(data.searchQuery || data.mediaType)}
      uploadAvailable={canUploadLibrary}
      uploading={uploading}
      uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0}
      onUpload={() => data.setFilePickerOpen(true)}
      onClearSearch={() => {
        data.setSearchInput("");
        data.setMediaType("");
      }}
    />
  );
}

function SpaceLibraryUploadStatus({
  failedUploadError,
  uploadCount,
  uploadProgress,
  uploading,
  failedCount,
  onDismiss,
}: {
  failedUploadError?: string;
  uploadCount: number;
  uploadProgress: number;
  uploading: boolean;
  failedCount: number;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl bg-muted/35">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Upload className="shrink-0 text-muted-foreground" size={15} />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-xs font-medium">
            {uploading
              ? `Uploading ${uploadCount} file${uploadCount === 1 ? "" : "s"} in the background`
              : failedCount > 0
                ? `${uploadCount - failedCount} uploaded, ${failedCount} failed`
                : `${uploadCount} file${uploadCount === 1 ? "" : "s"} uploaded`}
          </p>
          <p className="m-0 mt-0.5 truncate text-[10px] text-muted-foreground">
            {uploading
              ? `${uploadProgress}% · You can keep using Misty while this finishes`
              : (failedUploadError ?? "Complete")}
          </p>
        </div>
        {!uploading ? (
          <Button
            size="icon"
            variant="outline"
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss upload status"
          >
            <X size={14} />
          </Button>
        ) : null}
      </div>
      <div className="h-0.5 bg-accent">
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${uploadProgress}%` }}
        />
      </div>
    </div>
  );
}

function SpaceLibraryFacetSuggestions({
  onAppendFacet,
  onSelectCollection,
}: {
  onAppendFacet: (key: "tag" | "type" | "album" | "year", value: string) => void;
  onSelectCollection: (collection: "utility", id: string) => void;
}) {
  const { data } = useSpaceLibraryContext();
  const { searchFacets } = data;
  const hasFacets =
    searchFacets.tags.length > 0 ||
    searchFacets.media_types.length > 0 ||
    searchFacets.years.length > 0 ||
    searchFacets.albums.length > 0 ||
    searchFacets.utilities.length > 0;

  if (!hasFacets) return null;

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-muted/35 p-3"
      onMouseDown={(event) => event.preventDefault()}
    >
      {searchFacets.media_types.length > 0 ? (
        <LibraryFacetGroup
          label="Media"
          facets={searchFacets.media_types}
          onSelect={(facet) => onAppendFacet("type", facet.value)}
        />
      ) : null}
      {searchFacets.tags.length > 0 ? (
        <LibraryFacetGroup
          label="Tags"
          facets={searchFacets.tags}
          onSelect={(facet) => onAppendFacet("tag", facet.value)}
        />
      ) : null}
      {searchFacets.albums.length > 0 ? (
        <LibraryFacetGroup
          label="Albums"
          facets={searchFacets.albums}
          onSelect={(facet) => onAppendFacet("album", facet.label)}
        />
      ) : null}
      {searchFacets.years.length > 0 ? (
        <LibraryFacetGroup
          label="Years"
          facets={searchFacets.years}
          onSelect={(facet) => onAppendFacet("year", facet.value)}
        />
      ) : null}
      {searchFacets.utilities.length > 0 ? (
        <LibraryFacetGroup
          label="Utilities"
          facets={searchFacets.utilities}
          onSelect={(facet) => onSelectCollection("utility", facet.value)}
        />
      ) : null}
    </div>
  );
}

function SpaceLibrarySelectionToolbar({
  canCopy,
  canEdit,
  bulkSaving,
  collection,
  selectedCount,
  showRemoveFromAlbum,
  onCopy,
  onFavorite,
  onRemoveFromAlbum,
  onRestore,
  onTrash,
  onClear,
}: {
  canCopy: boolean;
  canEdit: boolean;
  bulkSaving: boolean;
  collection: string;
  selectedCount: number;
  showRemoveFromAlbum: boolean;
  onCopy: () => void;
  onFavorite: () => void;
  onRemoveFromAlbum: () => void;
  onRestore: () => void;
  onTrash: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mb-4 flex min-h-10 flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
      <span className="mr-1 text-xs font-medium">{selectedCount} selected</span>
      {canCopy && collection !== "deleted" ? (
        <Button size="sm" variant="outline" type="button" disabled={bulkSaving} onClick={onCopy}>
          <ClipboardCopy size={12} />
          Copy
        </Button>
      ) : null}
      {canEdit ? (
        collection === "deleted" ? (
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={bulkSaving}
            onClick={onRestore}
          >
            Restore
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={bulkSaving}
              onClick={onFavorite}
            >
              <Star size={12} />
              {collection === "favorites" ? "Unfavorite" : "Favorite"}
            </Button>
            {showRemoveFromAlbum ? (
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={bulkSaving}
                onClick={onRemoveFromAlbum}
              >
                Remove from album
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={bulkSaving}
              onClick={onTrash}
            >
              <Trash2 size={12} />
              Delete
            </Button>
          </>
        )
      ) : null}
      <Button
        className="ml-auto grid size-7 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
        type="button"
        disabled={bulkSaving}
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X size={13} />
      </Button>
    </div>
  );
}

function uploadStatus(uploadJobs: ReturnType<typeof useSpaceLibraryContext>["data"]["uploadJobs"]) {
  const uploading = uploadJobs.some((job) => !["ready", "failed"].includes(job.stage));
  const failedUploads = uploadJobs.filter((job) => job.stage === "failed");
  const uploadProgress =
    uploadJobs.length > 0
      ? Math.round(
          (uploadJobs.reduce(
            (total, job) =>
              total + (job.stage === "ready" || job.stage === "failed" ? 1 : job.progress),
            0,
          ) /
            uploadJobs.length) *
            100,
        )
      : 0;

  return { failedUploads, uploadProgress, uploading };
}
