import * as uploads from "./library_upload";
import type { LibraryUploadOptions } from "./library_upload";
import { attachmentDownloadPath } from "./attachment_paths";
import { downloadProtectedFile, fetchProtectedBlob } from "./protected_download";

export const spaceAttachmentsApi = {
  uploadLibraryPath: (
    spaceId: string,
    path: string,
    purpose: "attachment",
    options?: LibraryUploadOptions,
  ) => uploads.uploadLibraryPath(spaceId, path, purpose, options),
  uploadLibraryBlob: (
    spaceId: string,
    blob: Blob,
    filename: string,
    purpose: "attachment",
    options?: LibraryUploadOptions,
  ) => uploads.uploadLibraryBlob(spaceId, blob, filename, purpose, options),
  discardUnsentAttachment: (spaceId: string, uploadId: string) =>
    uploads.discardUnsentAttachment(spaceId, uploadId),
  attachmentContent: (spaceId: string, attachmentId: string) =>
    fetchProtectedBlob(attachmentDownloadPath(spaceId, attachmentId)),
  downloadAttachment: (spaceId: string, attachmentId: string, filename: string) =>
    downloadProtectedFile(attachmentDownloadPath(spaceId, attachmentId), filename),
};
