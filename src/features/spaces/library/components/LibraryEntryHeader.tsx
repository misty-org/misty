import { OrderedCollectionFilters as CollectionFilters } from "@/features/settings/OrderedCollectionFilters";
import type { LibraryItemQuery } from "../../api/dto/entities";
import { mediaTypeOptions, sortOptions } from "../libraryFilterOptions";
import { SpaceLibraryUploadTray } from "./SpaceLibraryUploadTray";
import {
  Button,
  CollectionHeading,
  CollectionSearch,
  CollectionFilterMenu,
  CollectionViewToggle,
  IconButton,
} from "@/shared/ui";
import { Plus, Upload, Minus } from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { useLibraryUploadState } from "../library-surfaces/useLibraryUploadState";
import type { LibraryCollectionKind } from "../hook-signatures/useSpaceLibraryData";

const sections: { value: LibraryCollectionKind; label: string }[] = [
  { value: "recent", label: "All" },
  { value: "deleted", label: "Trash" },
];

export function LibraryEntryHeader() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const upload = useLibraryUploadState();
  return (
    <>
      <CollectionHeading
        title="Library"
        end={
          <>
            <CollectionSearch
              data-tour="library-search"
              aria-label="Search library"
              placeholder={data.collection === "deleted" ? "Search trash" : "Search library"}
              value={data.searchInput}
              onChange={(e) => data.setSearchInput(e.target.value)}
              onFocus={() => data.setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => data.setSearchFocused(false), 120)}
            />
            {data.collection !== "deleted" && upload.inHeader && (
              <Button
                data-tour="library-upload"
                variant="primary"
                icon={Upload}
                disabled={upload.uploadDisabled}
                loading={upload.uploading}
                onClick={upload.onUpload}
              >
                Upload files
              </Button>
            )}
          </>
        }
      />
      <span data-tour="library-filters" className="contents">
        <CollectionFilters
          collectionId="library"
          options={sections}
          value={data.collection}
          onChange={(value) => collectionActions.selectCollection(value as LibraryCollectionKind)}
          filterControl={
            <CollectionFilterMenu
              label="Filter and sort Library"
              active={
                Boolean(data.mediaType) ||
                data.sort !== "recently-added" ||
                data.direction !== "desc"
              }
              onReset={() => {
                data.setMediaType("");
                data.setSort("recently-added");
                data.setDirection("desc");
              }}
              groups={[
                {
                  label: "Media type",
                  submenu: true,
                  value: data.mediaType || "all",
                  options: mediaTypeOptions.map((x) => ({ ...x, value: x.value || "all" })),
                  onChange: (value) =>
                    data.setMediaType((value === "all" ? "" : value) as typeof data.mediaType),
                },
                {
                  label: "Sort by",
                  kind: "sort",
                  submenu: true,
                  value: `${data.sort}:${data.direction}`,
                  options: sortOptions,
                  onChange: (value) => {
                    const [sort, direction] = value.split(":");
                    data.setSort(sort as NonNullable<LibraryItemQuery["sort"]>);
                    data.setDirection(direction as "asc" | "desc");
                  },
                },
              ]}
            />
          }
          utilities={
            <>
              {data.libraryViewMode === "grid" && (
                <div role="group" aria-label="Item scale" className="flex items-center gap-1">
                  <IconButton
                    label="Zoom out"
                    disabled={data.libraryItemScale <= 0}
                    onClick={() => data.setLibraryItemScale(data.libraryItemScale - 1)}
                  >
                    <Minus />
                  </IconButton>
                  <IconButton
                    label="Zoom in"
                    disabled={data.libraryItemScale >= 2}
                    onClick={() => data.setLibraryItemScale(data.libraryItemScale + 1)}
                  >
                    <Plus />
                  </IconButton>
                </div>
              )}
              <SpaceLibraryUploadTray
                jobs={data.uploadJobs}
                onClear={() => data.setUploadJobs([])}
              />
            </>
          }
          actions={
            <CollectionViewToggle value={data.libraryViewMode} onChange={data.setLibraryViewMode} />
          }
        />
      </span>
    </>
  );
}
