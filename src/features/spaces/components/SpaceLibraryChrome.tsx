import type {
  SpaceLibraryHeaderProps,
  SpaceLibraryEmptyStateProps,
} from "@/models/interfaces/features/spaces/components/SpaceLibraryChrome";
export type {
  SpaceLibraryHeaderProps,
  SpaceLibraryEmptyStateProps,
} from "@/models/interfaces/features/spaces/components/SpaceLibraryChrome";
import { Grid2X2, Image as List, Minus, Plus, Search, Upload, X } from "lucide-react";
import { EmptyState } from "@/ui";
import { Toolbar, ToolbarGroup } from "@/ui";
import { Button } from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { cn } from "@/ui";
import { SpaceLibraryUploadTray } from "./SpaceLibraryUploadTray";
import type { LibraryItemQuery } from "@/models/interfaces/features/spaces/types";
import {
  LIBRARY_ITEM_SCALE_MAX,
  LIBRARY_ITEM_SCALE_MIN,
  normalizeLibraryItemScale,
} from "../libraryFormat";

const toolbarControlStyles = {
  group:
    "flex h-9 shrink-0 items-center gap-0.5 rounded-md border border-border/80 bg-background px-1 shadow-xs",
  button: "size-7 rounded-sm text-muted-foreground shadow-none",
  buttonActive: "bg-accent text-accent-foreground",
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
  const hasVisibleItems = props.visibleItemCount > 0;

  return (
    <div className="shrink-0">
      <Toolbar label="Library tools" wrap className="misty-spaces-toolbar min-h-11 px-3 py-1.5">
        <label className="!flex h-8 min-w-[220px] flex-1 items-center gap-2 overflow-hidden rounded-md border border-border/70 bg-muted/30 px-2.5 text-muted-foreground shadow-none transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Search size={15} aria-hidden="true" />
          <Input
            className="!m-0 !h-full !min-h-0 min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none text-sm leading-none focus-visible:!ring-0"
            value={props.searchInput}
            onChange={(event) => props.onSearchInput(event.target.value)}
            onFocus={props.onSearchFocus}
            onBlur={props.onSearchBlur}
            placeholder="Search this Library"
            aria-label="Search Library"
          />
          {props.searchInput ? (
            <Button
              className="size-6 shrink-0"
              size="icon"
              variant="ghost"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onSearchInput("")}
              aria-label="Clear Library search"
            >
              <X size={13} />
            </Button>
          ) : null}
        </label>

        <ToolbarGroup align="end" aria-label="Library view controls">
          <Select
            value={props.mediaType || "all"}
            onValueChange={(value) => props.onMediaType(value === "all" ? "" : value)}
          >
            <SelectTrigger className="w-[142px]" aria-label="Filter by media type">
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
                <SelectTrigger className="w-[154px] max-lg:hidden" aria-label="Sort Library">
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
              <div role="group" aria-label="Library layout" className={toolbarControlStyles.group}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    toolbarControlStyles.button,
                    props.viewMode === "grid" && toolbarControlStyles.buttonActive,
                  )}
                  aria-label="Grid view"
                  title="Grid view"
                  aria-pressed={props.viewMode === "grid"}
                  onClick={() => props.onViewMode("grid")}
                >
                  <Grid2X2 size={15} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    toolbarControlStyles.button,
                    props.viewMode === "list" && toolbarControlStyles.buttonActive,
                  )}
                  aria-label="List view"
                  title="List view"
                  aria-pressed={props.viewMode === "list"}
                  onClick={() => props.onViewMode("list")}
                >
                  <List size={15} />
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
              className="shrink-0"
              size="sm"
              type="button"
              disabled={props.uploadDisabled}
              onClick={props.onUpload}
            >
              <Upload size={15} aria-hidden="true" />
              Upload files
            </Button>
          ) : null}
        </ToolbarGroup>
      </Toolbar>
    </div>
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
