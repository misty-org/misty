import type {
  LibraryItemQuery,
  LibraryItemsResult,
  LibrarySearchFacets,
  SpaceStorageUsage,
} from "./dto/entities";

import type { SpaceRequest } from "./spaceRequestTypes";

export function createLibraryQueryApi(spaceRequest: SpaceRequest) {
  return {
    libraryItems: (spaceId: string, query: LibraryItemQuery = {}) => {
      const values = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "" && value !== false) values.set(key, String(value));
      }
      const suffix = values.size > 0 ? `?${values.toString()}` : "";
      return spaceRequest<LibraryItemsResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library${suffix}`,
      );
    },
    libraryFacets: (spaceId: string, query = "") =>
      spaceRequest<LibrarySearchFacets>(
        `/spaces/${encodeURIComponent(spaceId)}/library/facets${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      ),
    libraryUsage: (spaceId: string) =>
      spaceRequest<SpaceStorageUsage>(`/spaces/${encodeURIComponent(spaceId)}/library/usage`),
  };
}
