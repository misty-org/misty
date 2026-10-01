import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import type { LibraryItemQuery } from "@/api/spaces/dto/interfaces/types";
import { mediaTypeOptions, sortOptions } from "./SpaceLibraryChrome";
import { SpaceLibraryUploadTray } from "./SpaceLibraryUploadTray";
import {
  Button,
  CollectionHeading,
  CollectionSearch,
  CollectionFilterMenu,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  IconButton,
  NavIsland,
} from "@/shared/ui";
import { MoreHorizontal, Plus, Upload, Minus } from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { useLibraryUploadState } from "../librarySurfaces/useLibraryUploadState";
import type { LibraryCollectionKind } from "../types/useSpaceLibraryData";

const sections = [
  { value: "recent", label: "All" },
  { value: "favorites", label: "Favorites" },
  { value: "albums", label: "Albums" },
  { value: "deleted", label: "Trash" },
];
const more: { value: LibraryCollectionKind; label: string }[] = [
  { value: "hidden", label: "Hidden" },
  { value: "collections", label: "Collections" },
  { value: "imports", label: "Imports" },
  { value: "shared", label: "Shared references" },
  { value: "duplicate", label: "Duplicates" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
];

export function LibraryEntryHeader() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const upload = useLibraryUploadState();
  const extra = more.find((x) => x.value === data.collection);
  return (
    <>
      <CollectionHeading
        title="Library"
        actions={
          <>
            <CollectionSearch
              aria-label="Search library"
              placeholder={data.collection === "deleted" ? "Search trash" : "Search library"}
              value={data.searchInput}
              onChange={(e) => data.setSearchInput(e.target.value)}
              onFocus={() => data.setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => data.setSearchFocused(false), 120)}
            />
            {data.collection === "albums" && !data.selectedCollectionId
              ? data.canEditLibrary && (
                  <Button
                    variant="primary"
                    className="px-4"
                    onClick={collectionActions.openCreateAlbum}
                  >
                    <Plus />
                    New album
                  </Button>
                )
              : data.collection !== "deleted" &&
                upload.uploadAvailable && (
                  <Button
                    variant="primary"
                    className="px-4"
                    disabled={upload.uploadDisabled || upload.uploading}
                    onClick={upload.onUpload}
                  >
                    <Upload />
                    {upload.uploading ? "Uploading…" : "Upload files"}
                  </Button>
                )}
          </>
        }
      />
      <CollectionFilters
        collectionId="library"
        options={extra ? [...sections, extra] : sections}
        value={data.collection}
        onChange={(value) => collectionActions.selectCollection(value as LibraryCollectionKind)}
        filterControl={
          <CollectionFilterMenu
            label="Filter and sort Library"
            active={
              Boolean(data.mediaType) || data.sort !== "recently-added" || data.direction !== "desc"
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
                options: data.currentAlbum
                  ? [{ value: "album-order:asc", label: "Album order" }, ...sortOptions]
                  : sortOptions,
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
              <NavIsland aria-label="Item scale">
                <IconButton
                  label="Zoom out"
                  shape="round"
                  disabled={data.libraryItemScale <= 0}
                  onClick={() => data.setLibraryItemScale(data.libraryItemScale - 1)}
                >
                  <Minus />
                </IconButton>
                <IconButton
                  label="Zoom in"
                  shape="round"
                  disabled={data.libraryItemScale >= 2}
                  onClick={() => data.setLibraryItemScale(data.libraryItemScale + 1)}
                >
                  <Plus />
                </IconButton>
              </NavIsland>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More Library sections" shape="round">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {more.map((x) => (
                  <DropdownMenuItem
                    key={x.value}
                    onSelect={() => collectionActions.selectCollection(x.value)}
                  >
                    {x.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <SpaceLibraryUploadTray jobs={data.uploadJobs} onClear={() => data.setUploadJobs([])} />
          </>
        }
        actions={
          <CollectionViewToggle value={data.libraryViewMode} onChange={data.setLibraryViewMode} />
        }
      />
    </>
  );
}
