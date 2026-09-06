import { libraryApi as spacesApi } from "@/features/spaces/library/libraryRuntime";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

/**
 * Refreshing the Library after a change, and paging further into it.
 *
 * `reload` pulls the catalog immediately so callers can await fresh albums or
 * people, then bumps `reloadKey` to re-run the item query.
 */
export function useLibraryReload(data: SpaceLibraryData) {
  const { spaceId, collection, refreshCatalog, setReloadKey } = data;
  const { nextAfter, setNextAfter, loadingMore, setLoadingMore } = data;
  const { libraryQuery, sensitiveCollectionToken, setItems, setVisibleItems, setLocalError } = data;

  const reload = async () => {
    await refreshCatalog();
    setReloadKey((current) => current + 1);
  };

  const loadMore = async () => {
    if (!nextAfter || loadingMore || collection === "groups") return;
    setLoadingMore(true);
    try {
      const result = await spacesApi.libraryItems(
        spaceId,
        { ...libraryQuery, after: nextAfter },
        sensitiveCollectionToken,
      );
      setItems((current) => [...current, ...result.items]);
      setVisibleItems((current) => [...current, ...result.items]);
      setNextAfter(result.next_after ?? "");
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "More Library items could not be loaded.",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  return { reload, loadMore };
}
