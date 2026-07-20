import { Grid2X2, Image as ImageIcon, List, Search, Upload, X } from "lucide-react";
import { EmptyState } from "@/components/ui/state-view";
import { Toolbar, ToolbarGroup } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LibraryItemQuery } from "../../../spaces/types";

interface SpaceLibraryHeaderProps {
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
  visibleItemCount: number;
}

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
      <Toolbar label="Library tools" wrap className="px-5 sm:px-6">
        <label className="!flex h-9 min-w-[220px] flex-1 items-center gap-2 overflow-hidden rounded-md border border-border/80 bg-background px-3 text-muted-foreground shadow-xs transition-colors focus-within:ring-1 focus-within:ring-ring">
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
              <ToggleGroup
                className="h-9 shrink-0 overflow-hidden rounded-md border border-border/80 bg-background shadow-xs"
                type="single"
                value={props.viewMode}
                onValueChange={(value) => {
                  if (value === "grid" || value === "list") props.onViewMode(value);
                }}
                aria-label="Library layout"
              >
                <ToggleGroupItem className="size-9 border-0" value="grid" aria-label="Grid view">
                  <Grid2X2 size={14} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="size-9 border-0 border-l border-border/60"
                  value="list"
                  aria-label="List view"
                >
                  <List size={15} />
                </ToggleGroupItem>
              </ToggleGroup>
            </>
          ) : null}
          {props.uploadAvailable ? (
            <Button
              className="shrink-0"
              size="sm"
              type="button"
              disabled={props.uploadDisabled}
              onClick={props.onUpload}
            >
              <Upload size={15} aria-hidden="true" />
              {props.uploading ? "Uploading…" : "Upload files"}
            </Button>
          ) : null}
        </ToolbarGroup>
      </Toolbar>
    </div>
  );
}

interface SpaceLibraryEmptyStateProps {
  collection: string;
  searching?: boolean;
  uploadAvailable: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  onClearSearch?: () => void;
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
      <EmptyState
        title={title}
        description={detail}
        icon={props.searching ? <Search /> : <ImageIcon />}
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
        people: "People & Pets",
        albums: "Albums",
        groups: "Groups",
        map: "Map",
        shared: "Shared",
        imports: "Imports",
      } as Record<string, string>
    )[collection] ?? "this collection"
  );
}
