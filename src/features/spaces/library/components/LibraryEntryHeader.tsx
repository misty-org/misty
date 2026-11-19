import { SpaceCrumb } from "../../components/space-row/SpaceCrumb";
import { OrderedCollectionFilters as CollectionFilters } from "@/features/settings/OrderedCollectionFilters";
import type { LibraryItemQuery } from "../../api/dto/entities";
import { mediaTypeOptions, sortOptions } from "../libraryFilterOptions";
import { SpaceLibraryUploadTray } from "./SpaceLibraryUploadTray";
import {
  CollectionHeading,
  DropdownMenu,
  DropdownMenuContent,
  MenuItem,
  MenuTrigger,
  CollectionSearch,
  CollectionFilterMenu,
  CollectionViewToggle,
  IconButton,
} from "@/shared/ui";
import {
  AudioLines,
  Clapperboard,
  FileText,
  Film,
  ImageIcon,
  LayoutGrid,
  Minus,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { canEditVideo, isVideoProjectFile } from "@/features/files";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { libraryItemMIME } from "../library-primitives/libraryMediaTypes";
import { libraryMediaKind } from "../library-viewer/libraryMediaKind";
import { createVideoProject } from "../library-viewer/videoProjects";
import { useLibraryUploadState } from "../library-surfaces/useLibraryUploadState";
import type { LibraryCollectionKind } from "../hook-signatures/useSpaceLibraryData";

/**
 * The page's tabs: everything, one per kind of file (the photo and video editors open from the
 * first two), and the trash. A kind tab is the media-type filter with a tab of its own.
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

/**
 * Media's create action: upload files, or make a video, empty or from the photos and videos
 * selected (in the order they were picked).
 */
function NewInMedia() {
  const { data } = useSpaceLibraryContext();
  const upload = useLibraryUploadState();
  const [busy, setBusy] = useState(false);
  const clips = (data.selectedItems ?? []).filter((item) => {
    const mime = libraryItemMIME(item);
    const kind = libraryMediaKind(mime, item.file.intrinsic_metadata);
    return (kind.isImage || kind.isVideo) && !isVideoProjectFile(mime, item.file.original_filename);
  });
  // Video projects are only offered where this computer can edit video.
  const videos = canEditVideo();
  const makeVideo = async (from: string[]) => {
    setBusy(true);
    try {
      const item = await createVideoProject(data.spaceId, "Untitled video", from);
      data.setItems((current) => [item, ...current]);
      data.setSelectedItemId(item.id);
    } catch (error) {
      data.setLocalError(error instanceof Error ? error.message : "The video could not be made.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <MenuTrigger
        label="New"
        variant="primary"
        icon={Plus}
        disabled={busy || upload.uploadDisabled || upload.uploading}
      />
      <DropdownMenuContent align="end" className="min-w-44">
        <MenuItem icon={Upload} label="Upload files" onSelect={upload.onUpload} />
        {videos && (
          <MenuItem icon={Clapperboard} label="New video" onSelect={() => void makeVideo([])} />
        )}
        {videos && clips.length > 0 && (
          <MenuItem
            icon={Film}
            label="Video from selection"
            onSelect={() => void makeVideo(clips.map((item) => item.id))}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LibraryEntryHeader() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const upload = useLibraryUploadState();
  return (
    <>
      <CollectionHeading
        title={<SpaceCrumb spaceId={data.spaceId} here="Media" />}
        end={
          <>
            <CollectionSearch
              data-tour="library-search"
              aria-label="Search media"
              placeholder={data.collection === "deleted" ? "Search trash" : "Search media"}
              value={data.searchInput}
              onChange={(e) => data.setSearchInput(e.target.value)}
              onFocus={() => data.setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => data.setSearchFocused(false), 120)}
            />
            {data.collection !== "deleted" && upload.inHeader && (
              <span data-tour="library-upload" className="contents">
                <NewInMedia />
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
