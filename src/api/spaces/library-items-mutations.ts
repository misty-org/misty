import type { BulkLibraryItemAction } from "@/api/spaces/dto/common";
import type {
  BulkLibraryItemOptions,
  LibraryItemsResult,
  SpaceLibraryItem,
} from "@/api/spaces/dto/entities";

import { libraryReauthenticationHeaders } from "./library-transfer-paths";
import type { SpaceRequest } from "./types";

export function createLibraryItemMutationApi(spaceRequest: SpaceRequest) {
  return {
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
    promoteAttachment: (spaceId: string, attachmentId: string) =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/promote`,
        { method: "POST" },
      ),
  };
}
