import { useCallback, useEffect } from "react";
import type { LibraryCollectionKind, SpaceLibraryData } from "../types/useSpaceLibraryData";
import { libraryCollectionKinds } from "../useSpaceLibraryData";

export type SelectCollection = (next: LibraryCollectionKind, id?: string) => void;

/**
 * Keeps the selected collection and the `?collection=` URL in step.
 *
 * Beta-only collections are not browsable, so their legacy URLs redirect to
 * Recently Added rather than rendering an empty or hidden surface.
 * Opening a specific album also switches the sort to the album's own order.
 */
export function useLibraryCollectionRoute(data: SpaceLibraryData): SelectCollection {
  const {
    librarySearchParams,
    setLibrarySearchParams,
    requestedCollection,
    requestedCollectionId,
    setCollection,
    setSelectedCollectionId,
    sort,
    setSort,
    setDirection,
  } = data;

  const selectCollection: SelectCollection = useCallback(
    (next, id = "") => {
      if (next === "smart" || next === "people" || next === "groups") {
        next = "recent";
        id = "";
      }
      setCollection(next);
      setSelectedCollectionId(id);

      const nextSearchParams = new URLSearchParams(librarySearchParams);
      nextSearchParams.set("collection", next);
      if (id) nextSearchParams.set("collectionId", id);
      else nextSearchParams.delete("collectionId");
      if (nextSearchParams.toString() !== librarySearchParams.toString())
        setLibrarySearchParams(nextSearchParams, { replace: true });

      if (next === "albums" && id) {
        setSort("album-order");
        setDirection("asc");
      } else if (sort === "album-order") {
        setSort("recently-added");
        setDirection("desc");
      }
    },
    [
      librarySearchParams,
      setCollection,
      setDirection,
      setLibrarySearchParams,
      setSelectedCollectionId,
      setSort,
      sort,
    ],
  );

  useEffect(() => {
    if (
      requestedCollection === "smart" ||
      requestedCollection === "people" ||
      requestedCollection === "groups"
    ) {
      selectCollection("recent");
      return;
    }
    if (
      !requestedCollection ||
      !libraryCollectionKinds.has(requestedCollection as LibraryCollectionKind)
    )
      return;
    const nextCollection = requestedCollection as LibraryCollectionKind;
    setCollection(nextCollection);
    setSelectedCollectionId(requestedCollectionId);
    if (nextCollection === "albums" && requestedCollectionId) {
      setSort("album-order");
      setDirection("asc");
    } else {
      setSort((current) => (current === "album-order" ? "recently-added" : current));
    }
  }, [
    requestedCollection,
    requestedCollectionId,
    selectCollection,
    setCollection,
    setDirection,
    setSelectedCollectionId,
    setSort,
  ]);

  return selectCollection;
}
