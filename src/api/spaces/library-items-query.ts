import type {
  LibraryItemQuery,
  LibraryItemsResult,
  LibrarySearchFacets,
  SpaceStorageUsage,
} from "@/api/spaces/dto/entities";

import { libraryReauthenticationHeaders } from "./library-transfer-paths";
import type { SpaceRequest } from "./types";

export function createLibraryQueryApi(spaceRequest: SpaceRequest) {
  return {
    libraryItems: (spaceId: string, query: LibraryItemQuery = {}, reauthenticationToken = "") => {
      const values = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "" && value !== false) values.set(key, String(value));
      }
      const suffix = values.size > 0 ? `?${values.toString()}` : "";
      return spaceRequest<LibraryItemsResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library${suffix}`,
        { headers: libraryReauthenticationHeaders(reauthenticationToken) },
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
