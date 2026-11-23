import * as uploads from "./library_upload";
import type { LibraryUploadOptions } from "./library_upload";
import { downloadProtectedFile, fetchProtectedBlob } from "./protected_download";

const attachmentPath = (spaceId: string, attachmentId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/download`;

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
  attachmentContent: (spaceId: string, attachmentId: string) =>
    fetchProtectedBlob(attachmentPath(spaceId, attachmentId)),
  downloadAttachment: (spaceId: string, attachmentId: string, filename: string) =>
    downloadProtectedFile(attachmentPath(spaceId, attachmentId), filename),
};
