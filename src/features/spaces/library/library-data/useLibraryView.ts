import type { LibraryItemQuery } from "../../api/dto/entities";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { normalizeLibraryItemScale } from "../libraryFormat";
import type { LibraryCollectionKind } from "../hook-signatures/useSpaceLibraryData";

export type LibraryMediaType = "" | NonNullable<LibraryItemQuery["media_type"]>;

type LibrarySort = NonNullable<LibraryItemQuery["sort"]>;
type LibraryDirection = NonNullable<LibraryItemQuery["direction"]>;

// The orders the Library's sort menu offers; anything else saved falls back to the default.
const sorts: LibrarySort[] = ["recently-added", "date-captured", "name", "size"];

/**
 * How the Library presents its items (grid or list, item size, order), kept in `misty.db` for
 * this device and shared by every Space, so switching Spaces keeps it.
 */
const useLibraryPresentation = createDeviceSetting<{
  viewMode: "grid" | "list";
  itemScale: number;
  sort: LibrarySort;
  direction: LibraryDirection;
}>({
  scope: "spaces.library.view",
  defaults: { viewMode: "grid", itemScale: 1, sort: "recently-added", direction: "desc" },
  normalize: (stored) => {
    const saved = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
    return {
      viewMode: saved.viewMode === "list" ? "list" : "grid",
      itemScale: normalizeLibraryItemScale(Number(saved.itemScale)),
      sort: sorts.includes(saved.sort as LibrarySort)
        ? (saved.sort as LibrarySort)
        : "recently-added",
      direction: saved.direction === "asc" ? "asc" : "desc",
    };
  },
});

/** Which collection is open and how its items are sorted and presented. */
export function useLibraryView() {
  const [librarySearchParams, setLibrarySearchParams] = useSearchParams();
  const [collection, setCollection] = useState<LibraryCollectionKind>("recent");
  const [mediaType, setMediaType] = useState<LibraryMediaType>("");
  const presentation = useLibraryPresentation((state) => state.value);
  const present = useLibraryPresentation((state) => state.set);

  return {
    librarySearchParams,
    setLibrarySearchParams,
    requestedCollection: librarySearchParams.get("collection"),
    collection,
    setCollection,
    mediaType,
    setMediaType,
    libraryViewMode: presentation.viewMode,
    setLibraryViewMode: (viewMode: "grid" | "list") =>
      present((current) => ({ ...current, viewMode })),
    libraryItemScale: presentation.itemScale,
    setLibraryItemScale: (itemScale: number) =>
      present((current) => ({ ...current, itemScale: normalizeLibraryItemScale(itemScale) })),
    sort: presentation.sort,
    setSort: (sort: LibrarySort) => present((current) => ({ ...current, sort })),
    direction: presentation.direction,
    setDirection: (direction: LibraryDirection) =>
      present((current) => ({ ...current, direction })),
  };
}
