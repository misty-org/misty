import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import { Skeleton } from "@/shared/ui";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryEmptyState } from "../components/SpaceLibraryChrome";
import { SpaceLibraryItems } from "../components/SpaceLibraryItems";
import { useLibraryUploadState } from "./useLibraryUploadState";

const skeletonCells = Array.from({ length: 10 }, (_, index) => index);

/** The item grid, or whatever stands in for it: a skeleton or the empty state. */
export function LibraryItemsRegion() {
  const { data } = useSpaceLibraryContext();
  const { collection, displayItems, loading, searchQuery, mediaType } = data;
  const [skeletonVisible] = useMinimumSpin(loading);
  const upload = useLibraryUploadState();

  if (skeletonVisible)
    return (
      <div
        className="grid gap-3.5"
        style={{ gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))" }}
        aria-busy="true"
        role="status"
      >
        <span className="sr-only">Loading Library</span>
        {skeletonCells.map((index) => (
          <div className="grid gap-2" key={index}>
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="h-3.5 w-3/4 rounded" />
          </div>
        ))}
      </div>
    );

  if (displayItems.length === 0)
    return (
      <SpaceLibraryEmptyState
        collection={collection}
        searching={Boolean(searchQuery || mediaType)}
        uploadAvailable={upload.uploadAvailable}
        uploading={upload.uploading}
        uploadDisabled={upload.uploadDisabled}
        onUpload={upload.onUpload}
        onClearSearch={() => {
          data.setSearchInput("");
          data.setMediaType("");
        }}
      />
    );

  return <SpaceLibraryItems />;
}
