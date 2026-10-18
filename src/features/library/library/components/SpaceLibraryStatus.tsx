import { ClipboardCopy, Trash2, X } from "lucide-react";
import { LibraryError as SystemErrorNotice } from "../LibraryRuntime";

import { Button, IconButton } from "@/shared/ui";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { LibraryFacetGroup } from "../SpaceLibraryPrimitives";

export function SpaceLibraryInlineStatus() {
  const { data, itemActions } = useSpaceLibraryContext();
  const {
    canEditLibrary,
    searchFocused,
    selectedItems,
    setSelectedItemIds,
    bulkSaving,
    collection,
    localError,
  } = data;
  const { appendSearchFacet, copyItemsToClipboard, applyBulkAction } = itemActions;

  return (
    <>
      {searchFocused ? <SpaceLibraryFacetSuggestions onAppendFacet={appendSearchFacet} /> : null}
      {selectedItems.length > 0 ? (
        <SpaceLibrarySelectionToolbar
          canEdit={canEditLibrary}
          bulkSaving={bulkSaving}
          collection={collection}
          selectedCount={selectedItems.length}
          onCopy={() => void copyItemsToClipboard(selectedItems)}
          onRestore={() => void applyBulkAction("restore")}
          onTrash={() => void applyBulkAction("trash")}
          onClear={() => setSelectedItemIds([])}
        />
      ) : null}
      {localError ? (
        <SystemErrorNotice
          error={localError}
          scope="library:bulk-action"
          title="Library action could not be completed"
        />
      ) : null}
    </>
  );
}

function SpaceLibraryFacetSuggestions({
  onAppendFacet,
}: {
  onAppendFacet: (key: "tag" | "type" | "year", value: string) => void;
}) {
  const { data } = useSpaceLibraryContext();
  const { searchFacets } = data;
  const hasFacets =
    searchFacets.tags.length > 0 ||
    searchFacets.media_types.length > 0 ||
    searchFacets.years.length > 0;

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
      {searchFacets.years.length > 0 ? (
        <LibraryFacetGroup
          label="Years"
          facets={searchFacets.years}
          onSelect={(facet) => onAppendFacet("year", facet.value)}
        />
      ) : null}
    </div>
  );
}

function SpaceLibrarySelectionToolbar({
  canEdit,
  bulkSaving,
  collection,
  selectedCount,
  onCopy,
  onRestore,
  onTrash,
  onClear,
}: {
  canEdit: boolean;
  bulkSaving: boolean;
  collection: string;
  selectedCount: number;
  onCopy: () => void;
  onRestore: () => void;
  onTrash: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mb-4 flex min-h-10 flex-wrap items-center gap-2 rounded-xl bg-charcoal-card px-3 py-2">
      <span className="mr-1 text-xs font-medium">{selectedCount} selected</span>
      {collection !== "deleted" ? (
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
              onClick={onTrash}
            >
              <Trash2 size={12} />
              Delete
            </Button>
          </>
        )
      ) : null}
      <IconButton
        label="Clear selection"
        className="ml-auto"
        disabled={bulkSaving}
        onClick={onClear}
      >
        <X size={13} />
      </IconButton>
    </div>
  );
}
