import type {
  LibraryEditResult,
  LibraryEditVersion,
  LibraryRenditionRequest,
  SpaceLibraryItem,
} from "@/api/spaces/dto/interfaces/types";
import type { LibraryEditDefinition } from "@/api/spaces/dto/types/types";

import { libraryReauthenticationHeaders } from "./library-transfer-paths";
import type { SpaceRequest } from "./types";
export function createSpaceLibraryEditsApi(spaceRequest: SpaceRequest) {
  return {
    editVersions: (spaceId: string, itemId: string, reauthenticationToken = "") =>
      spaceRequest<{ versions: LibraryEditVersion[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions`,
        { headers: libraryReauthenticationHeaders(reauthenticationToken) },
      ),
    createEditVersion: (
      spaceId: string,
      item: SpaceLibraryItem,
      definition: LibraryEditDefinition,
      reauthenticationToken = "",
    ) =>
      spaceRequest<LibraryEditResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}/versions`,
        {
          method: "POST",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify({ item_version: item.version, edit_definition: definition }),
        },
      ),
    renderEditVersion: (
      spaceId: string,
      itemId: string,
      editId: string,
      maximumOutputBytes = 0,
      reauthenticationToken = "",
    ) =>
      spaceRequest<LibraryRenditionRequest>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(editId)}/render`,
        {
          method: "POST",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify({ maximum_output_bytes: maximumOutputBytes }),
        },
      ),
    selectEditVersion: (
      spaceId: string,
      item: SpaceLibraryItem,
      editId = "",
      reauthenticationToken = "",
    ) =>
      spaceRequest<LibraryEditResult>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}/versions/current`,
        {
          method: "PUT",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify({ item_version: item.version, edit_id: editId }),
        },
      ),
    deleteEditVersion: (
      spaceId: string,
      itemId: string,
      editId: string,
      reauthenticationToken = "",
    ) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(editId)}`,
        { method: "DELETE", headers: libraryReauthenticationHeaders(reauthenticationToken) },
      ),
  };
}
