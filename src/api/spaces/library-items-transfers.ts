import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";

import type { LibraryTransfers } from "./library-items-core";
import { libraryPreviewPath, libraryReauthenticationHeaders } from "./library-transfer-paths";
import type { LibraryUploadOptions } from "./library-upload";

export function createLibraryTransferApi(transfers: LibraryTransfers) {
  const {
    downloadProtectedFile,
    fetchProtectedBlob,
    replaceLibraryItemContent,
    uploadLibraryBlob,
    uploadLibraryPath,
  } = transfers;
  return {
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
    sharedReferenceContent: (spaceId: string, referenceId: string) =>
      fetchProtectedBlob(
        `/spaces/${encodeURIComponent(spaceId)}/library/shared/${encodeURIComponent(referenceId)}/download`,
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
