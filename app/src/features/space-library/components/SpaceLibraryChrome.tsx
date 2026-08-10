import type { LibraryItemQuery } from "@/services/spaces/dto/interfaces/types";
import {
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@/shared/ui";
import { Grid2X2, Image as List, Minus, Plus, Search, Upload, X } from "lucide-react";
import { useState } from "react";
import {
  LIBRARY_ITEM_SCALE_MAX,
  LIBRARY_ITEM_SCALE_MIN,
  normalizeLibraryItemScale,
} from "../libraryFormat";
import type { LibraryUploadJob } from "../types/useSpaceLibraryData";
import { SpaceLibraryUploadTray } from "./SpaceLibraryUploadTray";

const toolbarControlStyles = {
  group:
    "flex h-9 shrink-0 items-center gap-0.5 rounded-md border border-charcoal-border/80 bg-charcoal-bg px-1 shadow-xs",
  button: "size-7 rounded-sm text-cream-muted shadow-none",
  buttonActive: "bg-charcoal-hover text-cream",
} as const;

const mediaTypeOptions = [
  { value: "", label: "All media" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
  { value: "selfies", label: "Selfies" },
  { value: "live-photos", label: "Live Photos" },
  { value: "portraits", label: "Portraits" },
  { value: "panoramas", label: "Panoramas" },
  { value: "slo-mo", label: "Slo-mo" },
  { value: "cinematic", label: "Cinematic" },
  { value: "bursts", label: "Bursts" },
  { value: "raw", label: "RAW" },
  { value: "screenshots", label: "Screenshots" },
  { value: "screen-recordings", label: "Screen Recordings" },
  { value: "spatial", label: "Spatial" },
];

const sortOptions = [
  { value: "recently-added:desc", label: "Newest added" },
  { value: "recently-added:asc", label: "Oldest added" },
  { value: "date-captured:desc", label: "Newest captured" },
  { value: "date-captured:asc", label: "Oldest captured" },
  { value: "name:asc", label: "Name A–Z" },
  { value: "name:desc", label: "Name Z–A" },
  { value: "size:desc", label: "Largest" },
  { value: "size:asc", label: "Smallest" },
];

export function SpaceLibraryHeader(props: SpaceLibraryHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = searchOpen || Boolean(props.searchInput);
  const hasVisibleItems = props.visibleItemCount > 0;

  return (
    <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5">
      <h1 className="m-0 shrink-0 text-sm font-semibold">Library</h1>

      <div className="ml-auto flex items-center gap-3">
        {showSearch ? (
          <div className="relative w-44">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-cream-muted" />
            <Input
              autoFocus
              className="h-8 pl-8 pr-8 text-xs"
              aria-label="Search Library"
              placeholder="Search Library..."
              value={props.searchInput}
              onChange={(event) => props.onSearchInput(event.target.value)}
              onFocus={props.onSearchFocus}
              onBlur={() => {
                props.onSearchBlur();
                if (!props.searchInput) setSearchOpen(false);
              }}
            />
            {props.searchInput ? (
              <Button
                className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
                size="icon"
                variant="ghost"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onSearchInput("")}
                aria-label="Clear Library search"
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ) : (
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search Library"
          >
            <Search className="size-4" />
          </Button>
        )}

        <Select
          value={props.mediaType || "all"}
          onValueChange={(value) => props.onMediaType(value === "all" ? "" : value)}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Filter by media type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mediaTypeOptions.map((option) => (
              <SelectItem key={option.value || "all"} value={option.value || "all"}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasVisibleItems ? (
          <>
            <Select
              value={`${props.sort}:${props.direction}`}
              onValueChange={(value) => {
                const [sort, direction] = value.split(":") as [
                  NonNullable<LibraryItemQuery["sort"]>,
                  NonNullable<LibraryItemQuery["direction"]>,
                ];
                props.onSort(sort, direction);
              }}
            >
              <SelectTrigger
                className="h-8 w-[140px] text-xs max-lg:hidden"
                aria-label="Sort Library"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(props.albumOrderAvailable
                  ? [{ value: "album-order:asc", label: "Album order" }, ...sortOptions]
                  : sortOptions
                ).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div
              role="group"
              aria-label="Library layout"
              className="flex h-8 items-center gap-0.5 rounded-md border border-charcoal-border/80 bg-charcoal-bg px-1"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-6 rounded-sm text-cream-muted shadow-none",
                  props.viewMode === "grid" && "bg-charcoal-hover text-cream",
                )}
                aria-label="Grid view"
                title="Grid view"
                aria-pressed={props.viewMode === "grid"}
                onClick={() => props.onViewMode("grid")}
              >
                <Grid2X2 className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-6 rounded-sm text-cream-muted shadow-none",
                  props.viewMode === "list" && "bg-charcoal-hover text-cream",
                )}
                aria-label="List view"
                title="List view"
                aria-pressed={props.viewMode === "list"}
                onClick={() => props.onViewMode("list")}
              >
                <List className="size-3.5" />
              </Button>
            </div>
            <SpaceLibraryScaleControls
              itemScale={props.itemScale}
              onItemScale={props.onItemScale}
            />
          </>
        ) : null}

        <SpaceLibraryUploadTray jobs={props.uploadJobs} onClear={props.onClearUploads} />

        {props.uploadAvailable ? (
          <Button
            className="h-8 gap-1.5 text-xs"
            type="button"
            disabled={props.uploadDisabled}
            onClick={props.onUpload}
          >
            <Upload className="size-3.5" aria-hidden="true" />
            Upload
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function SpaceLibraryScaleControls({
  itemScale,
  onItemScale,
}: {
  itemScale: number;
  onItemScale: (scale: number) => void;
}) {
  const scale = normalizeLibraryItemScale(itemScale);

  return (
    <div role="group" aria-label="Item scale" className={toolbarControlStyles.group}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={toolbarControlStyles.button}
        aria-label="Zoom out"
        title="Zoom out"
        disabled={scale <= LIBRARY_ITEM_SCALE_MIN}
        onClick={() => onItemScale(scale - 1)}
      >
        <Minus size={15} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={toolbarControlStyles.button}
        aria-label="Zoom in"
        title="Zoom in"
        disabled={scale >= LIBRARY_ITEM_SCALE_MAX}
        onClick={() => onItemScale(scale + 1)}
      >
        <Plus size={15} />
      </Button>
    </div>
  );
}

export function SpaceLibraryEmptyState(props: SpaceLibraryEmptyStateProps) {
  const label = collectionLabel(props.collection);
  const title = props.searching
    ? "No matching items"
    : props.collection === "recent"
      ? "Build your library"
      : `No items in ${label}`;
  const detail = props.searching
    ? "Try a different search or clear your filters to see everything in this Space."
    : props.collection === "recent"
      ? props.uploadAvailable
        ? "Upload photos, videos, audio, and documents."
        : "Items shared with this Space will appear here."
      : `Items added to ${label} will appear here.`;

  return (
    <div className="grid h-full min-h-[300px] place-items-center px-4 py-8">
      <div className="w-full max-w-lg">
        <EmptyState
          title={title}
          description={detail}
          action={
            <>
              {props.searching && props.onClearSearch ? (
                <Button variant="outline" type="button" onClick={props.onClearSearch}>
                  Clear search
                </Button>
              ) : null}
              {props.uploadAvailable && (!props.searching || props.collection === "recent") ? (
                <Button type="button" disabled={props.uploadDisabled} onClick={props.onUpload}>
                  <Upload size={15} />
                  {props.uploading ? "Uploading..." : "Upload files"}
                </Button>
              ) : null}
            </>
          }
          aria-label={title}
        />
      </div>
    </div>
  );
}

function collectionLabel(collection: string): string {
  return (
    (
      {
        months: "Months",
        years: "Years",
        collections: "Collections",
        favorites: "Favorites",
        hidden: "Hidden",
        deleted: "Recently Deleted",
        albums: "Albums",
        map: "Map",
        shared: "Shared",
        imports: "Imports",
      } as Record<string, string>
    )[collection] ?? "this collection"
  );
}

export interface SpaceLibraryHeaderProps {
  uploadAvailable: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  searchInput: string;
  onSearchInput: (value: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  mediaType: string;
  onMediaType: (value: string) => void;
  sort: NonNullable<LibraryItemQuery["sort"]>;
  direction: NonNullable<LibraryItemQuery["direction"]>;
  onSort: (
    sort: NonNullable<LibraryItemQuery["sort"]>,
    direction: NonNullable<LibraryItemQuery["direction"]>,
  ) => void;
  albumOrderAvailable: boolean;
  viewMode: "grid" | "list";
  onViewMode: (mode: "grid" | "list") => void;
  itemScale: number;
  onItemScale: (scale: number) => void;
  visibleItemCount: number;
  // Upload progress lives in the toolbar so it never displaces Library content.
  uploadJobs: LibraryUploadJob[];
  onClearUploads: () => void;
}

export interface SpaceLibraryEmptyStateProps {
  collection: string;
  searching?: boolean;
  uploadAvailable: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  onClearSearch?: () => void;
}
