import type { BulkLibraryItemAction } from "@/api/spaces/dto/common";
import type {
  BulkLibraryItemOptions,
  LibraryItemsResult,
  SpaceLibraryItem,
} from "@/api/spaces/dto/entities";

import type { SpaceRequest } from "./types";

export function createLibraryItemMutationApi(spaceRequest: SpaceRequest) {
  return {
    bulkLibraryItems: (
      spaceId: string,
      items: SpaceLibraryItem[],
      action: BulkLibraryItemAction,
      options: BulkLibraryItemOptions = {},
    ) =>
      spaceRequest<LibraryItemsResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/bulk`,
        {
          method: "POST",
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
    duplicateLibraryItems: (spaceId: string, itemIds: string[]) =>
      spaceRequest<LibraryItemsResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/duplicate`,
        {
          method: "POST",
          body: JSON.stringify({ item_ids: itemIds }),
        },
      ),
    updateLibraryItem: (
      spaceId: string,
      item: SpaceLibraryItem,
      patch: Partial<
        Pick<SpaceLibraryItem, "display_name" | "caption" | "tags" | "favorite" | "hidden">
      >,
    ) =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
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
    trashLibraryItem: (spaceId: string, itemId: string) =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/trash`,
        { method: "POST" },
      ),
    restoreLibraryItem: (spaceId: string, itemId: string) =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/restore`,
        { method: "POST" },
      ),
    promoteAttachment: (spaceId: string, attachmentId: string) =>
      spaceRequest<SpaceLibraryItem>(
        `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/promote`,
        { method: "POST" },
      ),
  };
}
