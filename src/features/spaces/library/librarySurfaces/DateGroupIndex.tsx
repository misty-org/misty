import { History, BookOpenText as LibraryIcon } from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { LibraryDiscoveryCard } from "../SpaceLibraryPrimitives";
import { SpaceLibraryEmptyState } from "../components/SpaceLibraryChrome";
import { useLibraryUploadState } from "./useLibraryUploadState";

/** The Recent Days / Months / Years index, shown before a group is picked. */
export function DateGroupIndex() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const { collection, selectedCollectionId, discovery, spaceId } = data;
  const upload = useLibraryUploadState();

  const isDateIndex =
    collection === "months" || collection === "years" || collection === "recent-days";
  if (!isDateIndex || selectedCollectionId) return null;

  const groups =
    collection === "months"
      ? discovery.months
      : collection === "years"
        ? discovery.years
        : discovery.recent_days;

  return (
    <div className="mb-5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {groups.map((group) => (
          <LibraryDiscoveryCard
            key={`${group.kind}:${group.id}`}
            spaceId={spaceId}
            group={group}
            fallbackIcon={collection === "years" ? History : LibraryIcon}
            onClick={() => collectionActions.selectCollection(collection, group.id)}
          />
        ))}
      </div>
      {groups.length === 0 ? (
        <SpaceLibraryEmptyState
          collection={collection}
          uploadAvailable={upload.uploadAvailable}
          uploading={upload.uploading}
          uploadDisabled={upload.uploadDisabled}
          onUpload={upload.onUpload}
        />
      ) : null}
    </div>
  );
}
