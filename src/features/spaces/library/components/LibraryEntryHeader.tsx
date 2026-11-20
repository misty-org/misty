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
} from "@misty/ui";
import {
  AudioLines,
  FileText,
  Film,
  ImageIcon,
  LayoutGrid,
  Minus,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { useLibraryUploadState } from "../library-surfaces/useLibraryUploadState";
import type { LibraryCollectionKind } from "../hook-signatures/useSpaceLibraryData";

/**
 * The page's tabs: everything, one per kind of file, and the trash. A kind tab is the media-type
 * filter with a tab of its own.
 */
const sections = [
  { value: "recent", label: "All", icon: LayoutGrid },
  { value: "image", label: "Photos", icon: ImageIcon },
  { value: "video", label: "Videos", icon: Film },
  { value: "audio", label: "Audio", icon: AudioLines },
  { value: "document", label: "Documents", icon: FileText },
  { value: "deleted", label: "Trash", icon: Trash2 },
] as const;
type MediaTab = (typeof sections)[number]["value"];
const kindTabs = new Set<string>(["image", "video", "audio", "document"]);

/** The tab that shows what the page shows now: a kind of file, everything, or the trash. */
export function mediaTab(collection: LibraryCollectionKind, mediaType: string): MediaTab {
  if (collection === "deleted") return "deleted";
  return kindTabs.has(mediaType) ? (mediaType as MediaTab) : "recent";
}

/** Files' create action: upload files into the Space. */
function UploadFiles() {
  const upload = useLibraryUploadState();
  return (
    <Button
      variant="primary"
      icon={Upload}
      disabled={upload.uploadDisabled || upload.uploading}
      onClick={upload.onUpload}
    >
      Upload
    </Button>
  );
}

export function LibraryEntryHeader() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const upload = useLibraryUploadState();
  return (
    <>
      <CollectionHeading
        end={
          <>
            <CollectionSearch
              data-tour="library-search"
              aria-label="Search files"
              placeholder={data.collection === "deleted" ? "Search trash" : "Search files"}
              value={data.searchInput}
              onChange={(e) => data.setSearchInput(e.target.value)}
              onFocus={() => data.setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => data.setSearchFocused(false), 120)}
            />
            {data.collection !== "deleted" && upload.inHeader && (
              <span data-tour="library-upload" className="contents">
                <UploadFiles />
              </span>
            )}
          </>
        }
      />
      <span data-tour="library-filters" className="contents">
        <CollectionFilters
          collectionId="media"
          options={[...sections]}
          value={mediaTab(data.collection, data.mediaType)}
          onChange={(value) => {
            if (value === "deleted") return collectionActions.selectCollection("deleted");
            collectionActions.selectCollection("recent");
            data.setMediaType((value === "recent" ? "" : value) as typeof data.mediaType);
          }}
          filterControl={
            <CollectionFilterMenu
              label="Filter and sort"
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
                  label: "File type",
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
