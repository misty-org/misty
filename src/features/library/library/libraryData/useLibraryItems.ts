import { libraryApi as spacesApi } from "../LibraryRuntime";
import type { LibraryItemQuery, SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { useEffect, useMemo, useState } from "react";
import type { LibraryCollectionKind } from "../types/useSpaceLibraryData";
import type { LibraryMediaType } from "./useLibraryView";

export interface UseLibraryItemsOptions {
  spaceId: string;
  collection: LibraryCollectionKind;
  searchQuery: string;
  mediaType: LibraryMediaType;
  sort: NonNullable<LibraryItemQuery["sort"]>;
  direction: NonNullable<LibraryItemQuery["direction"]>;
  reloadKey: number;
  setLocalError: (message: string) => void;
}

/** The item list for the open collection, plus the query that produced it. */
export function useLibraryItems(options: UseLibraryItemsOptions) {
  const { spaceId, collection, searchQuery, mediaType, sort, direction } = options;
  const { reloadKey, setLocalError } = options;
  const [items, setItems] = useState<SpaceLibraryItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<SpaceLibraryItem[]>([]);
  const [nextAfter, setNextAfter] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const libraryQuery = useMemo<LibraryItemQuery>(
    () => ({
      q: searchQuery,
      sort,
      direction,
      media_type: mediaType || undefined,
      collection: collection === "deleted" ? "recently-deleted" : undefined,
    }),
    [collection, direction, mediaType, searchQuery, sort],
  );

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLocalError("");
    void spacesApi
      .libraryItems(spaceId, libraryQuery)
      .then((library) => {
        if (!current) return;
        setItems(library.items);
        setVisibleItems(library.items);
        setNextAfter(library.next_after ?? "");
      })
      .catch((error: unknown) => {
        if (current)
          setLocalError(error instanceof Error ? error.message : "Library could not be loaded.");
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [libraryQuery, reloadKey, setLocalError, spaceId]);

  return {
    items,
    setItems,
    visibleItems,
    setVisibleItems,
    nextAfter,
    setNextAfter,
    loadingMore,
    setLoadingMore,
    loading,
    libraryQuery,
  };
}
