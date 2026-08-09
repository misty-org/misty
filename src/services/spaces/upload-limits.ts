/**
 * Client-side upload size limits.
 *
 * These are a convenience check so the user gets an immediate, specific error
 * instead of waiting for a large transfer to be rejected. The server enforces
 * the same limits independently and is the only authority.
 */
export type UploadPurpose = "library" | "attachment" | "note_attachment";

export const UPLOAD_LIMIT_BYTES: Record<UploadPurpose, number> = {
  library: 100 * 1024 * 1024,
  attachment: 10 * 1024 * 1024,
  note_attachment: 15 * 1024 * 1024,
};

const PURPOSE_LABEL: Record<UploadPurpose, string> = {
  library: "Library file",
  attachment: "Chat attachment",
  note_attachment: "Note attachment",
};

export function formatUploadLimit(purpose: UploadPurpose): string {
  return `${Math.round(UPLOAD_LIMIT_BYTES[purpose] / (1024 * 1024))} MB`;
}

/**
 * Returns an error message when the file exceeds its purpose's limit, or null
 * when it is acceptable.
 */
export function uploadLimitError(purpose: UploadPurpose, byteSize: number): string | null {
  const limit = UPLOAD_LIMIT_BYTES[purpose];
  if (limit === undefined) return "That upload type isn’t supported.";
  if (byteSize > limit) {
    return `${PURPOSE_LABEL[purpose]}s are limited to ${formatUploadLimit(purpose)}.`;
  }
  return null;
}

/**
 * Throws before an oversized file is read or hashed. Callers rely on this
 * running first so the user sees the limit immediately; the server rejects the
 * same upload regardless.
 */
export function assertUploadLimit(purpose: UploadPurpose, byteSize: number): void {
  const message = uploadLimitError(purpose, byteSize);
  if (message) throw new Error(message);
}
