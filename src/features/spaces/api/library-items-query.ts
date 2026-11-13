import type {
  LibraryItemQuery,
  LibraryItemsResult,
  LibrarySearchFacets,
  SpaceStorageUsage,
} from "./dto/entities";

import type { SpaceRequest } from "./spaceRequestTypes";

/** Where a page of a Space's Library items is read from, which also names its cached copy. */
export function libraryItemsPath(spaceId: string, query: LibraryItemQuery = {}): string {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && value !== false) values.set(key, String(value));
  }
  const suffix = values.size > 0 ? `?${values.toString()}` : "";
  return `/spaces/${encodeURIComponent(spaceId)}/library${suffix}`;
}

export function createLibraryQueryApi(spaceRequest: SpaceRequest) {
  return {
    libraryItems: (spaceId: string, query: LibraryItemQuery = {}) =>
      spaceRequest<LibraryItemsResult>(libraryItemsPath(spaceId, query)),
    libraryFacets: (spaceId: string, query = "") =>
      spaceRequest<LibrarySearchFacets>(
        `/spaces/${encodeURIComponent(spaceId)}/library/facets${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      ),
    libraryUsage: (spaceId: string) =>
      spaceRequest<SpaceStorageUsage>(`/spaces/${encodeURIComponent(spaceId)}/library/usage`),
  };
}
