import { useEffect } from "react";
import { libraryCollectionKinds } from "../useSpaceLibraryData";
import type {
  LibraryCollectionKind,
  SpaceLibraryData,
} from "@/models/types/features/spaces/useSpaceLibraryData";

export type SelectCollection = (next: LibraryCollectionKind, id?: string) => void;

/**
 * Keeps the selected collection and the `?collection=` URL in step.
 *
 * "people" and "groups" are no longer browsable collections of their own, so
 * both redirect to Recently Added rather than rendering an empty surface.
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

  const selectCollection: SelectCollection = (next, id = "") => {
    if (next === "people" || next === "groups") {
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
  };

  useEffect(() => {
    if (requestedCollection === "people" || requestedCollection === "groups") {
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
  }, [requestedCollection, requestedCollectionId]);

  return selectCollection;
}
