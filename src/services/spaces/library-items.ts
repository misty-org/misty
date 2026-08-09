import type { AgentUsage } from "@/services/spaces/dto/interfaces/agentUsageTypes";
import type {
  BulkLibraryItemOptions,
  LibraryAssetStack,
  LibraryDiscovery,
  LibraryImportHistoryItem,
  LibraryItemQuery,
  LibraryItemsResult,
  LibraryPinnedCollection,
  LibrarySearchFacets,
  LibrarySharedReference,
  SpaceLibraryItem,
  SpaceStorageUsage,
} from "@/services/spaces/dto/interfaces/types";
import type { BulkLibraryItemAction } from "@/services/spaces/dto/types/types";

import {
  downloadProtectedFile,
  fetchProtectedBlob,
  libraryPreviewPath,
  libraryReauthenticationHeaders,
  replaceLibraryItemContent,
  uploadLibraryBlob,
  uploadLibraryPath,
  type LibraryUploadOptions,
} from "./library-upload";
import type { SpaceRequest } from "./types";
export function createSpaceLibraryItemsApi(spaceRequest: SpaceRequest) {
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
    bulkLibraryItems: (
      spaceId: string,
      items: SpaceLibraryItem[],
      action: BulkLibraryItemAction,
      options: BulkLibraryItemOptions = {},
      reauthenticationToken = "",
    ) =>
      spaceRequest<LibraryItemsResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/bulk`,
        {
          method: "POST",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify({
            action,
            album_id: options.albumId ?? "",
            tags: options.tags,
            date_override: options.dateOverride,
            location_override: options.locationOverride,
            items: items.map((item) => ({ id: item.id, version: item.version })),
          }),
        },
      ),
    duplicateLibraryItems: (spaceId: string, itemIds: string[], reauthenticationToken = "") =>
      spaceRequest<LibraryItemsResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/duplicate`,
        {
          method: "POST",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify({ item_ids: itemIds }),
        },
      ),
    libraryUsage: (spaceId: string) =>
      spaceRequest<SpaceStorageUsage>(`/spaces/${encodeURIComponent(spaceId)}/library/usage`),
    /** The signed-in account's weekly hosted-AI allowance, not a Space's. */
    agentUsage: () =>
      spaceRequest<{ agent_usage?: AgentUsage }>("/billing/usage", { cache: "no-store" }),
    libraryAssetStacks: (spaceId: string) =>
      spaceRequest<{ stacks: LibraryAssetStack[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks`,
      ),
    createLibraryAssetStack: (
      spaceId: string,
      input: Pick<
        LibraryAssetStack,
        "kind" | "title" | "cover_item_id" | "motion_item_id" | "members"
      >,
      reauthenticationToken = "",
    ) =>
      spaceRequest<LibraryAssetStack>(
        `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks`,
        {
          method: "POST",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify(input),
        },
      ),
    updateLibraryAssetStack: (
      spaceId: string,
      stack: LibraryAssetStack,
      patch: Partial<Pick<LibraryAssetStack, "title" | "cover_item_id" | "effect">>,
      reauthenticationToken = "",
    ) =>
      spaceRequest<LibraryAssetStack>(
        `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks/${encodeURIComponent(stack.id)}`,
        {
          method: "PATCH",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify({
            version: stack.version,
            title: patch.title ?? stack.title,
            cover_item_id: patch.cover_item_id ?? stack.cover_item_id,
            effect: patch.effect ?? stack.effect ?? "still",
          }),
        },
      ),
    deleteLibraryAssetStack: (
      spaceId: string,
      stack: LibraryAssetStack,
      reauthenticationToken = "",
    ) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks/${encodeURIComponent(stack.id)}?version=${stack.version}`,
        { method: "DELETE", headers: libraryReauthenticationHeaders(reauthenticationToken) },
      ),
    updateLibraryItem: (
      spaceId: string,
      item: SpaceLibraryItem,
      patch: Partial<
        Pick<SpaceLibraryItem, "display_name" | "caption" | "tags" | "favorite" | "hidden">
      >,
      reauthenticationToken = "",
    ) =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify({
            version: item.version,
            display_name: patch.display_name ?? item.display_name,
            caption: patch.caption ?? item.caption,
            tags: patch.tags ?? item.tags,
            favorite: patch.favorite ?? item.favorite,
            hidden: patch.hidden ?? item.hidden,
          }),
        },
      ),
    trashLibraryItem: (spaceId: string, itemId: string, reauthenticationToken = "") =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/trash`,
        { method: "POST", headers: libraryReauthenticationHeaders(reauthenticationToken) },
      ),
    restoreLibraryItem: (spaceId: string, itemId: string, reauthenticationToken = "") =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/restore`,
        { method: "POST", headers: libraryReauthenticationHeaders(reauthenticationToken) },
      ),
    uploadLibraryPath: (
      spaceId: string,
      path: string,
      purpose: "library" | "attachment",
      options?: LibraryUploadOptions,
    ) => uploadLibraryPath(spaceId, path, purpose, options),
    uploadLibraryBlob: (
      spaceId: string,
      blob: Blob,
      filename: string,
      purpose: "library" | "attachment" = "library",
      options?: LibraryUploadOptions,
    ) => uploadLibraryBlob(spaceId, blob, filename, purpose, options),
    replaceLibraryItemContent: (
      spaceId: string,
      item: SpaceLibraryItem,
      blob: Blob,
      filename: string,
      options?: LibraryUploadOptions,
    ) => replaceLibraryItemContent(spaceId, item, blob, filename, options),
    promoteAttachment: (spaceId: string, attachmentId: string) =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/promote`,
        { method: "POST" },
      ),
    sharedReferences: (spaceId: string) =>
      spaceRequest<{ references: LibrarySharedReference[]; outgoing: LibrarySharedReference[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/shared`,
      ),
    sharedReferenceContent: (spaceId: string, referenceId: string) =>
      fetchProtectedBlob(
        `/spaces/${encodeURIComponent(spaceId)}/library/shared/${encodeURIComponent(referenceId)}/download`,
      ),
    revokeLibraryGrant: (spaceId: string, grant: LibrarySharedReference) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/grants/${encodeURIComponent(grant.grant_id)}?version=${grant.version}`,
        { method: "DELETE" },
      ),
    libraryContent: (spaceId: string, itemId: string, reauthenticationToken = "") =>
      fetchProtectedBlob(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/download`,
        { headers: libraryReauthenticationHeaders(reauthenticationToken) },
      ),
    libraryOriginalContent: (spaceId: string, itemId: string, reauthenticationToken = "") =>
      fetchProtectedBlob(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/download?version=original`,
        { headers: libraryReauthenticationHeaders(reauthenticationToken) },
      ),
    libraryPreview: (
      spaceId: string,
      itemId: string,
      reauthenticationToken = "",
      cacheVersion?: string | number,
    ) =>
      fetchProtectedBlob(libraryPreviewPath(spaceId, itemId, false, cacheVersion), {
        headers: libraryReauthenticationHeaders(reauthenticationToken),
      }),
    libraryOriginalPreview: (
      spaceId: string,
      itemId: string,
      reauthenticationToken = "",
      cacheVersion?: string | number,
    ) =>
      fetchProtectedBlob(libraryPreviewPath(spaceId, itemId, true, cacheVersion), {
        headers: libraryReauthenticationHeaders(reauthenticationToken),
      }),
    downloadAttachment: (spaceId: string, attachmentId: string, filename: string) =>
      downloadProtectedFile(
        `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
        filename,
      ),
  };
}
