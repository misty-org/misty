import type {
  LibraryEditResult,
  LibraryEditVersion,
  LibraryRenditionRequest,
  SpaceLibraryItem,
} from "@/api/spaces/dto/entities";
import type { LibraryEditDefinition } from "@/api/spaces/dto/common";

import type { SpaceRequest } from "./types";
export function createSpaceLibraryEditsApi(spaceRequest: SpaceRequest) {
  return {
    editVersions: (spaceId: string, itemId: string) =>
      spaceRequest<{ versions: LibraryEditVersion[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions`,
      ),
    createEditVersion: (
      spaceId: string,
      item: SpaceLibraryItem,
      definition: LibraryEditDefinition,
    ) =>
      spaceRequest<LibraryEditResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}/versions`,
        {
          method: "POST",
          body: JSON.stringify({ item_version: item.version, edit_definition: definition }),
        },
      ),
    renderEditVersion: (spaceId: string, itemId: string, editId: string, maximumOutputBytes = 0) =>
      spaceRequest<LibraryRenditionRequest>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(editId)}/render`,
        {
          method: "POST",
          body: JSON.stringify({ maximum_output_bytes: maximumOutputBytes }),
        },
      ),
    selectEditVersion: (spaceId: string, item: SpaceLibraryItem, editId = "") =>
      spaceRequest<LibraryEditResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}/versions/current`,
        {
          method: "PUT",
          body: JSON.stringify({ item_version: item.version, edit_id: editId }),
        },
      ),
    deleteEditVersion: (spaceId: string, itemId: string, editId: string) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(editId)}`,
        { method: "DELETE" },
      ),
  };
}
