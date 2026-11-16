import type {
  LibraryEditResult,
  LibraryEditVersion,
  LibraryRenditionRequest,
  SpaceLibraryItem,
} from "./dto/entities";
import type { LibraryEditDefinition } from "./dto/common";

import type { SpaceRequest } from "./spaceRequestTypes";
/** What opens a library image's edit room: a one-use ticket, the room and what this person may do. */
export interface LibraryImageCollaborationTicket {
  ticket: string;
  room: string;
  url: string;
  role: "creator" | "editor" | "viewer";
  expires_at: string;
}

export function createSpaceLibraryEditsApi(spaceRequest: SpaceRequest) {
  return {
    /** A ticket into the room where everyone editing an image shares the edit live. */
    imageCollaborationTicket: (spaceId: string, itemId: string) =>
      spaceRequest<LibraryImageCollaborationTicket>(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/collaboration-ticket`,
        { method: "POST" },
      ),
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
