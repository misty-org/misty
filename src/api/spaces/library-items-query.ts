import type {
  LibraryDiscovery,
  LibraryImportHistoryItem,
  LibraryItemQuery,
  LibraryItemsResult,
  LibraryPinnedCollection,
  LibrarySearchFacets,
  LibrarySharedReference,
  SpaceLibraryItem,
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
    reauthenticateLibrary: (
      spaceId: string,
      scope: "hidden" | "recently_deleted",
      password: string,
    ) =>
      spaceRequest<{ token: string; scope: string; expires_at: string }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/reauthenticate`,
        { method: "POST", body: JSON.stringify({ scope, password }) },
      ),
    libraryFacets: (spaceId: string, query = "") =>
      spaceRequest<LibrarySearchFacets>(
        `/spaces/${encodeURIComponent(spaceId)}/library/facets${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      ),
    semanticLibrarySearch: (spaceId: string, query: string) =>
      spaceRequest<LibraryItemsResult & { semantic: boolean }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/search/semantic?q=${encodeURIComponent(query)}`,
      ),
    libraryDiscovery: (spaceId: string) =>
      spaceRequest<LibraryDiscovery>(`/spaces/${encodeURIComponent(spaceId)}/library/discovery`),
    libraryPins: (spaceId: string) =>
      spaceRequest<{ pins: LibraryPinnedCollection[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/pins`,
      ),
    setLibraryPins: (
      spaceId: string,
      targets: Array<{ kind: LibraryPinnedCollection["target_kind"]; id: string }>,
    ) =>
      spaceRequest<{ pins: LibraryPinnedCollection[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/pins`,
        { method: "PUT", body: JSON.stringify({ targets }) },
      ),
    libraryImportHistory: (spaceId: string) =>
      spaceRequest<{ imports: LibraryImportHistoryItem[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/imports/history`,
      ),
    discoveryItems: (
      spaceId: string,
      kind: "day" | "month" | "year" | "memory" | "trip" | "duplicate" | "map",
      groupId: string,
    ) =>
      spaceRequest<LibraryItemsResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/discovery/${kind}/${encodeURIComponent(groupId)}/items`,
      ),
    updateMemoryPreference: (
      spaceId: string,
      memory: LibraryDiscovery["memories"][number],
      patch: {
        title?: string;
        cover_item_id?: string;
        music_item_id?: string;
        playback_seconds?: number;
      },
    ) =>
      spaceRequest<LibraryDiscovery["memories"][number]>(
        `/spaces/${encodeURIComponent(spaceId)}/library/discovery/memory/${encodeURIComponent(memory.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: memory.preference_version ?? 0,
            title: patch.title ?? memory.title,
            cover_item_id: patch.cover_item_id ?? memory.cover_item_id ?? "",
            music_item_id: patch.music_item_id ?? memory.music_item_id ?? "",
            playback_seconds: patch.playback_seconds ?? memory.playback_seconds ?? 4.5,
          }),
        },
      ),
    libraryUsage: (spaceId: string) =>
      spaceRequest<SpaceStorageUsage>(`/spaces/${encodeURIComponent(spaceId)}/library/usage`),
    sharedReferences: (spaceId: string) =>
      spaceRequest<{ references: LibrarySharedReference[]; outgoing: LibrarySharedReference[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/shared`,
      ),
    mergeDuplicates: (spaceId: string, keeper: SpaceLibraryItem, duplicates: SpaceLibraryItem[]) =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/library/duplicates/merge`,
        {
          method: "POST",
          body: JSON.stringify({
            keeper: { id: keeper.id, version: keeper.version },
            duplicates: duplicates.map((item) => ({ id: item.id, version: item.version })),
          }),
        },
      ),
  };
}
