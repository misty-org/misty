import { spacesApi } from "@/services/spaces/api";
import type { LibraryItemQuery, SpaceLibraryItem } from "@/services/spaces/dto/interfaces/types";
import { compareLibraryItems } from "../libraryFormat";
import { libraryItemMIME } from "../SpaceLibraryPrimitives";
import type { LibraryCollectionKind } from "../types/useSpaceLibraryData";

/** Collections whose items arrive whole, already scoped by the server. */
const CURATED_COLLECTIONS = new Set<LibraryCollectionKind>([
  "recent-days",
  "months",
  "years",
  "people",
  "groups",
  "memory",
  "trip",
  "duplicate",
]);

/** Collections that render their own index instead of an item grid. */
const INDEX_COLLECTIONS = new Set<LibraryCollectionKind>(["collections", "shared", "imports"]);

/** Collections that need a selection before any items exist. */
const NEEDS_SELECTION = new Set<LibraryCollectionKind>([
  "recent-days",
  "months",
  "years",
  "people",
  "albums",
  "groups",
  "duplicate",
]);

export function isCurated(collection: LibraryCollectionKind, selectedCollectionId: string) {
  return (
    CURATED_COLLECTIONS.has(collection) ||
    (collection === "albums" && Boolean(selectedCollectionId))
  );
}

export function hasNoItemList(collection: LibraryCollectionKind, selectedCollectionId: string) {
  return (
    INDEX_COLLECTIONS.has(collection) || (NEEDS_SELECTION.has(collection) && !selectedCollectionId)
  );
}

export interface LibraryItemRequestOptions {
  spaceId: string;
  collection: LibraryCollectionKind;
  selectedCollectionId: string;
  searchQuery: string;
  mediaType: string;
  libraryQuery: LibraryItemQuery;
  semanticSearchEnabled: boolean;
  sensitiveToken: string;
}

/**
 * Picks the endpoint that backs the current collection.
 *
 * Semantic search is only meaningful for free-text queries over everything, so
 * it is skipped for field syntax (`tag:`), media filters and curated views —
 * and always falls back to the plain item query if it fails.
 */
export function libraryItemRequest(
  options: LibraryItemRequestOptions,
): Promise<{ items: SpaceLibraryItem[]; next_after?: string }> {
  const { spaceId, collection, selectedCollectionId, searchQuery, libraryQuery } = options;

  const semantic =
    (collection === "recent" || collection === "smart") &&
    Boolean(searchQuery) &&
    !searchQuery.includes(":") &&
    !options.mediaType &&
    options.semanticSearchEnabled;
  if (semantic)
    return spacesApi
      .semanticLibrarySearch(spaceId, searchQuery)
      .catch(() => spacesApi.libraryItems(spaceId, libraryQuery));

  const dateKind =
    collection === "recent-days"
      ? "day"
      : collection === "months"
        ? "month"
        : collection === "years"
          ? "year"
          : null;
  if (dateKind) return spacesApi.discoveryItems(spaceId, dateKind, selectedCollectionId);
  if (collection === "memory" || collection === "trip" || collection === "duplicate")
    return spacesApi.discoveryItems(spaceId, collection, selectedCollectionId);
  if (collection === "people") return spacesApi.personItems(spaceId, selectedCollectionId);
  if (collection === "groups") return spacesApi.groupItems(spaceId, selectedCollectionId);
  if (collection === "albums" && selectedCollectionId)
    return spacesApi.albumItems(spaceId, selectedCollectionId);
  return spacesApi.libraryItems(spaceId, libraryQuery, options.sensitiveToken);
}

/** Curated collections arrive unfiltered, so search and media filters apply here. */
export function filterCuratedItems(
  items: SpaceLibraryItem[],
  options: {
    searchQuery: string;
    mediaType: string;
    sort: NonNullable<LibraryItemQuery["sort"]>;
    direction: NonNullable<LibraryItemQuery["direction"]>;
  },
) {
  const needle = options.searchQuery.toLocaleLowerCase();
  const next = items.filter((item) => {
    const mime = libraryItemMIME(item);
    const matchesSearch =
      !needle ||
      [item.display_name, item.caption, item.tags.join(" "), item.file.original_filename]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    const matchesMedia =
      !options.mediaType || options.mediaType === "document"
        ? !options.mediaType || !/^(image|video|audio)\//.test(mime)
        : mime.startsWith(`${options.mediaType}/`);
    return matchesSearch && matchesMedia;
  });
  if (options.sort !== "album-order")
    next.sort((left, right) => compareLibraryItems(left, right, options.sort, options.direction));
  return next;
}
