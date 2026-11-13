import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { SpaceLibraryEmptyState } from "../components/SpaceLibraryEmptyState";
import { LibraryItemsSkeleton } from "../components/LibraryItemSkeletons";
import { SpaceLibraryItems } from "../components/SpaceLibraryItems";
import { normalizeLibraryItemScale } from "../libraryFormat";
import { useLibraryUploadState } from "./useLibraryUploadState";

/**
 * The item grid, or whatever stands in for it: the empty state, or a skeleton of the view it
 * will show on a Space's first load with nothing saved. A new search, sort or filter keeps the
 * items on screen until its answer arrives.
 */
export function LibraryItemsRegion() {
  const { data } = useSpaceLibraryContext();
  const { collection, displayItems, loading, searchQuery, mediaType } = data;
  const upload = useLibraryUploadState();

  if (loading)
    return (
      <LibraryItemsSkeleton
        view={data.libraryViewMode}
        scale={normalizeLibraryItemScale(data.libraryItemScale)}
      />
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
