type UploadPurpose = "attachment" | "note_attachment";

export const UPLOAD_LIMIT_BYTES: Record<UploadPurpose, number> = {
  attachment: 10 * 1024 * 1024,
  note_attachment: 15 * 1024 * 1024,
};

const PURPOSE_LABEL: Record<UploadPurpose, string> = {
  attachment: "Chat attachment",
  note_attachment: "Doc attachment",
};

export function formatUploadLimit(purpose: UploadPurpose): string {
  return `${Math.round(UPLOAD_LIMIT_BYTES[purpose] / (1024 * 1024))} MB`;
}

export function uploadLimitError(purpose: UploadPurpose, byteSize: number): string | null {
  const limit = UPLOAD_LIMIT_BYTES[purpose];
  if (limit === undefined) return "That upload type isn’t supported.";
  if (byteSize > limit) {
    return `${PURPOSE_LABEL[purpose]}s are limited to ${formatUploadLimit(purpose)}.`;
  }
  return null;
}

export function assertUploadLimit(purpose: UploadPurpose, byteSize: number): void {
  const message = uploadLimitError(purpose, byteSize);
  if (message) throw new Error(message);
}
