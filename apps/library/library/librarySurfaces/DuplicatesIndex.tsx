import { Copy } from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { LibraryDiscoveryCard } from "../SpaceLibraryPrimitives";
import { BackToCollections } from "./LibraryNothingHere";

/** Groups of matching items, before one group is opened. */
export function DuplicatesIndex() {
  const { data, collectionActions } = useSpaceLibraryContext();
  if (data.collection !== "duplicate" || data.selectedCollectionId) return null;

  return (
    <div className="mb-5">
      <BackToCollections />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {data.discovery.duplicates.map((group, index) => (
          <LibraryDiscoveryCard
            key={group.id}
            spaceId={data.spaceId}
            group={{ ...group, title: `Duplicates ${index + 1}` }}
            fallbackIcon={Copy}
            onClick={() => collectionActions.selectCollection("duplicate", group.id)}
          />
        ))}
      </div>
    </div>
  );
}
