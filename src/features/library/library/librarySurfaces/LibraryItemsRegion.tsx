import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import { Button, Skeleton } from "@/shared/ui";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryEmptyState } from "../components/SpaceLibraryChrome";
import { SpaceLibraryItems } from "../components/SpaceLibraryItems";
import { useLibraryUploadState } from "./useLibraryUploadState";

const skeletonCells = Array.from({ length: 10 }, (_, index) => index);

/** Collections that render their own index above instead of an item grid. */
const OWN_INDEX = ["collections", "shared", "imports"];
const OWN_INDEX_UNTIL_SELECTED = ["recent-days", "months", "years", "albums", "duplicate"];

function rendersOwnIndex(collection: string, selectedCollectionId: string) {
  return (
    OWN_INDEX.includes(collection) ||
    (OWN_INDEX_UNTIL_SELECTED.includes(collection) && !selectedCollectionId)
  );
}

/**
 * The item grid, or whatever stands in for it: skeleton, unlock prompt, or
 * empty state. Renders nothing at all for collections that show their own index.
 */
export function LibraryItemsRegion() {
  const { data, itemActions } = useSpaceLibraryContext();
  const { collection, selectedCollectionId, displayItems, loading } = data;
  const { sensitiveCollectionScope, sensitiveCollectionToken, searchQuery, mediaType } = data;
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

  if (rendersOwnIndex(collection, selectedCollectionId)) return null;

  if (sensitiveCollectionScope && !sensitiveCollectionToken)
    return (
      <div className="grid min-h-64 place-items-center">
        <Button
          size="sm"
          type="button"
          onClick={() => itemActions.requestSensitiveUnlock(sensitiveCollectionScope)}
        >
          Unlock {collection === "hidden" ? "Hidden" : "Recently Deleted"}
        </Button>
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
