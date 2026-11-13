import { spacesApi } from "../../api/api";
import type { LibraryItemQuery, SpaceLibraryItem } from "../../api/dto/entities";
import { libraryItemsPath } from "../../api/library-items-query";
import { useSpaceResource } from "../../api/spaceResource";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryCollectionKind } from "../hook-signatures/useSpaceLibraryData";
import type { LibraryMediaType } from "./useLibraryView";

interface UseLibraryItemsOptions {
  spaceId: string;
  collection: LibraryCollectionKind;
  searchQuery: string;
  mediaType: LibraryMediaType;
  sort: NonNullable<LibraryItemQuery["sort"]>;
  direction: NonNullable<LibraryItemQuery["direction"]>;
  reloadKey: number;
  setLocalError: (message: string) => void;
}

/**
 * The item list for the open collection, plus the query that produced it. `loading` is true only
 * on a Space's first load with nothing saved; changing the query keeps the current items on
 * screen until the new ones arrive.
 */
export function useLibraryItems(options: UseLibraryItemsOptions) {
  const { spaceId, collection, searchQuery, mediaType, sort, direction } = options;
  const { reloadKey, setLocalError } = options;
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

  // The first page of each query comes from its cached copy: a revisit or relaunch paints the
  // last answer at once and the fresh one follows. Later pages load on demand.
  const firstPage = useSpaceResource(libraryItemsPath(spaceId, libraryQuery), () =>
    spacesApi.libraryItems(spaceId, libraryQuery),
  );
  const { data: page, error: pageError, reload } = firstPage;
  const [items, setItems] = useState<SpaceLibraryItem[]>(() => page?.items ?? []);
  const [visibleItems, setVisibleItems] = useState<SpaceLibraryItem[]>(() => page?.items ?? []);
  const [nextAfter, setNextAfter] = useState(() => page?.next_after ?? "");
  const [loadingMore, setLoadingMore] = useState(false);
  // Whether the open Space's items have arrived. A new search, sort or filter keeps them on
  // screen until its answer arrives; only another Space starts from nothing.
  const [loaded, setLoaded] = useState(Boolean(page));
  const [shownFor, setShownFor] = useState(spaceId);

  if (shownFor !== spaceId) {
    // Another Space opened: its items aren't these, so it shows its own copy or nothing.
    setShownFor(spaceId);
    setItems(page?.items ?? []);
    setVisibleItems(page?.items ?? []);
    setNextAfter(page?.next_after ?? "");
    setLoaded(Boolean(page));
  }

  // The query the shown items belong to, and how many of them came from its first page.
  const shownQuery = useRef<{ path: string; firstPage: number } | null>(null);
  const shownItems = useRef(items);
  useEffect(() => {
    shownItems.current = items;
  }, [items]);
  const path = libraryItemsPath(spaceId, libraryQuery);
  useEffect(() => {
    if (!page) return;
    const previous = shownQuery.current;
    shownQuery.current = { path, firstPage: page.items.length };
    // Pages loaded after the first ("Load more") for this same query.
    const later = previous?.path === path ? shownItems.current.slice(previous.firstPage) : [];
    if (later.length) {
      // A fresh first page of the same query replaces the first page and keeps the pages loaded
      // after it, so the list doesn't shrink or jump under the person; the cursor stays theirs.
      const fresh = new Set(page.items.map((item) => item.id));
      const merged = [...page.items, ...later.filter((item) => !fresh.has(item.id))];
      setItems(merged);
      setVisibleItems(merged);
    } else {
      setItems(page.items);
      setVisibleItems(page.items);
      setNextAfter(page.next_after ?? "");
    }
    setLoaded(true);
    // `path` changes together with `page`; reading it inside is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (pageError)
      setLocalError(
        pageError instanceof Error ? pageError.message : "Library could not be loaded.",
      );
    else setLocalError("");
  }, [pageError, setLocalError]);

  // A reload after a change here reads the open query again, keeping what is shown meanwhile.
  const reloaded = useRef(reloadKey);
  useEffect(() => {
    if (reloaded.current === reloadKey) return;
    reloaded.current = reloadKey;
    void reload();
  }, [reload, reloadKey]);

  const loading = firstPage.loading && !loaded;

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
