import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";

import type { LibraryTransfers } from "./library-items-core";
import { libraryPreviewPath } from "./library-transfer-paths";
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
    libraryContent: (spaceId: string, itemId: string) =>
      fetchProtectedBlob(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/download`,
      ),
    libraryOriginalContent: (spaceId: string, itemId: string) =>
      fetchProtectedBlob(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/download?version=original`,
      ),
    libraryPreview: (spaceId: string, itemId: string, cacheVersion?: string | number) =>
      fetchProtectedBlob(libraryPreviewPath(spaceId, itemId, false, cacheVersion)),
    libraryOriginalPreview: (spaceId: string, itemId: string, cacheVersion?: string | number) =>
      fetchProtectedBlob(libraryPreviewPath(spaceId, itemId, true, cacheVersion)),
    downloadAttachment: (spaceId: string, attachmentId: string, filename: string) =>
      downloadProtectedFile(
        `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
        filename,
      ),
  };
}
