import { useEffect, useMemo, useState } from "react";
import { SpaceRequestError, spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { LibraryItemQuery, SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";
import type { LibraryCollectionKind } from "@/models/types/features/spaces/useSpaceLibraryData";
import type { LibraryMediaType } from "./useLibraryView";
import {
  filterCuratedItems,
  hasNoItemList,
  isCurated,
  libraryItemRequest,
} from "./libraryItemRequest";
import type { SensitiveScope } from "./useLibrarySensitiveAccess";

export interface UseLibraryItemsOptions {
  spaceId: string;
  collection: LibraryCollectionKind;
  selectedCollectionId: string;
  searchQuery: string;
  mediaType: LibraryMediaType;
  sort: NonNullable<LibraryItemQuery["sort"]>;
  direction: NonNullable<LibraryItemQuery["direction"]>;
  reloadKey: number;
  semanticSearchEnabled: boolean;
  sensitiveCollectionScope: SensitiveScope;
  sensitiveCollectionToken: string;
  onSensitiveGrantRejected: (scope: Exclude<SensitiveScope, "">) => void;
  setLocalError: (message: string) => void;
}

/** The item list for the open collection, plus the query that produced it. */
export function useLibraryItems(options: UseLibraryItemsOptions) {
  const { spaceId, collection, selectedCollectionId, searchQuery, mediaType, sort, direction } =
    options;
  const { reloadKey, sensitiveCollectionScope, sensitiveCollectionToken, setLocalError } = options;
  const [items, setItems] = useState<SpaceLibraryItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<SpaceLibraryItem[]>([]);
  const [memoryAudioItems, setMemoryAudioItems] = useState<SpaceLibraryItem[]>([]);
  const [nextAfter, setNextAfter] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const libraryQuery = useMemo<LibraryItemQuery>(
    () => ({
      q: searchQuery,
      sort,
      direction,
      media_type: mediaType || undefined,
      utility:
        collection === "utility" && selectedCollectionId
          ? (selectedCollectionId as LibraryItemQuery["utility"])
          : undefined,
      visibility: collection === "hidden" ? "hidden" : "visible",
      collection: collection === "deleted" ? "recently-deleted" : undefined,
      favorite: collection === "favorites",
      album_id: collection === "albums" && selectedCollectionId ? selectedCollectionId : undefined,
    }),
    [collection, direction, mediaType, searchQuery, selectedCollectionId, sort],
  );

  useEffect(() => {
    let current = true;
    const blocked = sensitiveCollectionScope && !sensitiveCollectionToken;
    if (blocked || hasNoItemList(collection, selectedCollectionId)) {
      setItems([]);
      setVisibleItems([]);
      setLoading(false);
      return () => {
        current = false;
      };
    }

    setLoading(true);
    setLocalError("");
    const curated = isCurated(collection, selectedCollectionId);
    void libraryItemRequest({
      spaceId,
      collection,
      selectedCollectionId,
      searchQuery,
      mediaType,
      libraryQuery,
      semanticSearchEnabled: options.semanticSearchEnabled,
      sensitiveToken: sensitiveCollectionToken,
    })
      .then((library) => {
        if (!current) return;
        const nextItems = curated
          ? filterCuratedItems(library.items, { searchQuery, mediaType, sort, direction })
          : library.items;
        setItems(nextItems);
        setVisibleItems(nextItems);
        setNextAfter(curated ? "" : (library.next_after ?? ""));
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (
          error instanceof SpaceRequestError &&
          error.code === "library_reauthentication_required" &&
          sensitiveCollectionScope
        ) {
          options.onSensitiveGrantRejected(sensitiveCollectionScope);
          return;
        }
        setLocalError(error instanceof Error ? error.message : "Library could not be loaded.");
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [
    collection,
    direction,
    libraryQuery,
    mediaType,
    options.semanticSearchEnabled,
    reloadKey,
    searchQuery,
    selectedCollectionId,
    sensitiveCollectionScope,
    sensitiveCollectionToken,
    sort,
    spaceId,
  ]);

  // Memory playback offers a soundtrack, so audio is fetched alongside a memory.
  useEffect(() => {
    if (collection !== "memory" || !selectedCollectionId) {
      setMemoryAudioItems([]);
      return;
    }
    let current = true;
    void spacesApi
      .libraryItems(spaceId, { media_type: "audio", limit: 200 })
      .then((result) => current && setMemoryAudioItems(result.items))
      .catch(() => current && setMemoryAudioItems([]));
    return () => {
      current = false;
    };
  }, [collection, selectedCollectionId, spaceId]);

  return {
    items,
    setItems,
    visibleItems,
    setVisibleItems,
    memoryAudioItems,
    nextAfter,
    setNextAfter,
    loadingMore,
    setLoadingMore,
    loading,
    libraryQuery,
  };
}
