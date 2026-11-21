import * as uploads from "./library-upload";
import type { LibraryUploadOptions } from "./library-upload";
import { downloadProtectedFile, fetchProtectedBlob } from "./protected-download";

const attachmentPath = (spaceId: string, attachmentId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/download`;

/**
 * A chat message's attachments: the one kind of file the Space's server stores itself, uploaded
 * through its storage and read back from there. Everything else in a Space is in its drive.
 */
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
  /** An attachment's bytes. */
  attachmentContent: (spaceId: string, attachmentId: string) =>
    fetchProtectedBlob(attachmentPath(spaceId, attachmentId)),
  downloadAttachment: (spaceId: string, attachmentId: string, filename: string) =>
    downloadProtectedFile(attachmentPath(spaceId, attachmentId), filename),
};
