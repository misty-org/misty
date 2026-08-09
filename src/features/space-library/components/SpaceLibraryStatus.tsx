import { ClipboardCopy, Star, Trash2, X } from "lucide-react";

import { Button } from "@/shared/ui";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { LibraryFacetGroup } from "../SpaceLibraryPrimitives";
import { SpaceLibraryEmptyState, SpaceLibraryHeader } from "./SpaceLibraryChrome";

export function SpaceLibraryTopChrome() {
  const { data } = useSpaceLibraryContext();
  const {
    canUploadLibrary,
    usage,
    uploadJobs,
    setUploadJobs,
    searchInput,
    setSearchInput,
    setSearchFocused,
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
  } = data;
  const { uploading } = uploadStatus(uploadJobs);
  const uploadDisabled = (usage?.remaining_bytes ?? 1) <= 0;

  return (
    <>
      <SpaceLibraryHeader
        uploadAvailable={canUploadLibrary}
        uploading={uploading}
        uploadDisabled={uploadDisabled}
        onUpload={() => data.setFilePickerOpen(true)}
        uploadJobs={uploadJobs}
        onClearUploads={() => setUploadJobs([])}
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
    searchFocused,
    selectedItems,
    setSelectedItemIds,
    bulkSaving,
    collection,
    localError,
    setLocalError,
  } = data;
  const { appendSearchFacet, copyItemsToClipboard, applyBulkAction } = itemActions;
  const { selectCollection } = collectionActions;

  return (
    <>
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
          className="mb-4 rounded-xl border border-charcoal-active/20 bg-charcoal-active px-3 py-2 text-left text-xs text-cream-bright"
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
  const { uploadJobs, canUploadLibrary, usage } = data;
  const { uploading } = uploadStatus(uploadJobs);

  return (
    <SpaceLibraryEmptyState
      collection={data.collection}
      searching={Boolean(data.searchQuery || data.mediaType)}
      uploadAvailable={canUploadLibrary}
      uploading={uploading}
      uploadDisabled={(usage?.remaining_bytes ?? 1) <= 0}
      onUpload={() => data.setFilePickerOpen(true)}
      onClearSearch={() => {
        data.setSearchInput("");
        data.setMediaType("");
      }}
    />
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
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-charcoal-card p-3"
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
    <div className="mb-4 flex min-h-10 flex-wrap items-center gap-2 rounded-xl bg-charcoal-card px-3 py-2">
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
        className="ml-auto grid size-7 place-items-center rounded-lg border-0 bg-transparent text-cream-muted hover:bg-charcoal-card hover:text-cream"
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
