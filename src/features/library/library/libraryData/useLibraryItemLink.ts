import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

type ItemLinkData = Pick<
  SpaceLibraryData,
  | "spaceId"
  | "items"
  | "loading"
  | "loadingMore"
  | "nextAfter"
  | "setSelectedItemId"
  | "setLocalError"
>;

/** Resolve overview links through the normal authorized, visible item list. */
export function useLibraryItemLink(data: ItemLinkData, loadMore: () => Promise<void>) {
  const [params, setParams] = useSearchParams();
  const target = params.get("item");
  const scope = `${data.spaceId}:${target ?? ""}`;
  const [readyScope, setReadyScope] = useState("");
  const cursorRef = useRef("");
  const { items, loading, loadingMore, nextAfter, setSelectedItemId, setLocalError } = data;
  // Let the item loader enter its loading state when navigating between Spaces.
  useEffect(() => {
    cursorRef.current = "";
    setReadyScope(scope);
  }, [scope]);
  useEffect(() => {
    if (!target || readyScope !== scope || loading || loadingMore) return;
    const item = items.find(
      (candidate) => candidate.id === target && !candidate.hidden && !candidate.trashed_at,
    );
    if (item) {
      setSelectedItemId(item.id);
    } else if (nextAfter) {
      if (cursorRef.current === nextAfter) return;
      cursorRef.current = nextAfter;
      void loadMore();
      return;
    } else {
      setLocalError("This Library item isn’t available.");
    }
    const next = new URLSearchParams(params);
    next.delete("item");
    setParams(next, { replace: true });
  }, [
    target,
    readyScope,
    scope,
    loading,
    loadingMore,
    items,
    nextAfter,
    loadMore,
    params,
    setParams,
    setSelectedItemId,
    setLocalError,
  ]);
}
