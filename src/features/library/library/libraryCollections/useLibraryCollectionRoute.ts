import { useCallback, useEffect } from "react";
import type { LibraryCollectionKind, SpaceLibraryData } from "../types/useSpaceLibraryData";
import { libraryCollectionKinds } from "../useSpaceLibraryData";

export type SelectCollection = (next: LibraryCollectionKind) => void;

/**
 * Keeps the selected collection and the `?collection=` URL in step. Unknown
 * collections in old URLs fall back to Recent.
 */
export function useLibraryCollectionRoute(data: SpaceLibraryData): SelectCollection {
  const { librarySearchParams, setLibrarySearchParams, requestedCollection, setCollection } = data;

  const selectCollection: SelectCollection = useCallback(
    (next) => {
      setCollection(next);
      const nextSearchParams = new URLSearchParams(librarySearchParams);
      nextSearchParams.set("collection", next);
      nextSearchParams.delete("collectionId");
      if (nextSearchParams.toString() !== librarySearchParams.toString())
        setLibrarySearchParams(nextSearchParams, { replace: true });
    },
    [librarySearchParams, setCollection, setLibrarySearchParams],
  );

  useEffect(() => {
    if (!requestedCollection) return;
    setCollection(
      libraryCollectionKinds.has(requestedCollection as LibraryCollectionKind)
        ? (requestedCollection as LibraryCollectionKind)
        : "recent",
    );
  }, [requestedCollection, setCollection]);

  return selectCollection;
}
